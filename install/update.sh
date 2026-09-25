#!/bin/bash
# Pull the latest code onto a cabinet. Run this ON the Pi.
#
#   ~/pi_arcade_kiosk/install/update.sh
#
# Both repos, then a restart. ROMs, play counts and parent settings are never
# touched: plays.json and prefs.json are gitignored precisely so an update
# cannot reset the cabinet's history.
set -euo pipefail
KIOSK="$(cd "$(dirname "$0")/.." && pwd)"
GAMES="$HOME/table-arcade"

for repo in "$KIOSK" "$GAMES"; do
  [ -d "$repo/.git" ] || { echo "skipping $repo (not a git checkout)"; continue; }
  echo "==> $(basename "$repo")"
  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    echo "    local changes present, leaving alone:"
    git -C "$repo" status --short | sed 's/^/      /'
    continue
  fi
  git -C "$repo" pull --ff-only | sed 's/^/    /'
done

sudo systemctl restart pi-arcade
sleep 3
echo "picker: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8088/)"
echo "table:  HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8088/table/games/pinball/index.html)"
