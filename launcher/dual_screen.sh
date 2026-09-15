#!/bin/bash
# Two-screen cocktail mode: one game, two displays, one of them rotated 180
# so players sitting opposite each other both read it right-way-up.
#
#   dual_screen.sh --check     verify the host can do this at all, change nothing
#   dual_screen.sh --start     apply the transform and start mirroring
#   dual_screen.sh --stop      stop mirroring and put the transform back
#
# Deliberately independent of launch_game.sh. The mirror duplicates whatever
# is on the primary output — the picker, RetroArch, the desktop — so it starts
# once and survives every launch and quit. Tying it to the game lifecycle would
# mean tearing down and rebuilding the mirror on every single launch for no
# gain.
#
# Why mirroring and not two emulator instances: the second screen shows the
# SAME match. One RetroArch, one game state, nothing to keep in sync, no added
# input latency. Netplay between two local instances would reach the same
# picture and pay frame-buffer latency for the privilege.
#
# Environment overrides:
#   DS_PRIMARY    output the game renders on      (default: first connected)
#   DS_SECONDARY  output to mirror onto           (default: second connected)
#   DS_TRANSFORM  transform for the mirror        (default: 180)

set -u

PRIMARY="${DS_PRIMARY:-}"
SECONDARY="${DS_SECONDARY:-}"
TRANSFORM="${DS_TRANSFORM:-180}"
PIDFILE="/tmp/pi-arcade-dual-screen.pid"

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "  $*"; }

# labwc is wlroots-based, so the session must actually be Wayland for any of
# this to work. An X11 session would need a completely different approach.
ensure_wayland_env() {
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
}

# Connected output names, in the order wlr-randr reports them. Output lines are
# unindented; mode and property lines beneath them are indented, which is what
# separates them here.
list_outputs() {
  wlr-randr 2>/dev/null | grep -E '^[^ ]' | awk '{print $1}'
}

resolve_outputs() {
  local outs
  mapfile -t outs < <(list_outputs)
  [ "${#outs[@]}" -ge 1 ] || die "wlr-randr reported no outputs. Is this a Wayland session?"
  [ -n "$PRIMARY" ]   || PRIMARY="${outs[0]}"
  if [ -z "$SECONDARY" ]; then
    [ "${#outs[@]}" -ge 2 ] || die "Only one output (${outs[0]}). Plug in the second HDMI, or set DS_SECONDARY."
    SECONDARY="${outs[1]}"
  fi
  [ "$PRIMARY" != "$SECONDARY" ] || die "PRIMARY and SECONDARY are both $PRIMARY."
}

# wl-mirror's flag names have moved between releases, so ask the binary what it
# supports rather than assuming. Everything downstream branches on these.
probe_mirror_flags() {
  MIRROR_HELP="$(wl-mirror --help 2>&1 || true)"
  HAS_TRANSFORM=0; HAS_FULLSCREEN=0; HAS_FS_OUTPUT=0
  grep -q -- '--transform'         <<<"$MIRROR_HELP" && HAS_TRANSFORM=1
  grep -q -- '--fullscreen'        <<<"$MIRROR_HELP" && HAS_FULLSCREEN=1
  grep -q -- '--fullscreen-output' <<<"$MIRROR_HELP" && HAS_FS_OUTPUT=1
}

build_mirror_cmd() {
  MIRROR_CMD=(wl-mirror)
  [ "$HAS_TRANSFORM" = 1 ]  && MIRROR_CMD+=(--transform "$TRANSFORM")
  [ "$HAS_FULLSCREEN" = 1 ] && MIRROR_CMD+=(--fullscreen)
  [ "$HAS_FS_OUTPUT" = 1 ]  && MIRROR_CMD+=(--fullscreen-output "$SECONDARY")
  MIRROR_CMD+=("$PRIMARY")
}

