#!/bin/bash
# Push code to a running cabinet WITHOUT clobbering its runtime state.
#
# plays.json and prefs.json are written by the kiosk as it runs. Copying the
# repo over the top wipes the play counts feeding the MOST PLAYED section and
# resets the parent's game limit. Learned the hard way: several deploys in a
# row silently reset the counters, and it only surfaced when the "most played"
# cut started returning games nobody had played.
set -euo pipefail
HOST="${1:-pi@pi-cocktail.local}"
cd "$(dirname "$0")/.."
tar --exclude='backend/plays.json' --exclude='backend/prefs.json' \
    --exclude='backend/__pycache__' --exclude='roms' \
    -czf - backend frontend launcher shaders install docs \
  | ssh -4 -o BatchMode=yes "$HOST" 'tar -xzf - -C ~/pi_arcade_kiosk'
ssh -4 -o BatchMode=yes "$HOST" 'sudo systemctl restart pi-arcade'
echo "deployed to $HOST (runtime state preserved)"
