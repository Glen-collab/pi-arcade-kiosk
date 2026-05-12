"""Pi Arcade Kiosk — Flask launcher backend.

- Auto-scans `roms/<system>/` and exposes every ROM as a game.
- Derives title by stripping dump-tags from the filename
  (e.g. "Super Mario Bros (U) [!].nes" -> "Super Mario Bros").
- `backend/games.json` is optional: any entry whose `rom` matches a
  filename overrides the auto-derived title/description.
- Tracks play counts in `backend/plays.json`. Frontend uses these to
  build the Top 10 section.
"""
import json
import os
import re
import subprocess
from threading import Lock

from flask import Flask, jsonify, request, send_from_directory

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
LAUNCHER = os.path.join(PROJECT_DIR, "launcher", "launch_game.sh")
OVERRIDES_FILE = os.path.join(PROJECT_DIR, "backend", "games.json")
PLAYS_FILE = os.path.join(PROJECT_DIR, "backend", "plays.json")
ROMS_DIR = os.path.join(PROJECT_DIR, "roms")

ALLOWED_SYSTEMS = {"nes"}
ROM_EXTS = {"nes": (".nes",)}

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


def scan_games():
    overrides = load_overrides()
    plays = load_plays()
    games = []
    for system in ALLOWED_SYSTEMS:
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
    return jsonify({"games": scan_games()})


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8088)