do_check() {
  local fail=0
  echo "== Session"
  ensure_wayland_env
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    note "WAYLAND_DISPLAY=$WAYLAND_DISPLAY  (ok)"
  else
    note "no Wayland socket found — X11 session? this mode needs Wayland/labwc"; fail=1
  fi

  echo "== Tools"
  if command -v wlr-randr >/dev/null 2>&1; then
    note "wlr-randr  $(command -v wlr-randr)"
  else
    note "wlr-randr  MISSING   -> sudo apt install wlr-randr"; fail=1
  fi
  if command -v wl-mirror >/dev/null 2>&1; then
    note "wl-mirror  $(command -v wl-mirror)"
  else
    note "wl-mirror  MISSING   -> not in Pi OS apt; build from"
    note "           https://github.com/Ferdi265/wl-mirror"
    fail=1
  fi

  echo "== Outputs"
  if command -v wlr-randr >/dev/null 2>&1; then
    local outs; mapfile -t outs < <(list_outputs)
    if [ "${#outs[@]}" -eq 0 ]; then
      note "none reported"; fail=1
    else
      for o in "${outs[@]}"; do note "$o"; done
      [ "${#outs[@]}" -ge 2 ] || { note "need 2, found ${#outs[@]} — plug in the second HDMI"; fail=1; }
    fi
  fi

  echo "== wl-mirror capabilities"
  if command -v wl-mirror >/dev/null 2>&1; then
    probe_mirror_flags
    note "--transform         $([ "$HAS_TRANSFORM" = 1 ] && echo yes || echo 'NO — cannot rotate the mirror; this mode will not work')"
    note "--fullscreen        $([ "$HAS_FULLSCREEN" = 1 ] && echo yes || echo 'no — will open windowed, needs a labwc rule')"
    note "--fullscreen-output $([ "$HAS_FS_OUTPUT" = 1 ] && echo yes || echo 'no — cannot pin to the second screen itself')"
    [ "$HAS_TRANSFORM" = 1 ] || fail=1
  else
    note "skipped (wl-mirror missing)"
  fi

  echo "== Command that --start would run"
  if [ "$fail" = 0 ]; then
    resolve_outputs; build_mirror_cmd
    note "game on:   $PRIMARY"
    note "mirror on: $SECONDARY  (transform $TRANSFORM)"
    note "${MIRROR_CMD[*]}"
    echo
    echo "READY — run: $0 --start"
  else
    echo
    echo "NOT READY — fix the items above first. Nothing was changed."
  fi
  return "$fail"
}

do_start() {
  ensure_wayland_env
  command -v wlr-randr >/dev/null 2>&1 || die "wlr-randr not installed (run --check)"
  command -v wl-mirror >/dev/null 2>&1 || die "wl-mirror not installed (run --check)"
  resolve_outputs
  probe_mirror_flags
  [ "$HAS_TRANSFORM" = 1 ] || die "this wl-mirror has no --transform; it cannot rotate (run --check)"

  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already mirroring (pid $(cat "$PIDFILE"))"; return 0
  fi

  # Make sure the second output is on and untransformed. The rotation is
  # applied by wl-mirror to the mirrored image, not to the output — rotating
  # the output too would cancel it back out.
  wlr-randr --output "$SECONDARY" --on --transform normal >/dev/null 2>&1 || true

  build_mirror_cmd
  echo "mirroring $PRIMARY -> $SECONDARY (transform $TRANSFORM)"
  "${MIRROR_CMD[@]}" >/tmp/pi-arcade-dual-screen.log 2>&1 &
  echo $! > "$PIDFILE"
  sleep 1
  if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "started (pid $(cat "$PIDFILE"))"
  else
    rm -f "$PIDFILE"
    die "wl-mirror exited immediately — see /tmp/pi-arcade-dual-screen.log"
  fi
}

do_stop() {
  ensure_wayland_env
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "mirror stopped"
  else
    pkill -f '^wl-mirror' 2>/dev/null && echo "mirror stopped (by name)" || echo "not running"
  fi
  if [ -n "$SECONDARY" ] && command -v wlr-randr >/dev/null 2>&1; then
    wlr-randr --output "$SECONDARY" --transform normal >/dev/null 2>&1 || true
  fi
}

case "${1:---check}" in
  --check) do_check ;;
  --start) do_start ;;
  --stop)  do_stop ;;
  *) echo "usage: $0 [--check|--start|--stop]" >&2; exit 2 ;;
esac
