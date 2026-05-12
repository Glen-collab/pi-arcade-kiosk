# Pi Arcade Kiosk — NES on Pi Zero 2 W

NES emulator kiosk for Raspberry Pi Zero 2 W. A search-friendly grid of every ROM, with a "Top 10 Most Played" section that grows as you play. Designed to expand to SNES/PS1 on the Pi 4 once proven on the Zero 2 W.

## Features
- **Auto-discovery**: drop `.nes` files in `roms/nes/` — they show up immediately, alphabetically. No manual catalog editing.
- **Search bar**: filter all 857 ROMs as you type.
- **Top 10**: pinned section above the A–Z list, ranked by play count, updates live.
- **Optional metadata overrides**: `backend/games.json` lets you fix up titles or add descriptions for specific ROMs.

## Quick start

### Fresh SD card, brand new Pi
See **`docs/sd_card_workflow.md`** for the full Pi Imager → boot → Windows-side setup script flow (~15 min, mostly waiting).

TL;DR:
1. Flash Pi OS Lite 64-bit via Pi Imager with hostname=`pi-arcade`, SSH on, WiFi configured.
2. Boot the Pi.
3. From this Desktop folder:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup_pi_from_windows.ps1
   ```
4. Open `http://pi-arcade.local:8088/` in any browser.

### Already have a running Pi
```bash
git clone <repo-url> ~/pi_arcade_kiosk      # or scp from Windows
cd ~/pi_arcade_kiosk
sudo bash install/install.sh
sudo systemctl start pi-arcade
```

## What's where

| Folder | Purpose |
|---|---|
| `backend/app.py` | Flask launcher — auto-scans ROMs, tracks plays |
| `backend/games.json` | Optional metadata overrides (title/description per ROM) |
| `backend/plays.json` | Play counts (auto-managed; don't edit) |
| `frontend/` | Search + Top 10 + A-Z grid UI |
| `launcher/launch_game.sh` | Picks the right libretro core, exec's RetroArch |
| `install/install.sh` | Installs RetroArch + FCEUmm + Flask, registers systemd unit |
| `install/retroarch.cfg` | Pi Zero 2 W tuned config (no shaders, no rewind) |
| `install/pi-arcade.service` | systemd unit (ships disabled — you opt in) |
| `setup_pi_from_windows.ps1` | One-shot Windows-side installer |
| `docs/` | Setup, controllers, adding games |
| `roms/nes/` | Your `.nes` files (gitignored) |

## After the Pi Zero 2 W proves out
- Add SNES core (`libretro-snes9x`) + `roms/snes/` + extend `ALLOWED_SYSTEMS` in `app.py`
- Add PS1 core (`libretro-pcsx-rearmed`) + `roms/ps1/` + `bios/` + extend `app.py`
- Move install onto the Pi 4 (192.168.1.36) alongside the workout kiosk on a different port

See `ARCHITECTURE.md` for design rationale.
