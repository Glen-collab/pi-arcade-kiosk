#!/bin/bash
# Launch a ROM with RetroArch + the appropriate libretro core.
# Usage: launch_game.sh <system> <rom-filename> [joypad-index] [num-users]
# Example: launch_game.sh nes "Super Mario Bros (U).nes" 1 2
#
# joypad-index is optional. When set, Player 1 in RetroArch is pinned
# to that udev joypad index instead of the default 0. The picker JS
# passes the index of whichever pad fired the launch button — without
# this, two-dongle setups silently land Player 1 on a silent dongle.
#
# num-users is optional and defaults to 1. The picker reports the
# count of pads that fired any button or axis in the last 30 sec.
# RetroArch's input_max_users gets pinned to that count so single-pad
# gameplay doesn't get auto-promoted to VS mode by a still-enumerated
# silent dongle, while 2-player lights up the moment a real second
# pad starts firing.

set -e

SYSTEM="$1"
ROM="$2"
JOYPAD_INDEX="$3"
NUM_USERS="$4"

if [ -z "$SYSTEM" ] || [ -z "$ROM" ]; then
  echo "Usage: $0 <system> <rom-filename> [joypad-index] [num-users]"
  exit 1
fi

# Sanitize NUM_USERS: only accept positive integers; default to 1.
if ! [[ "$NUM_USERS" =~ ^[1-9][0-9]*$ ]]; then
  NUM_USERS="1"
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

# Per-launch override appended to RetroArch's base config:
#   • input_max_users matches the picker's count of pads with recent
#     activity. Hides any still-paired-but-silent dongle so games like
#     MK3 don't auto-VS, while letting 2-player work the moment two
#     real pads are firing.
#   • input_player1_joypad_index pins Player 1 to whichever pad the
#     picker reported as the launching pad (so a silent paired dongle
#     doesn't claim Player 1 just by enumeration order).
OVERRIDE_CFG="/tmp/retroarch-launch-override.cfg"
{
  echo "input_max_users = \"$NUM_USERS\""
  if [ -n "$JOYPAD_INDEX" ] && [[ "$JOYPAD_INDEX" =~ ^[0-9]+$ ]]; then
    echo "input_player1_joypad_index = \"$JOYPAD_INDEX\""
  fi
} > "$OVERRIDE_CFG"

exec retroarch --appendconfig "$OVERRIDE_CFG" -L "$CORE_PATH" "$ROM_PATH"
