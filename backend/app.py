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

from flask import Flask, jsonify, request, send_from_directory

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
LAUNCHER = os.path.join(PROJECT_DIR, "launcher", "launch_game.sh")
OVERRIDES_FILE = os.path.join(PROJECT_DIR, "backend", "games.json")
PLAYS_FILE = os.path.join(PROJECT_DIR, "backend", "plays.json")
ROMS_DIR = os.path.join(PROJECT_DIR, "roms")

ALLOWED_SYSTEMS = {"nes", "snes"}
# Both Nestopia and snes9x read zip-wrapped ROMs directly, which is the
# common distribution format. Accept zips per-system so a .zip dropped
# in roms/snes/ scans into the SNES picker even without extraction.
ROM_EXTS = {
    "nes":  (".nes",  ".zip"),
    "snes": (".smc", ".sfc", ".zip"),
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


def scan_games(only_system=None):
    overrides = load_overrides()
    plays = load_plays()
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
            games.append({
                "id": game_id,
                "title": title,
                "system": system,
                "rom": fn,
                "description": override.get("description", ""),
                "plays": plays.get(game_id, 0),
            })
    return games


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/games")
def games():
    # ?system=nes|snes filters to that library. The BSA kiosk admin
    # picks the system from the GymTV dashboard, which drives the URL
    # the Pi's Chromium kiosk loads, which scopes the picker grid.
    only = (request.args.get("system") or "").strip().lower()
    return jsonify({"games": scan_games(only_system=only or None)})


@app.route("/api/launch", methods=["POST"])
def launch():
    global current_proc
    data = request.get_json(silent=True) or {}
    system = data.get("system")
    rom = data.get("rom", "")

    if system not in ALLOWED_SYSTEMS:
        return jsonify({"ok": False, "error": "invalid system"}), 400
    if "/" in rom or "\\" in rom or ".." in rom or not rom:
        return jsonify({"ok": False, "error": "invalid rom name"}), 400

    rom_path = os.path.join(ROMS_DIR, system, rom)
    if not os.path.isfile(rom_path):
        return jsonify({"ok": False, "error": "rom not found"}), 404

    if current_proc and current_proc.poll() is None:
        current_proc.terminate()
        try:
            current_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            current_proc.kill()

    overrides = load_overrides()
    game_id = derive_id(rom, overrides.get(rom, {}))
    with plays_lock:
        plays = load_plays()
        plays[game_id] = plays.get(game_id, 0) + 1
        save_plays(plays)
        new_count = plays[game_id]

    current_proc = subprocess.Popen([LAUNCHER, system, rom])
    return jsonify({"ok": True, "plays": new_count})


@app.route("/api/status")
def status_endpoint():
    """Returns { playing: bool, rom: str|None } so the picker JS can
    detect when retroarch dies (user pressed F4 on an attract-mode
    demo) and reset its idle timer accordingly."""
    global current_proc
    playing = current_proc is not None and current_proc.poll() is None
    return jsonify({"playing": playing})


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
