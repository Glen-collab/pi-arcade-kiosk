# Pi 5 Full Arcade Setup — From Blank SD to 1,788 Games

Complete guide to provision a new Pi 5 with all 4 game systems (NES, SNES, N64, GBA) and wire it into the BSA kiosk dashboard.

## What You Need

- Pi 5 (8 GB recommended)
- 32 GB+ microSD card
- USB-C 27W power supply (official Pi 5 PSU — **seat the cable firmly**, a loose plug shows red LED only)
- Windows PC with these drives connected:
  - **D:** — has `N64\Roms\` and `GBA\ROMS\` folders
  - **F:** — has `3538 NES ROMS (every rom ever) with ALL Emulators\Roms\USA\`
  - SNES ROMs at `C:\Users\big_g\Desktop\snes\*.zip`
- WiFi credentials for the gym network

## Step 1 — Flash the SD Card

1. Open **Raspberry Pi Imager**
2. Choose OS: **Raspberry Pi OS (64-bit)** — Debian Trixie
3. Click the gear icon (OS Customization):
   - Hostname: pick a name (e.g. `bsa-tv-4`)
   - Username: `pi` / Password: `pi`
   - **Enable SSH** — tick this, then Save, then Apply
   - WiFi: enter gym network SSID + password
4. Flash and insert into Pi 5
5. Boot the Pi — wait ~90 seconds for first boot

**Known gotcha:** SSH toggle sometimes doesn't persist. If the Pi is pingable but SSH refuses on port 22, reflash with explicit Save-before-Apply. Took 3 tries on the first Pi 5.

## Step 2 — SSH Key Setup (from Windows)

```powershell
# Test connection (password = pi)
ssh pi@<hostname>.local

# Install your existing SSH key (no password going forward)
$pubKey = Get-Content "C:\Users\big_g\.ssh\id_ed25519.pub"
ssh pi@<hostname>.local "mkdir -p ~/.ssh && echo '$pubKey' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"

# Enable passwordless sudo
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "echo 'pi ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/099-pi-nopasswd"

# Verify
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "sudo whoami"
# Should print: root
```

## Step 3 — Install BSA Kiosk Stack

This installs the workout TV kiosk, captive portal, kiosk agent, and all systemd services.

```powershell
# From the bsa-tv-kiosk repo on your Desktop
scp -i C:/Users/big_g/.ssh/id_ed25519 -r C:\Users\big_g\Desktop\bsa-tv-kiosk pi@<hostname>.local:~/bsa-tv-kiosk

ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "cd ~/bsa-tv-kiosk && sudo bash install.sh"
```

Set the coach code:
```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local 'echo "{\"coach_code\":\"Glenm7nus\"}" > /home/pi/bsa-config'
```

## Step 4 — Install Arcade Kiosk + RetroArch

```powershell
# Copy the pi_arcade_kiosk project
scp -i C:/Users/big_g/.ssh/id_ed25519 -r C:\Users\big_g\Desktop\pi_arcade_kiosk pi@<hostname>.local:~/pi_arcade_kiosk

# Run the installer (installs RetroArch + NES/SNES/GBA cores + systemd service)
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "cd ~/pi_arcade_kiosk && sudo bash install/install.sh"
```

## Step 5 — Install N64 Core (parallel_n64)

Not in Debian repos — download from libretro buildbot:

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local '
cd /tmp &&
curl -sL https://buildbot.libretro.com/nightly/linux/aarch64/latest/parallel_n64_libretro.so.zip -o parallel_n64.zip &&
unzip -o parallel_n64.zip &&
sudo mv parallel_n64_libretro.so /usr/lib/aarch64-linux-gnu/libretro/ &&
rm parallel_n64.zip &&
echo "parallel_n64 installed"
'
```

## Step 6 — Configure RetroArch for N64

The Pi's RetroArch is GLES-only. N64 needs the angrylion software renderer:

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local '
sed -i "s/video_shared_context = \"false\"/video_shared_context = \"true\"/" ~/.config/retroarch/retroarch.cfg

