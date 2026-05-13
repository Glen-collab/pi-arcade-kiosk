#!/bin/bash
# Launch a ROM with RetroArch + the appropriate libretro core.
# Usage: launch_game.sh <system> <rom-filename>
# Example: launch_game.sh nes "Super Mario Bros (U).nes"

set -e

SYSTEM="$1"
ROM="$2"

if [ -z "$SYSTEM" ] || [ -z "$ROM" ]; then
  echo "Usage: $0 <system> <rom-filename>"
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
ROM_PATH="$PROJECT_DIR/roms/$SYSTEM/$ROM"

if [ ! -f "$ROM_PATH" ]; then
  echo "ROM not found: $ROM_PATH"
  exit 1
fi

# Map system → core name. Add PS1 here when scope grows.
case "$SYSTEM" in
  nes)  CORE_NAME="fceumm" ;;
  snes) CORE_NAME="snes9x" ;;
  *)    echo "Unknown system: $SYSTEM"; exit 1 ;;
esac

# Auto-detect core path across 64-bit / 32-bit Pi OS layouts.
CORE_PATH=""
for d in /usr/lib/aarch64-linux-gnu/libretro \
         /usr/lib/arm-linux-gnueabihf/libretro \
         /usr/lib/x86_64-linux-gnu/libretro; do
  if [ -f "$d/${CORE_NAME}_libretro.so" ]; then
    CORE_PATH="$d/${CORE_NAME}_libretro.so"
    break
  fi
done

if [ -z "$CORE_PATH" ]; then
  echo "Core not found: ${CORE_NAME}_libretro.so"
  echo "Install with: sudo apt install libretro-${CORE_NAME}"
  exit 1
fi

exec retroarch -L "$CORE_PATH" "$ROM_PATH"
