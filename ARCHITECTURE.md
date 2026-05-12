# Architecture

## Goal
A small, fast NES kiosk on the Pi Zero 2 W. If it runs cleanly there, the same code drops onto the Pi 4 with SNES and PS1 added on top.

## Stack

```
+-----------------------------------------------------+
|  Chromium (kiosk mode) → http://localhost:8088/     |
|  ┌─────────────────────────────────────────────┐    |
|  │ Frontend grid: NES tiles, click=play        │    |
|  └──────────────┬──────────────────────────────┘    |
|                 │ POST /api/launch                  |
|  ┌──────────────▼──────────────────────────────┐    |
|  │ Flask (backend/app.py) on :8088             │    |
|  │   – validates rom (whitelist, no traversal) │    |
|  │   – spawns launcher/launch_game.sh          │    |
|  └──────────────┬──────────────────────────────┘    |
|                 │ exec                              |
|  ┌──────────────▼──────────────────────────────┐    |
|  │ launch_game.sh                              │    |
|  │   – auto-detects fceumm core path           │    |
|  │   – exec retroarch -L <core> <rom>          │    |
|  └──────────────┬──────────────────────────────┘    |
|                 │                                   |
|  ┌──────────────▼──────────────────────────────┐    |
|  │ RetroArch — full screen via SDL/KMS,        │    |
|  │ exits on F4 / hotkey, returns to Chromium   │    |
|  └─────────────────────────────────────────────┘    |
+-----------------------------------------------------+
```

## Why these choices

**RetroArch + FCEUmm core, not standalone Nestopia.** RetroArch gives one config and one input mapping. Adding SNES and PS1 later is just two more `apt install` packages and two more `case` arms in the launcher — no rewrite.

**Flask + HTML, not EmulationStation or RetroPie.** A small web app means one URL the Chromium kiosk can load, and a future "back to workouts" button on the Pi 4 is trivial — just navigate the page. RetroPie would wipe the SD card; we want this to coexist.

**Manual start, not boot service.** `sudo systemctl start pi-arcade` brings it up, `stop` brings it down. The systemd unit ships disabled.

**Pi Zero 2 W constraints:** 512MB RAM, four Cortex-A53 cores at 1GHz. NES emulation is well under 5% CPU on this hardware, so no shaders/scaling/rewind needed. The retroarch.cfg in `install/` keeps the heavy options off.

## ROM handling

- `.nes` files go in `roms/nes/` (gitignored — repo never contains copyrighted content).
- `backend/games.json` is the catalog. The frontend reads only this — uncatalogued ROMs don't show in the grid. You add an entry per ROM (id, title, rom filename).

## What this is NOT
- Not a full RetroPie replacement (no save state UI, no scraper, no themes).
- Not protected against a determined kiosk user — F11 toggles fullscreen, F4 quits RetroArch. True lockdown comes later if needed.
