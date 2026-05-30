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
  n64)  CORE_NAME="parallel_n64" ;;
  gba)  CORE_NAME="mgba" ;;
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

# Count physically plugged-in pads. Cheap dongles often share garbage
# VID/PIDs, and the picker only counts pads with recent activity — so
# a player-2 dongle that's plugged in but silent gets ignored. Force
# input_max_users >= number of /dev/input/js* devices so any plugged
# pad can play, even without "waking" it in the picker first.
JS_COUNT=$(ls /dev/input/js* 2>/dev/null | wc -l)
[ -z "$JS_COUNT" ] && JS_COUNT=1
if [ "$JS_COUNT" -gt "$NUM_USERS" ]; then
  NUM_USERS="$JS_COUNT"
fi
# Cap at 4 (retroarch supports up to 16 but no kiosk game needs more)
[ "$NUM_USERS" -gt 4 ] && NUM_USERS=4

{
  echo "input_max_users = \"$NUM_USERS\""
  if [ -n "$JOYPAD_INDEX" ] && [[ "$JOYPAD_INDEX" =~ ^[0-9]+$ ]]; then
    echo "input_player1_joypad_index = \"$JOYPAD_INDEX\""
  fi

  # Select (btn 8) + Start (btn 9) = exit back to the game list, matching
  # the Pi 4 combo. Select stays usable as a normal in-game button; only
  # the Select+Start combo quits. Exiting RetroArch drops the player back
  # to the picker (the Flask backend sees the process end).
  echo 'input_enable_hotkey_btn = "8"'
  echo 'input_exit_emulator_btn = "9"'

  # PS1-style pads share the 0810:e501 chip with the 2-button NES pads, so
  # RetroArch can't auto-distinguish them. Map per-GAME instead: a PS1 game
  # forces the full PS1 button layout for Player 1; every other system uses
  # the device's NES autoconfig (B=btn0, A=btn1). Lets both pads work —
  # the right map is picked by what's being played.
  if [ "$SYSTEM" = "ps1" ]; then
    cat <<'PS1MAP'
input_player1_b_btn = "2"
input_player1_a_btn = "1"
input_player1_y_btn = "3"
input_player1_x_btn = "0"
input_player1_l_btn = "6"
input_player1_r_btn = "7"
input_player1_l2_btn = "4"
input_player1_r2_btn = "5"
input_player1_select_btn = "8"
input_player1_start_btn = "9"
input_player1_up_axis = "-1"
input_player1_down_axis = "+1"
input_player1_left_axis = "-0"
input_player1_right_axis = "+0"
PS1MAP
  fi
} > "$OVERRIDE_CFG"

exec retroarch --appendconfig "$OVERRIDE_CFG" -L "$CORE_PATH" "$ROM_PATH"
