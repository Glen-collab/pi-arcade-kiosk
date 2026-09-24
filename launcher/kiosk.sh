#!/bin/bash
# Bring up whatever the cabinet should currently be showing.
#
# The URL and screen rotation are read from files rather than passed as
# arguments, because the autostart respawn loop also owns Chromium. Anything
# that launches its own browser gets killed by the loop within seconds; the
# only way to change what is displayed is to change what the loop reads and
# then let it respawn. Same shape as bsa-tv-kiosk's /tmp/bsa-mode.
#
#   /tmp/kiosk-url      URL to show      (default: the picker)
#   /tmp/kiosk-rotate   wlr-randr transform: normal|90|180|270
#
# Note for anyone editing this over SSH: never pkill -f on a pattern that also
# appears in your own command line — pkill matches the whole command line,
# including the shell you are typing in. Hence pkill -x.
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$(basename "$sock")" in *.lock) continue ;; esac
    [ -S "$sock" ] && export WAYLAND_DISPLAY="$(basename "$sock")" && break
  done
fi

PICKER="http://localhost:8088/?table=1"
URL="$(cat /tmp/kiosk-url 2>/dev/null || true)"
[ -z "$URL" ] && URL="$PICKER"
ROT="$(cat /tmp/kiosk-rotate 2>/dev/null || true)"
case "$ROT" in normal|90|180|270) ;; *) ROT="normal" ;; esac

OUT="$(wlr-randr 2>/dev/null | grep -m1 '^HDMI' | awk '{print $1}')"
[ -n "$OUT" ] && wlr-randr --output "$OUT" --transform "$ROT" >/dev/null 2>&1

pkill -x chromium 2>/dev/null
pkill -x gcr-prompter 2>/dev/null
sleep 2

# --password-store=basic is not optional: without it Chromium blocks on a
# "choose a password for the new keyring" dialog that nobody can answer on a
# cabinet with no keyboard.
exec chromium \
  --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --password-store=basic --use-mock-keychain \
  --disable-session-crashed-bubble --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --ozone-platform=wayland "$URL"
