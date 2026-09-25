"""Pi Arcade Kiosk — Flask launcher backend.

- Auto-scans `roms/<system>/` and exposes every ROM as a game.
- Derives title by stripping dump-tags from the filename
  (e.g. "Super Mario Bros (U) [!].nes" -> "Super Mario Bros").
- `backend/games.json` is optional: any entry whose `rom` matches a
  filename overrides the auto-derived title/description.
- Tracks play counts in `backend/plays.json`. Frontend uses these to
  build the Top 20 section.
- /api/exit-to-workouts is the gamepad/touch path back to the BSA
  workout kiosk — calls the BSA backend (so the admin dashboard sees
  the device is no longer in arcade mode) and execs the local
  switch-to-workouts.sh.
"""
import json
import os
import re
import subprocess
import urllib.request
from threading import Lock

from flask import Flask, Response, jsonify, request, send_from_directory

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
LAUNCHER = os.path.join(PROJECT_DIR, "launcher", "launch_game.sh")
OVERRIDES_FILE = os.path.join(PROJECT_DIR, "backend", "games.json")
PLAYS_FILE = os.path.join(PROJECT_DIR, "backend", "plays.json")
TABLETOP_FILE = os.path.join(PROJECT_DIR, "backend", "tabletop.json")
PREFS_FILE = os.path.join(PROJECT_DIR, "backend", "prefs.json")
# Glen's own two-player games: self-contained static HTML, no build, no network.
# Served from here rather than a second http.server so there is one process to
# supervise and one origin, which also keeps their localStorage stable.
TABLE_DIR = os.environ.get("TABLE_ARCADE_DIR", os.path.expanduser("~/table-arcade"))
# Not security. It keeps a seven-year-old from unlocking the whole library on
# their own, and that is the entire threat model. Anyone who can reach this
# machine's filesystem can edit prefs.json directly.
PARENT_CODE = os.environ.get("BSA_PARENT_CODE", "12345")
ROMS_DIR = os.path.join(PROJECT_DIR, "roms")

ALLOWED_SYSTEMS = {"nes", "snes", "n64", "gba"}
ROM_EXTS = {
    "nes":  (".nes",  ".zip"),
    "snes": (".smc", ".sfc", ".zip"),
    "n64":  (".z64", ".v64", ".n64", ".zip"),
    "gba":  (".gba", ".zip"),
}

# How /api/exit-to-workouts syncs state back to the BSA platform so the
# admin's GymTV page no longer shows the Pi in game mode. The Pi reads
# its coach code from /home/pi/bsa-config and its serial from
# /proc/cpuinfo — same identity bsa-kiosk-agent uses.
BSA_API_BASE = os.environ.get("BSA_API_BASE", "https://app.bestrongagain.com/api/kiosk")
BSA_CONFIG_PATH = os.environ.get("BSA_CONFIG_PATH", "/home/pi/bsa-config")
SWITCH_TO_WORKOUTS = os.environ.get(
    "BSA_SWITCH_WORKOUTS", "/usr/local/sbin/switch-to-workouts.sh"
)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
current_proc = None
plays_lock = Lock()
# Serialises the whole launch path. Without it, concurrent POSTs each read
# current_proc before any of them writes it, so every request believes nothing
# is running and spawns its own RetroArch. Twelve mashed launches produced
# twelve emulators fighting over the display. The terminate-then-spawn pair has
# to be atomic, not merely ordered.
launch_lock = Lock()


