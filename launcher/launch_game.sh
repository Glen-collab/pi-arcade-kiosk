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
# Nestopia for NES — Trixie/Bookworm no longer ship libretro-fceumm.
# Nestopia is actually higher-accuracy than FCEUmm anyway.
case "$SYSTEM" in
  nes)  CORE_NAME="nestopia" ;;
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

# pi-arcade.service runs as User=pi but is system-scoped, so systemd
# doesn't propagate the desktop session's XDG_RUNTIME_DIR /
# WAYLAND_DISPLAY. Without these, retroarch can't open a window on the
# labwc compositor. Detect them by inspecting the user's runtime dir.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$(basename "$sock")" in *.lock) continue ;; esac
    if [ -S "$sock" ]; then
      export WAYLAND_DISPLAY="$(basename "$sock")"
      break
    fi
  done
fi

exec retroarch -L "$CORE_PATH" "$ROM_PATH"