cat > ~/.config/retroarch/retroarch-core-options.cfg << EOF
parallel-n64-gfxplugin = "angrylion"
parallel-n64-angrylion-vioverlay = "Filtered"
parallel-n64-screensize = "640x480"
EOF

echo "RetroArch N64 config done"
'
```

## Step 6.5 — Controller Setup (autoconfig profiles)

Without joypad autoconfig profiles, RetroArch shows "controller not
configured" for every wired pad / wireless dongle. The `install/install.sh`
script now installs these automatically, but if you need to do it manually:

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local '
cd /tmp && curl -sL https://github.com/libretro/retroarch-joypad-autoconfig/archive/refs/heads/master.tar.gz -o jpcfg.tar.gz && tar xzf jpcfg.tar.gz && cp retroarch-joypad-autoconfig-master/udev/*.cfg ~/.config/retroarch/autoconfig/ && rm -rf jpcfg.tar.gz retroarch-joypad-autoconfig-master && ls ~/.config/retroarch/autoconfig/*.cfg | wc -l'
```

That installs ~436 profiles (Xbox, 8BitDo, DragonRise, PS, etc.). **8BitDo
pads just work** — recommended over cheap no-name pads.

### Cheap 2-button NES pads (chip 0810:e501)
These share one USB chip across NES/SNES/PS1/SEGA variants, and libretro
ships 4 conflicting profiles — only the **PS1** one is active by default,
which mis-maps a 2-button NES pad (B points at a button that doesn't exist,
so it won't shoot in Contra). Fix: activate the NES profile, delete the
others:

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "
cd ~/.config/retroarch/autoconfig/ && \
sed -i 's/^#input_device = \"usb gamepad/input_device = \"usb gamepad/; s/^#input_vendor_id = \"2064\"/input_vendor_id = \"2064\"/; s/^#input_product_id = \"58625\"/input_product_id = \"58625\"/' 'usb_gamepad___________(NES).cfg' && \
rm -f 'usb_gamepad___________(PS1).cfg' 'usb_gamepad___________(SNES).cfg' 'usb_gamepad___________(SEGA).cfg'"
```

NES map = B(shoot)→btn0, A(jump)→btn1. PS1-style pads (same chip) are
handled per-game by `launch_game.sh` — it forces the PS1 layout when a PS1
game launches, so both pad types work without auto-detect ambiguity.

### Exit hotkey
`launch_game.sh` binds **Select(btn8) + Start(btn9) = exit to game list**
on every launch. Matches the Pi 4 combo.

## Step 7 — Create ROM Directories

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "mkdir -p ~/pi_arcade_kiosk/roms/{nes,snes,n64,gba}"
```

## Step 8 — Transfer ROMs

### NES (856 games, ~181 MB)

```powershell
# From Git Bash (handles the bracket filenames better with tar):
cd "/f/3538 NES ROMS (every rom ever) with ALL Emulators/Roms/USA"
tar -cf - *.nes | ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "tar -xf - -C ~/pi_arcade_kiosk/roms/nes/"
```

### SNES (426 games, ~503 MB)

```powershell
scp -i C:/Users/big_g/.ssh/id_ed25519 -r "C:\Users\big_g\Desktop\snes\*.zip" pi@<hostname>.local:~/pi_arcade_kiosk/roms/snes/
```

### N64 (339 deduped games, ~5.15 GB)

Uses the keep list to skip region/format dupes:

```powershell
# Stage deduped ROMs
$keepList = Get-Content "C:\Users\big_g\Desktop\home_arcade_pi\docs\n64_keep_list.txt" | Where-Object { $_.Trim() -ne '' }
$staging = "C:\Users\big_g\Desktop\n64_staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Path $staging | Out-Null
foreach ($name in $keepList) {
    $src = Join-Path "D:\N64\Roms" $name.Trim()
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $staging -Force }
}

# Transfer
scp -i C:/Users/big_g/.ssh/id_ed25519 -r "C:\Users\big_g\Desktop\n64_staging\*" pi@<hostname>.local:~/pi_arcade_kiosk/roms/n64/

# Cleanup staging
Remove-Item $staging -Recurse -Force -Confirm:$false
```

### GBA (167 games, ~1.7 GB)

```powershell
# Transfers all files including .sav — we clean those up after
scp -i C:/Users/big_g/.ssh/id_ed25519 -r "D:\GBA\ROMS\*" pi@<hostname>.local:~/pi_arcade_kiosk/roms/gba/

# Remove .sav files on Pi
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local 'find ~/pi_arcade_kiosk/roms/gba/ -name "*.sav" -delete'
```

## Step 9 — Verify

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local '
echo "=== ROM counts ==="
for sys in nes snes n64 gba; do
  echo "$sys: $(find ~/pi_arcade_kiosk/roms/$sys/ -type f | wc -l) games"
done
echo "=== Disk ==="
df -h /
echo "=== Cores ==="
ls /usr/lib/aarch64-linux-gnu/libretro/*.so
echo "=== API ==="
sudo systemctl restart pi-arcade
sleep 2
curl -s http://localhost:8088/api/games | python3 -c "
import json, sys
data = json.load(sys.stdin)
games = data[\"games\"]
systems = {}
for g in games:
    systems[g[\"system\"]] = systems.get(g[\"system\"], 0) + 1
for s in sorted(systems):
    print(f\"  {s}: {systems[s]}\")
print(f\"  TOTAL: {len(games)}\")
"
'
```

Expected output:
```
nes: 856
snes: 426
n64: 339
gba: 167
TOTAL: 1788
```

## Step 10 — Reboot

```powershell
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "sudo reboot"
```

After reboot, the kiosk agent auto-reports `systems=gba,n64,nes,snes` to the BSA backend. The GymTV dashboard will show NES/SNES/N64/GBA buttons for this device within 60 seconds.

## Step 11 — Tailscale (Optional, for Remote Access)

```powershell
# Generate an auth key at https://login.tailscale.com/admin/settings/keys
ssh -i C:/Users/big_g/.ssh/id_ed25519 pi@<hostname>.local "sudo tailscale up --authkey=tskey-auth-XXXXX"
```

Use `--authkey` instead of the browser URL flow — much more reliable on headless Pi.

---

## Quick Reference

| Item | Value |
|------|-------|
| SD card size | 32 GB minimum |
| Disk usage after setup | ~15 GB used / 12 GB free |
| SSH key | `C:\Users\big_g\.ssh\id_ed25519` |
| N64 keep list | `Desktop\home_arcade_pi\docs\n64_keep_list.txt` |
| N64 ROMs source | `D:\N64\Roms\` |
| GBA ROMs source | `D:\GBA\ROMS\` |
| NES ROMs source | `F:\3538 NES ROMS...\Roms\USA\` |
| SNES ROMs source | `Desktop\snes\*.zip` |
| N64 core | parallel_n64 (from buildbot, NOT apt) |
| N64 renderer | angrylion (software — GLES-only RetroArch) |
| GBA core | mgba (from apt) |
| Coach code | `Glenm7nus` |

## Gotchas

- **USB-C must be firmly seated** — loose plug = red LED only, no boot, looks like dead hardware
- **SSH toggle in Imager drops sometimes** — re-flash with explicit Save if port 22 refuses
- **labwc-autostart runs in memory** — updating the file requires a reboot to take effect
- **Bracket filenames** (`[!]`) — PowerShell `-LiteralPath` and `scp -r` handle them; Bash `find`/`ls *.ext` miss ~50% of GBA files
- **N64 needs angrylion** — Pi RetroArch is OpenGL ES only, parallel_n64 needs desktop OpenGL, angrylion software renderer bypasses this (runs at ~101% CPU on Pi 5, playable)
