#!/bin/bash
# Pi Arcade Kiosk installer — NES on Pi Zero 2 W
# Run as: sudo bash install/install.sh

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Run with sudo: sudo bash install/install.sh"
  exit 1
fi

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
TARGET_USER="${SUDO_USER:-pi}"
USER_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)

echo "==> Installing apt packages"
apt update
apt install -y retroarch libretro-nestopia libretro-snes9x libretro-mgba python3-flask unzip
# parallel_n64 core for N64: not in Debian repos, download from libretro buildbot
if [ ! -f /usr/lib/aarch64-linux-gnu/libretro/parallel_n64_libretro.so ]; then
  echo "==> Downloading parallel_n64 core from libretro buildbot"
  curl -sL https://buildbot.libretro.com/nightly/linux/aarch64/latest/parallel_n64_libretro.so.zip -o /tmp/parallel_n64.zip
  unzip -o /tmp/parallel_n64.zip -d /usr/lib/aarch64-linux-gnu/libretro/
  rm /tmp/parallel_n64.zip
fi

echo "==> Ensuring ROM dirs exist"
sudo -u "$TARGET_USER" mkdir -p "$PROJECT_DIR/roms/nes" "$PROJECT_DIR/roms/snes" "$PROJECT_DIR/roms/n64" "$PROJECT_DIR/roms/gba"

echo "==> Installing RetroArch config for $TARGET_USER"
sudo -u "$TARGET_USER" mkdir -p "$USER_HOME/.config/retroarch"
cp "$PROJECT_DIR/install/retroarch.cfg" "$USER_HOME/.config/retroarch/retroarch.cfg"
chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config/retroarch/retroarch.cfg"

# Joypad autoconfig profiles — without these RetroArch shows "controller
# not configured" for every wired pad / wireless dongle. The udev set
# covers Xbox, 8BitDo, DragonRise, PS, and ~430 others. Maps both wired
# USB controllers and wireless dongles automatically.
echo "==> Installing controller (joypad) autoconfig profiles"
AUTOCFG_DIR="$USER_HOME/.config/retroarch/autoconfig"
sudo -u "$TARGET_USER" mkdir -p "$AUTOCFG_DIR"
if [ -z "$(ls -A "$AUTOCFG_DIR" 2>/dev/null)" ]; then
  curl -sL https://github.com/libretro/retroarch-joypad-autoconfig/archive/refs/heads/master.tar.gz -o /tmp/jpcfg.tar.gz
  tar xzf /tmp/jpcfg.tar.gz -C /tmp
  cp /tmp/retroarch-joypad-autoconfig-master/udev/*.cfg "$AUTOCFG_DIR/"
  chown -R "$TARGET_USER:$TARGET_USER" "$AUTOCFG_DIR"
  rm -rf /tmp/jpcfg.tar.gz /tmp/retroarch-joypad-autoconfig-master
  echo "    installed $(ls "$AUTOCFG_DIR"/*.cfg | wc -l) controller profiles"
fi

echo "==> Making scripts executable"
chmod +x "$PROJECT_DIR/launcher/launch_game.sh"

echo "==> Installing systemd unit (disabled by default)"
SERVICE_FILE="$PROJECT_DIR/install/pi-arcade.service"
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__USER__|$TARGET_USER|g" \
    "$SERVICE_FILE" > /etc/systemd/system/pi-arcade.service
systemctl daemon-reload

echo ""
echo "Install complete."
echo ""
echo "Next steps:"
echo "  1. Drop .nes files into $PROJECT_DIR/roms/nes/"
echo "  2. Edit $PROJECT_DIR/backend/games.json to register each ROM"
echo "  3. Start it: sudo systemctl start pi-arcade"
echo "  4. Browse to: http://localhost:8088/"
echo ""
echo "Auto-start at boot (optional): sudo systemctl enable pi-arcade"
