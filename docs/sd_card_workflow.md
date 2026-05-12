# Pi Zero 2 W setup — start to finish

This is the complete walkthrough from blank SD card to working arcade kiosk. ~15 min of attention, mostly waiting.

## What you need
- Pi Zero 2 W
- 8GB+ microSD card (8GB is plenty: Pi OS Lite ~2GB + ~200MB of NES ROMs)
- microSD reader for your PC (or an adapter)
- Power supply for the Pi
- (For first test) HDMI cable + monitor + USB keyboard. Once running, everything is over network.

## Step 1 — Flash Pi OS via Pi Imager
1. Download **Raspberry Pi Imager** from raspberrypi.com if you don't have it.
2. Open it. Click **Choose Device** → **Raspberry Pi Zero 2 W**.
3. Click **Choose OS** → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**.
4. Click **Choose Storage** → your 8GB SD card.
5. Click **Next**. Imager asks "Use OS customisation?" → **Edit Settings**:

   **General tab:**
   - ✅ Set hostname: `pi-arcade`
   - ✅ Set username and password
     - Username: `pi`
     - Password: (something you'll remember — you'll type it a couple times during install)
   - ✅ Configure wireless LAN
     - SSID: your gym/home WiFi
     - Password: WiFi password
     - Wireless LAN country: `US`
   - ✅ Set locale settings
     - Timezone: your timezone
     - Keyboard layout: `us`

   **Services tab:**
   - ✅ Enable SSH → **Use password authentication**

   Click **Save**.

6. Click **Yes** ("would you like to apply the customisation?") → **Yes** ("erase all data?").
7. Wait ~3 minutes for the flash + verify.
8. Eject the card when Imager says it's done.

## Step 2 — Boot the Pi
1. Insert the SD card into the Pi Zero 2 W.
2. Plug in power.
3. Wait ~60 seconds for first boot. (The Pi expands the filesystem and connects to WiFi automatically.)
4. Optional sanity check: `ping pi-arcade.local` from your PC. Should respond.

## Step 3 — Run the Windows setup script
From this PC (the project lives on Desktop):

```powershell
cd "C:\Users\big_g\Desktop\pi_arcade_kiosk"
powershell -ExecutionPolicy Bypass -File .\setup_pi_from_windows.ps1
```

The script will:
1. Find the Pi at `pi-arcade.local`
2. Ask for the Pi password (the one you set in Imager) — possibly twice
3. SCP the project folder over
4. Zip up all 857 NES ROMs from `F:\3538 NES ROMS...\Roms\USA` and upload them
5. Run `install.sh` on the Pi (apt installs RetroArch, FCEUmm core, Flask, unzip)
6. Start the `pi-arcade` systemd service
7. Print the URL

Total: ~10 min of waiting. The longest step is the ROM zip upload over WiFi (~3-5 min).

## Step 4 — Test it
Open in any browser on your network:

```
http://pi-arcade.local:8088/
```

You should see the game grid. The Top 10 section is hidden until you've played some games — once a game gets plays, it moves up.

For the kiosk display itself (HDMI to a TV), see "Step 5".

## Step 5 — Kiosk display (optional, for the final TV setup)
The Pi can launch its own browser in fullscreen on boot, pointed at the kiosk URL. SSH in and:

```bash
sudo apt install -y chromium-browser unclutter
mkdir -p ~/.config/lxsession/LXDE-pi
cat > ~/.config/lxsession/LXDE-pi/autostart <<'EOF'
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0
@chromium-browser --kiosk --noerrdialogs --disable-translate http://localhost:8088/
EOF
sudo systemctl enable pi-arcade
sudo reboot
```

After reboot the Pi will autostart Chromium fullscreen on the game grid. Plug a USB controller in and you're set.

## Re-running the setup script
The script is idempotent — running it again just replaces the project files and re-runs the installer. Useful for pushing updates from your PC.

To skip ROM upload (just push code changes):
```powershell
.\setup_pi_from_windows.ps1 -SkipRoms
```

To skip the installer (just sync files):
```powershell
.\setup_pi_from_windows.ps1 -SkipRoms -SkipInstall
```

## Troubleshooting

**`pi-arcade.local` doesn't resolve.**
Some routers don't support mDNS. Find the Pi's IP from your router admin panel, then:
```powershell
.\setup_pi_from_windows.ps1 -PiHost 192.168.1.42
```

**SSH says "Permission denied."**
The username/password from Pi Imager didn't take. Default `pi`/`raspberry` no longer works on modern Pi OS — Imager's username MUST be set. Re-flash if needed.

**ROM zip extraction fails on Pi.**
Run `ssh pi@pi-arcade.local 'sudo apt install -y unzip'` then re-run the script with `-SkipInstall` for speed.

**Service won't start.**
```bash
ssh pi@pi-arcade.local 'sudo journalctl -u pi-arcade -n 50'
```
Most common cause: Python or Flask not installed. Re-run install.sh.