def clean_title(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", name)
    return name.strip()


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "game"


def load_overrides():
    if not os.path.isfile(OVERRIDES_FILE):
        return {}
    try:
        with open(OVERRIDES_FILE) as f:
            data = json.load(f)
        return {g["rom"]: g for g in data.get("games", [])}
    except Exception:
        return {}


def load_tabletop():
    """slug -> seating hint for cocktail-table mode.

    An EXCEPTION list, not an inclusion list. The split shader draws the same
    frame into both halves and the rotations cancel for each seated player, so
    any game with a single shared camera works face to face — which is nearly
    the whole library. Only the games that behave differently are listed.
    """
    if not os.path.isfile(TABLETOP_FILE):
        return {}
    try:
        with open(TABLETOP_FILE) as f:
            data = json.load(f)
    except Exception:
        return {}
    seating = {}
    for key, value in (("split_screen", "split-screen"),
                       ("single_player", "single-player")):
        for slug in data.get(key, []):
            seating[slug] = value
    return seating


def load_prefs():
    """Parent-set display preferences. visible_limit caps how many games the
    A-Z grid offers per system; None means the whole library."""
    if not os.path.isfile(PREFS_FILE):
        return {"visible_limit": None}
    try:
        with open(PREFS_FILE) as f:
            d = json.load(f)
        v = d.get("visible_limit")
        return {"visible_limit": int(v) if isinstance(v, int) and v > 0 else None}
    except Exception:
        return {"visible_limit": None}


def save_prefs(prefs):
    tmp = PREFS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(prefs, f, indent=2)
    os.replace(tmp, PREFS_FILE)


def load_plays():
    if not os.path.isfile(PLAYS_FILE):
        return {}
    try:
        with open(PLAYS_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_plays(plays):
    tmp = PLAYS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(plays, f, indent=2)
    os.replace(tmp, PLAYS_FILE)


def derive_id(rom_filename: str, override: dict) -> str:
    return override.get("id") or slugify(clean_title(rom_filename))


def scan_games(only_system=None, tabletop_only=False, apply_limit=False):
    overrides = load_overrides()
    plays = load_plays()
    seating_map = load_tabletop()
    limit = load_prefs()["visible_limit"] if apply_limit else None
    games = []
    systems = (
        [only_system] if only_system in ALLOWED_SYSTEMS else sorted(ALLOWED_SYSTEMS)
    )
    for system in systems:
        sys_dir = os.path.join(ROMS_DIR, system)
        if not os.path.isdir(sys_dir):
            continue
        for fn in sorted(os.listdir(sys_dir), key=str.lower):
            if not fn.lower().endswith(ROM_EXTS[system]):
                continue
            override = overrides.get(fn, {})
            title = override.get("title") or clean_title(fn)
            game_id = override.get("id") or slugify(title)
            # A per-ROM "seating" override in games.json wins over the
            # curated slug list, so a ROM whose title doesn't match can
            # still be classified without editing tabletop.json.
            seating = override.get("seating") or seating_map.get(game_id, "shared")
            # ?tabletop=1 hides only what genuinely plays badly across a
            # table, which is split-screen. Single-player games stay: someone
            # sitting alone still wants Zelda, and the split just mirrors the
            # same picture to the empty seat. The label is for the tile, not
            # a reason to hide the game.
            if tabletop_only and seating == "split-screen":
                continue
            games.append({
                "id": game_id,
                "title": title,
                "system": system,
                "rom": fn,
                "description": override.get("description", ""),
                "plays": plays.get(game_id, 0),
                "seating": seating,
            })
    if limit:
        # Keep the most-played per system, alphabetical for the untouched
        # remainder. A child-sized shelf should hold the games actually being
        # played, not whatever sorts first — an alphabetical cut would offer
        # "10-Yard Fight" and "1943" forever.
        kept, by_system = [], {}
        for g in games:
            by_system.setdefault(g["system"], []).append(g)
        for sys_games in by_system.values():
            sys_games.sort(key=lambda g: (-g["plays"], g["title"].lower()))
            kept.extend(sys_games[:limit])
        kept.sort(key=lambda g: g["title"].lower())
        return kept
    return games


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/table/")
@app.route("/table/<path:sub>")
def table_arcade(sub="index.html"):
    """Serve the table-arcade games.

    These are NOT emulated, so none of the RetroArch machinery applies: no
    core, no shader, no cocktail split. They draw their own two-player layout
    with the far panel already rotated, which is why they want the DISPLAY
    rotated 90 degrees while the emulators want it left alone.
    """
    if not os.path.isdir(TABLE_DIR):
        return jsonify({"error": "table-arcade not installed"}), 404
    full = os.path.normpath(os.path.join(TABLE_DIR, sub))
    if not full.startswith(os.path.realpath(TABLE_DIR)) and not full.startswith(TABLE_DIR):
        return jsonify({"error": "nope"}), 400
    # Inject the cabinet shim rather than editing the games. They stay
    # untouched and portable; everything cabinet-specific lives in one file.
    if sub.endswith(".html") and os.path.isfile(full):
        with open(full, encoding="utf-8") as f:
            html = f.read()
        tag = '<script src="/table-shim.js"></script>'
        if "</body>" in html:
            html = html.replace("</body>", tag + "</body>", 1)
        else:
            html = html + tag
        return Response(html, mimetype="text/html", headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        })
    return send_from_directory(TABLE_DIR, sub)


@app.route("/api/shim-log", methods=["POST"])
def shim_log():
    """Let the injected shim report what it can actually see in the page.

    Several fixes in a row were made by reasoning about the DOM from the
    outside and did not work. This is a window in: the shim posts what it
    found, and it shows up in journalctl.
    """
    d = request.get_json(silent=True) or {}
    app.logger.warning("SHIM %s", json.dumps(d)[:500])
    print("SHIM " + json.dumps(d)[:500], flush=True)
    return jsonify({"ok": True})


@app.route("/table-shim.js")
def table_shim():
    """Served no-cache, deliberately.

    Chromium caches this aggressively, and the cabinet's browser only reloads
    when the kiosk respawns — so a shim change could sit deployed on disk while
    the running page kept using the old copy. That makes fixes look like they
    did not work, which is a far worse problem than re-fetching 10KB.
    """
    resp = send_from_directory(FRONTEND_DIR, "table-shim.js")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.route("/api/launch-table", methods=["POST"])
def launch_table():
    """Hand the display to one of Glen's own games.

    Nothing about the RetroArch path applies: no core, no shader. What changes
    instead is the screen ROTATION — these draw a portrait playfield with the
    two players at its short edges, so the panel has to turn 90 degrees to put
    those edges at the ends of the table where people actually sit.

    The URL and rotation go into files the kiosk respawn loop reads; killing
    Chromium is what makes the change take. Launching a browser directly would
    just be killed by the loop seconds later.
    """
    data = request.get_json(silent=True) or {}
    rom = data.get("rom", "")
    if "/" in rom or "\\" in rom or ".." in rom or not rom.endswith(".html"):
        return jsonify({"ok": False, "error": "invalid game"}), 400
    if not os.path.isfile(os.path.join(TABLE_DIR, "games", rom)):
        return jsonify({"ok": False, "error": "game not found"}), 404
    _switch_kiosk("http://localhost:8088/table/games/" + rom, "90")
    return jsonify({"ok": True})


@app.route("/api/exit-table", methods=["POST"])
def exit_table():
    # Back to the table-arcade list specifically. Dropping the player into the
    # full 1,268-game library after they exit one of these is disorienting —
    # they were somewhere, and should come back to it.
    _switch_kiosk("http://localhost:8088/?table=1&system=table", "normal")
    return jsonify({"ok": True})


def _switch_kiosk(url, rotate):
    with open("/tmp/kiosk-url", "w") as f:
        f.write(url)
    with open("/tmp/kiosk-rotate", "w") as f:
        f.write(rotate)
    subprocess.run(["pkill", "-x", "chromium"], capture_output=True)


def table_games():
    """The playable titles, read off disk so adding an .html file is enough."""
    gdir = os.path.join(TABLE_DIR, "games")
    if not os.path.isdir(gdir):
        return []
    out = []
    for fn in sorted(os.listdir(gdir)):
        if not fn.endswith(".html"):
            continue
        slug = fn[:-5]
        out.append({
            "id": "table-" + slug,
            "title": slug.replace("-", " ").title(),
            "system": "table",
            "rom": fn,
            "url": "/table/games/" + fn,
            "description": "",
            "plays": 0,
            "seating": "shared",
        })
    return out


@app.route("/api/table-games")
def api_table_games():
    return jsonify({"games": table_games()})


@app.route("/api/games")
def games():
    # ?system=nes|snes filters to that library. The BSA kiosk admin
    # picks the system from the GymTV dashboard, which drives the URL
    # the Pi's Chromium kiosk loads, which scopes the picker grid.
    only = (request.args.get("system") or "").strip().lower()
    # ?tabletop=1 narrows the grid to games that survive two players sitting
    # on opposite sides of a cocktail cabinet — see backend/tabletop.json.
    tabletop_only = (request.args.get("tabletop") or "").strip() in ("1", "true", "yes")
    return jsonify({
        "games": scan_games(only_system=only or None, tabletop_only=tabletop_only,
                            apply_limit=True)
    })


@app.route("/api/launch", methods=["POST"])
def launch():
    global current_proc
    data = request.get_json(silent=True) or {}
    system = data.get("system")
    rom = data.get("rom", "")
    # Picker JS sends the index of whichever pad fired the launch press.
    # Forwarded as launch_game.sh's 3rd arg so RetroArch's Player 1
    # tracks the alive pad instead of defaulting to joypad index 0.
    raw_joypad = data.get("joypad_index")
    joypad_index = None
    if raw_joypad is not None:
        try:
            n = int(raw_joypad)
            if 0 <= n <= 15:
                joypad_index = str(n)
        except (TypeError, ValueError):
            pass
    # Number of pads the picker has seen recent activity on. Drives
    # RetroArch's input_max_users so single-pad gameplay isn't promoted
    # to VS mode by ghost-enumerated dongles, but 2-player works as
    # soon as a second pad starts firing events.
    raw_num_users = data.get("num_users")
    num_users = None
    if raw_num_users is not None:
        try:
            n = int(raw_num_users)
            if 1 <= n <= 4:
                num_users = str(n)
        except (TypeError, ValueError):
            pass

    # Screen rotation in 90-degree steps, passed straight to RetroArch's
    # video_rotation. 0 = as-mounted, 2 = flipped 180 for the player sitting
    # opposite. 1 and 3 exist for a panel physically mounted portrait, which
    # is how the original Pac-Man cocktail monitor sat.
    raw_rotation = data.get("rotation")
    rotation = None
    if raw_rotation is not None:
        try:
            n = int(raw_rotation)
            if 0 <= n <= 3:
                rotation = str(n)
        except (TypeError, ValueError):
            pass

    # Cocktail split: on per launch, so the shader never leaks into ordinary
    # single-screen play.
    cocktail = "1" if data.get("cocktail") in (True, 1, "1", "true", "yes") else ""

    if system not in ALLOWED_SYSTEMS:
        return jsonify({"ok": False, "error": "invalid system"}), 400
    if "/" in rom or "\\" in rom or ".." in rom or not rom:
        return jsonify({"ok": False, "error": "invalid rom name"}), 400

    rom_path = os.path.join(ROMS_DIR, system, rom)
    if not os.path.isfile(rom_path):
        return jsonify({"ok": False, "error": "rom not found"}), 404

    # Everything from "stop what's running" to "start the new one" happens
    # under one lock. Ordering alone is not enough: concurrent POSTs each read
    # current_proc before any of them writes it, so every request concludes
    # nothing is running and spawns its own RetroArch. Twelve mashed launches
    # produced twelve emulators fighting over one display.
    with launch_lock:
        if current_proc and current_proc.poll() is None:
            current_proc.terminate()
            try:
                current_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                current_proc.kill()
        # Belt and braces: an instance that escaped tracking — a service
        # restart mid-game, say — would otherwise linger forever.
        subprocess.run(["pkill", "-x", "retroarch"], capture_output=True)

        overrides = load_overrides()
        game_id = derive_id(rom, overrides.get(rom, {}))
        with plays_lock:
            plays = load_plays()
            plays[game_id] = plays.get(game_id, 0) + 1
            save_plays(plays)
            new_count = plays[game_id]

        # 3rd arg = joypad index, 4th = num_users, 5th = rotation,
        # 6th = cocktail. All positional; launch_game.sh tolerates empties so
        # the order stays predictable.
        cmd = [LAUNCHER, system, rom, joypad_index or "", num_users or "",
               rotation or "", cocktail]
        current_proc = subprocess.Popen(cmd)

    return jsonify({"ok": True, "plays": new_count})


@app.route("/api/status")
def status_endpoint():
    """Returns { playing: bool, rom: str|None } so the picker JS can
    detect when retroarch dies (user pressed F4 on an attract-mode
    demo) and reset its idle timer accordingly."""
    global current_proc
    playing = current_proc is not None and current_proc.poll() is None
    # The "back to workouts" tile only makes sense on a BSA gym TV, where a
    # switch script exists to hand the display back to the workout view. A
    # standalone cabinet has no such script, and the tile would just error. Say
    # so here rather than hardcoding per-install, so one codebase serves both.
    return jsonify({
        "playing": playing,
        "workouts_available": os.path.isfile(SWITCH_TO_WORKOUTS),
        "has_table": bool(table_games()),
        "systems": sorted(
            s for s in ALLOWED_SYSTEMS
            if os.path.isdir(os.path.join(ROMS_DIR, s))
            and any(
                f.lower().endswith(ROM_EXTS[s])
                for f in os.listdir(os.path.join(ROMS_DIR, s))
            )
        ),
    })


def _session_env():
    """Environment that can reach the desktop session's PipeWire.

    pi-arcade.service runs as User=pi but is SYSTEM scoped, so systemd does not
    propagate XDG_RUNTIME_DIR or the session bus — the same gap launch_game.sh
    works around for Wayland. Without these, wpctl cannot find PipeWire and
    every volume call silently returns nothing.
    """
    env = dict(os.environ)
    uid = os.getuid()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS",
                   f"unix:path=/run/user/{uid}/bus")
    return env


