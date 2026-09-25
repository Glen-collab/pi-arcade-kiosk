#!/bin/bash
# Copy a cabinet's ROM library to another cabinet.
#
#   ~/pi_arcade_kiosk/install/sync_roms.sh pi@pi-cocktail2.local
#
# Run this ON the cabinet that already has the games. ROMs are copyrighted and
# will never be in the repo, so this is the only supported way to populate a
# second table. ~700 MB over wifi takes a few minutes.
#
# rsync, not scp: it resumes. A dropped wifi connection three quarters of the
# way through 1,268 files should cost you the rest of the transfer, not all
# of it.
set -euo pipefail
DEST="${1:?usage: sync_roms.sh user@host}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/roms/"

command -v rsync >/dev/null || { echo "installing rsync"; sudo apt-get install -y -qq rsync; }

echo "Copying $(du -sh "$SRC" | cut -f1) to $DEST"
# -4 because the .local name can resolve to an IPv6 link-local address that
# silently hangs instead of failing.
rsync -a --info=progress2 --partial \
      -e "ssh -4 -o BatchMode=yes" \
      "$SRC" "$DEST:pi_arcade_kiosk/roms/"

echo ""
echo "Rebuilding the game list on $DEST"
ssh -4 -o BatchMode=yes "$DEST" 'sudo systemctl restart pi-arcade'
ssh -4 -o BatchMode=yes "$DEST" '
  sleep 3
  for s in nes snes; do
    echo "  $s: $(ls -1 ~/pi_arcade_kiosk/roms/$s 2>/dev/null | wc -l) files"
  done
  echo "  picker: HTTP $(curl -s -o /dev/null -w "%{http_code}" http://localhost:8088/)"'
