#!/bin/bash
# Bring up the picker in Chromium kiosk mode on the cocktail table.
#
# --password-store=basic is not optional: without it Chromium tries to create a
# GNOME keyring on first run and blocks on a "choose a password" dialog that
# nobody can answer on a cabinet with no keyboard.
#
# Note for anyone editing this over SSH: do not pkill -f on a pattern that also
# appears in your own command line. pkill matches the whole command line, so
# `pkill -f chromium` run from a shell whose command contains "chromium" kills
# that shell. Hence pkill -x, which matches the process name only.
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$(basename "$sock")" in *.lock) continue ;; esac
    [ -S "$sock" ] && export WAYLAND_DISPLAY="$(basename "$sock")" && break
  done
fi

URL="${1:-http://localhost:8088/?table=1}"

pkill -x chromium 2>/dev/null
pkill -x gcr-prompter 2>/dev/null
sleep 2

exec chromium \
  --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --password-store=basic --use-mock-keychain \
  --disable-session-crashed-bubble --disable-features=Translate \
  --ozone-platform=wayland "$URL"