def _run(cmd, timeout=5):
    """Run a short command, return stdout or None. Settings must never take the
    picker down: a missing ddcutil or a monitor that ignores DDC should grey out
    a row, not throw."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, env=_session_env())
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def _get_volume():
    out = _run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    if not out:
        return None
    m = re.search(r"([0-9]*[.]?[0-9]+)", out)
    return int(round(float(m.group(1)) * 100)) if m else None


def _get_brightness():
    out = _run(["sudo", "ddcutil", "getvcp", "10", "--brief"], timeout=10)
    if not out:
        return None
    parts = out.split()
    # brief format: VCP 10 C <current> <max>
    return int(parts[3]) if len(parts) >= 4 and parts[3].isdigit() else None


@app.route("/api/settings")
def get_settings():
    """What the settings overlay can offer on THIS machine.

    Brightness rides DDC/CI over the HDMI cable, which many monitors ignore —
    the S2440L answers reads and brightness writes but refuses power commands.
    Report null when unavailable so the UI can hide the row rather than
    offering a control that does nothing.
    """
    return jsonify({
        "volume": _get_volume(),
        "brightness": _get_brightness(),
        "visible_limit": load_prefs()["visible_limit"],
    })


@app.route("/api/volume", methods=["POST"])
def set_volume():
    data = request.get_json(silent=True) or {}
    try:
        pct = max(0, min(100, int(data.get("value"))))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "bad value"}), 400
    _run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{pct}%"])
    return jsonify({"ok": True, "volume": _get_volume()})


@app.route("/api/brightness", methods=["POST"])
def set_brightness():
    data = request.get_json(silent=True) or {}
    try:
        pct = max(0, min(100, int(data.get("value"))))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "bad value"}), 400
    _run(["sudo", "ddcutil", "setvcp", "10", str(pct)], timeout=10)
    return jsonify({"ok": True, "brightness": pct})


@app.route("/api/visible-limit", methods=["POST"])
def set_visible_limit():
    """Cap the grid at N games per system. Code-gated so a child cannot undo it.

    A limit of 0 or null means the whole library.
    """
    data = request.get_json(silent=True) or {}
    if str(data.get("code", "")) != PARENT_CODE:
        return jsonify({"ok": False, "error": "bad code"}), 403
    raw = data.get("value")
    try:
        val = None if raw in (None, 0, "0", "") else max(1, min(10, int(raw)))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "bad value"}), 400
    save_prefs({"visible_limit": val})
    return jsonify({"ok": True, "visible_limit": val})


@app.route("/api/shutdown", methods=["POST"])
def shutdown():
    """Clean poweroff, so the cabinet's mains switch never has to yank a
    running filesystem.

    The Pi writes plays.json on every launch, so there is live writable state;
    cutting power mid-write is how an arcade Pi eventually needs reflashing.
    The picker offers this on Select+Start, the same combo that quits a game,
    so there is nothing extra to learn and no extra button to wire.
    """
    global current_proc
    if current_proc and current_proc.poll() is None:
        current_proc.terminate()
        try:
            current_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            current_proc.kill()
    # Detached: systemd tears this service down as part of the shutdown, and a
    # blocking call would be killed before it returned anyway.
    subprocess.Popen(["sudo", "systemctl", "poweroff"])
    return jsonify({"ok": True})


@app.route("/api/quit", methods=["POST"])
def quit_game():
    global current_proc
    if current_proc and current_proc.poll() is None:
        current_proc.terminate()
        try:
            current_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            current_proc.kill()
    return jsonify({"ok": True})


def read_bsa_coach_code():
    """Same identity-file format bsa-kiosk-agent reads. JSON preferred,
    KEY=VALUE accepted for legacy onboarding flows."""
    try:
        with open(BSA_CONFIG_PATH) as f:
            text = f.read()
    except Exception:
        return ""
    try:
        data = json.loads(text)
        code = (data.get("coach_code") or data.get("COACH_CODE") or "").strip()
        if code:
            return code
    except Exception:
        pass
    for line in text.splitlines():
        m = re.match(r'^\s*COACH_CODE\s*=\s*["\']?([^"\'\n]+)["\']?\s*$', line.strip())
        if m:
            return m.group(1).strip()
    return ""


def read_device_serial():
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Serial"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


@app.route("/api/exit-to-workouts", methods=["POST"])
def exit_to_workouts():
    """Gamepad/touch path back to the BSA workout kiosk. Best-effort
    syncs display_mode='workout' on the BSA backend (so the admin
    dashboard reflects reality), then execs switch-to-workouts.sh
    which kills this Chromium kiosk and respawns the workout one."""
    coach_code = read_bsa_coach_code()
    serial = read_device_serial()

    backend_ok = False
    if coach_code and serial:
        try:
            req = urllib.request.Request(
                f"{BSA_API_BASE}/exit-game-mode",
                data=json.dumps({"coach": coach_code, "device": serial}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                backend_ok = (200 <= resp.status < 300)
        except Exception as e:
            app.logger.warning("exit-game-mode sync failed: %s", e)

    # Stop any in-progress game before flipping Chromium so RetroArch
    # doesn't keep grabbing input/audio while the workout view comes back.
    global current_proc
    if current_proc and current_proc.poll() is None:
        current_proc.terminate()
        try:
            current_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            current_proc.kill()

    try:
        subprocess.Popen([SWITCH_TO_WORKOUTS])
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "switch-to-workouts.sh missing"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    return jsonify({"ok": True, "backend_synced": backend_ok})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8088)
