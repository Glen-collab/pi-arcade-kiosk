#!/bin/bash
# Fresh Raspberry Pi -> working cocktail cabinet, in one command.
#
#   curl -sL https://raw.githubusercontent.com/Glen-collab/pi-arcade-kiosk/cocktail-table/install/bootstrap.sh | bash
#
# Starts from a stock Raspberry Pi OS (64-bit, Desktop) install with SSH and
# network already working, and ends with a cabinet that boots into the picker.
# Everything except the ROMs, which are copyrighted and cannot live in a repo —
# see sync_roms.sh for moving those from the first cabinet.
#
# Safe to re-run. Every step checks before it acts, so this doubles as a repair
# tool when a cabinet drifts: run it again and it puts back whatever is missing
# without touching play counts or parent settings.
set -euo pipefail

KIOSK_REPO="https://github.com/Glen-collab/pi-arcade-kiosk.git"
KIOSK_BRANCH="cocktail-table"
GAMES_REPO="https://github.com/Glen-collab/table-arcade.git"

USER_NAME="${SUDO_USER:-$USER}"
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)
KIOSK_DIR="$USER_HOME/pi_arcade_kiosk"
GAMES_DIR="$USER_HOME/table-arcade"
ARCH=$(dpkg --print-architecture)
LIBRETRO_DIR="/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/libretro"

if [ "$EUID" -eq 0 ] && [ -z "${SUDO_USER:-}" ]; then
  echo "Run this as the pi user, not as root. It will sudo where it needs to."
  exit 1
fi

say() { echo ""; echo "==> $*"; }

# --- 1. packages ------------------------------------------------------------
# chromium (not chromium-browser: that is the old Bullseye name and does not
# exist on Bookworm/Trixie), ddcutil for monitor brightness over HDMI, and
# wireplumber because volume is set with wpctl.
say "Installing packages"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  git curl unzip rsync \
  retroarch libretro-nestopia libretro-snes9x libretro-mgba \
  chromium python3-flask \
  labwc wlr-randr ddcutil wireplumber

# --- 2. repos ---------------------------------------------------------------
# A directory that exists but is not a checkout is the normal state of the
# FIRST cabinet, which was built by copying files over SSH long before any of
# this was in git. Clone alongside and move the git metadata in, so the working
# tree — with its ROMs, play counts and parent settings — survives being
# adopted rather than being cloned over the top of.
adopt() {
  local dir="$1" repo="$2" branch="${3:-}"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch -q origin
    [ -n "$branch" ] && git -C "$dir" checkout -q "$branch"
    git -C "$dir" pull -q --ff-only || echo "    (diverged or local changes — left alone)"
  elif [ -d "$dir" ]; then
    echo "    adopting existing $dir"
    local tmp
    tmp=$(mktemp -d)
    if [ -n "$branch" ]; then
      git clone -q -b "$branch" "$repo" "$tmp/c"
    else
      git clone -q "$repo" "$tmp/c"
    fi
    mv "$tmp/c/.git" "$dir/.git"
    rm -rf "$tmp"
    git -C "$dir" reset -q     # tree untouched; git now reports what differs
  else
    if [ -n "$branch" ]; then
      git clone -q -b "$branch" "$repo" "$dir"
    else
      git clone -q "$repo" "$dir"
    fi
  fi
}

say "Fetching the kiosk"
adopt "$KIOSK_DIR" "$KIOSK_REPO" "$KIOSK_BRANCH"

say "Fetching the table games"
adopt "$GAMES_DIR" "$GAMES_REPO"

