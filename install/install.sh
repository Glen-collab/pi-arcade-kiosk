#!/bin/bash
# Superseded by bootstrap.sh, kept because several docs and a lot of muscle
# memory still say "sudo bash install/install.sh".
#
# The old version of this file installed the Pi Zero 2 W / NES-only build and
# knew nothing about Chromium, labwc, the table games or the cocktail shader.
# Running it on a cocktail cabinet left a half-configured machine that looked
# installed. One installer, one behaviour — so this just forwards.
exec bash "$(dirname "$0")/bootstrap.sh" "$@"
