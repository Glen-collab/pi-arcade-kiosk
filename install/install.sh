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
apt install -y retroarch libretro-nestopia libretro-snes9x python3-flask unzip

echo "==> Ensuring ROM dirs exist"
sudo -u "$TARGET_USER" mkdir -p "$PROJECT_DIR/roms/nes" "$PROJECT_DIR/roms/snes"

echo "==> Installing RetroArch config for $TARGET_USER"
sudo -u "$TARGET_USER" mkdir -p "$USER_HOME/.config/retroarch"
cp "$PROJECT_DIR/install/retroarch.cfg" "$USER_HOME/.config/retroarch/retroarch.cfg"
chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config/retroarch/retroarch.cfg"

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
