# Pi Zero 2 W setup

Step-by-step for getting the arcade kiosk running on a fresh Pi Zero 2 W.

## 1. OS

Use **Raspberry Pi OS Lite (64-bit)** if you can — full desktop is overkill on a Zero 2 W with 512MB. If you want a desktop browser for kiosk display, use **Raspberry Pi OS (64-bit) with desktop**.

Flash with Raspberry Pi Imager. Pre-configure:
- Hostname: `pi-arcade` (or whatever)
- SSH enabled
- WiFi: your network
- User: `pi` (or your usual)

Boot it, find its IP from your router, SSH in.

## 2. Update + base packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git
```

## 3. Pull the project onto the Pi

Two options.

**A. From this Windows Desktop**, copy via SCP:

```bash
# from Windows (PowerShell or git-bash)
scp -r "C:/Users/big_g/Desktop/pi_arcade_kiosk" pi@<pi-ip>:~/
```

**B. After pushing to GitHub:**

```bash
git clone https://github.com/Glen-collab/pi_arcade_kiosk.git
```

## 4. Run the installer

```bash
cd ~/pi_arcade_kiosk
sudo bash install/install.sh
```

This installs `retroarch`, `libretro-fceumm`, `python3-flask`, copies the RetroArch config, makes scripts executable, and registers the systemd unit (disabled).

## 5. Add ROMs

```bash
# from Windows Desktop, send a few ROMs to the Pi
scp "F:/3538 NES ROMS (every rom ever) with ALL Emulators/Roms/USA/Super Mario Bros (U).nes" pi@<pi-ip>:~/pi_arcade_kiosk/roms/nes/
```

The starter `backend/games.json` already has entries for SMB, SMB3, Zelda, Metroid, Punch-Out, Contra. Match the filenames or edit `games.json` to match what you copied over.

## 6. Start it

```bash
sudo systemctl start pi-arcade
sudo systemctl status pi-arcade   # check it's running
```

## 7. Test

From your laptop on the same network:

```
http://<pi-ip>:8088/
```

You should see the game grid. Click a tile — RetroArch takes over the Pi's screen and the game starts. Press **F4** to quit.

## 8. Make it auto-start at boot (optional)

Only do this if you're happy with it.

```bash
sudo systemctl enable pi-arcade
```

## Troubleshooting

- **"Core not found"** — check `ls /usr/lib/aarch64-linux-gnu/libretro/` (or the armhf path). If empty, `sudo apt install libretro-fceumm` again.
- **No display when launching a game** — RetroArch needs the Pi's framebuffer. If you SSH'd in and ran the launcher remotely, it'll fail. Run from the Pi's local console, or hit the API from the kiosk Chromium.
- **Audio crackle** — edit `~/.config/retroarch/retroarch.cfg`, set `audio_driver = "pulse"` instead of `alsa`.
- **Game runs but laggy** — Pi Zero 2 W's NEON SIMD is needed. Confirm with `cat /proc/cpuinfo | grep neon`. If missing, you're on the original Zero W (no go) — needs the Zero 2 W.