mkdir -p "$KIOSK_DIR/roms/nes" "$KIOSK_DIR/roms/snes" "$KIOSK_DIR/roms/n64" "$KIOSK_DIR/roms/gba"
chmod +x "$KIOSK_DIR"/launcher/*.sh "$KIOSK_DIR"/install/*.sh

# --- 3. RetroArch -----------------------------------------------------------
say "Configuring RetroArch"
mkdir -p "$USER_HOME/.config/retroarch"
# Never silently overwrite a live config: RetroArch rewrites this file itself
# and it ends up carrying per-cabinet input binds. Back it up first so a re-run
# on a working cabinet is always recoverable.
if [ -f "$USER_HOME/.config/retroarch/retroarch.cfg" ] && \
   ! cmp -s "$KIOSK_DIR/install/retroarch.cfg" "$USER_HOME/.config/retroarch/retroarch.cfg"; then
  cp "$USER_HOME/.config/retroarch/retroarch.cfg" \
     "$USER_HOME/.config/retroarch/retroarch.cfg.bak.$(date +%s)"
fi
cp "$KIOSK_DIR/install/retroarch.cfg" "$USER_HOME/.config/retroarch/retroarch.cfg"

# Joypad profiles. Without these RetroArch reports "not configured" for every
# pad and no button does anything — including the combo that quits back to the
# picker, so the cabinet locks up on the first launch. ~430 profiles, one
# download.
AUTOCFG="$USER_HOME/.config/retroarch/autoconfig"
mkdir -p "$AUTOCFG"
if [ -z "$(ls -A "$AUTOCFG" 2>/dev/null)" ]; then
  say "Installing controller profiles"
  curl -sL https://github.com/libretro/retroarch-joypad-autoconfig/archive/refs/heads/master.tar.gz \
    -o /tmp/jpcfg.tar.gz
  tar xzf /tmp/jpcfg.tar.gz -C /tmp
  cp /tmp/retroarch-joypad-autoconfig-master/udev/*.cfg "$AUTOCFG/"
  rm -rf /tmp/jpcfg.tar.gz /tmp/retroarch-joypad-autoconfig-master
  echo "    $(ls "$AUTOCFG"/*.cfg | wc -l) profiles"
fi

# The cocktail shader. launch_game.sh looks for it at
# ~/.config/retroarch/shaders/cocktail-2p.glslp and, when it is missing, runs
# the game perfectly well WITHOUT the split — the worst kind of failure,
# because nothing errors and the cabinet merely looks wrong. On the first
# cabinet this was copied here by hand and never written down.
say "Installing the cocktail shader"
mkdir -p "$USER_HOME/.config/retroarch/shaders"
cp "$KIOSK_DIR/shaders/"cocktail-2p.glsl* "$USER_HOME/.config/retroarch/shaders/"

# N64 core is not packaged by Debian; pull the nightly build.
if [ ! -f "$LIBRETRO_DIR/parallel_n64_libretro.so" ]; then
  say "Installing parallel_n64 core"
  if curl -sfL "https://buildbot.libretro.com/nightly/linux/${ARCH/arm64/aarch64}/latest/parallel_n64_libretro.so.zip" \
       -o /tmp/pn64.zip; then
    sudo unzip -oq /tmp/pn64.zip -d "$LIBRETRO_DIR/"
  else
    echo "    (skipped: buildbot unreachable, N64 will be unavailable)"
  fi
  rm -f /tmp/pn64.zip
fi

# --- 4. autostart -----------------------------------------------------------
# The USER copy at ~/.config/labwc/autostart overrides /etc/xdg/labwc/autostart,
# which is where Raspberry Pi OS keeps the desktop and taskbar. Dropping ours
# here silently replaces both with Chromium and leaves the stock file intact,
# so deleting this one file gives the normal desktop back.
say "Installing kiosk autostart"
mkdir -p "$USER_HOME/.config/labwc"
sed "s|/home/pi/pi_arcade_kiosk|$KIOSK_DIR|g" \
  "$KIOSK_DIR/install/labwc-autostart" > "$USER_HOME/.config/labwc/autostart"
chmod +x "$USER_HOME/.config/labwc/autostart"

# --- 5. service -------------------------------------------------------------
say "Installing the picker service"
sed "s|__PROJECT_DIR__|$KIOSK_DIR|g; s|__USER__|$USER_NAME|g" \
  "$KIOSK_DIR/install/pi-arcade.service" | sudo tee /etc/systemd/system/pi-arcade.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable -q pi-arcade
sudo systemctl restart pi-arcade

# --- 6. check ---------------------------------------------------------------
say "Checking"
ok=1
code=""
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/ || true)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" = "200" ]; then echo "    picker responds (HTTP 200)"
else echo "    PICKER NOT RESPONDING"; ok=0; fi

tcode=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/table/games/pinball/index.html || true)
if [ "$tcode" = "200" ]; then echo "    table games served"
else echo "    TABLE GAMES MISSING (is $GAMES_DIR populated?)"; ok=0; fi

if [ -f "$USER_HOME/.config/retroarch/shaders/cocktail-2p.glslp" ]; then
  echo "    cocktail shader installed"
else
  echo "    COCKTAIL SHADER MISSING"; ok=0
fi

for c in nestopia_libretro.so snes9x_libretro.so; do
  if [ -f "$LIBRETRO_DIR/$c" ]; then echo "    core $c"
  else echo "    MISSING CORE $c"; ok=0; fi
done

nes=$(ls -1 "$KIOSK_DIR/roms/nes" 2>/dev/null | wc -l)
snes=$(ls -1 "$KIOSK_DIR/roms/snes" 2>/dev/null | wc -l)
echo "    ROMs: $nes NES, $snes SNES"

echo ""
if [ "$ok" = "1" ]; then
  echo "Cabinet is installed."
else
  echo "Installed WITH PROBLEMS — see the lines above."
fi
if [ "$((nes + snes))" -eq 0 ]; then
  echo ""
  echo "No ROMs yet. From the first cabinet, run:"
  echo "    ~/pi_arcade_kiosk/install/sync_roms.sh $USER_NAME@$(hostname).local"
fi
echo "Reboot to come up in the cabinet: sudo reboot"
