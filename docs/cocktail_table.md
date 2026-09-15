# Cocktail-table mode

A cocktail (or "table") cabinet lies flat: the screen faces up under glass and
players sit on stools on opposite sides. Pac-Man and Ms. Pac-Man are the
cabinets most people picture.

## The problem this mode does and does not solve

Real cocktail cabinets handled the two-sided seating in one of three ways:

1. **Flip the screen between turns.** Alternating play only. This is what
   Pac-Man did, and it is the one that actually works for a shared display.
2. **Design the game so orientation does not matter.** Atari's *Warlords*
   (1980) is the canonical example — four players, one per side, each
   defending their own corner, nobody upside down.
3. **Give each player their own screen.** Nintendo's VS. DualSystem (1984)
   was two monitors back to back.

That middle category is essentially **absent from the NES library**. NES games
render one fixed orientation, so a simultaneous two-player game on a flat
table means one player reads it upside down, full stop. No amount of software
fixes that — which is why `tabletop.json` ships with an empty `either_side`
list rather than a padded one.

So the honest split for this kiosk is:

| Seating | Meaning | Badge |
|---|---|---|
| `alternating` | Turn-based. Flip the screen between turns; opposite seats work. | TAKE TURNS |
| `same-side` | Simultaneous. Both players sit on the **same** side. | SIT TOGETHER |
| `either-side` | Orientation-agnostic. Opposite seats, no flip. | ANY SEAT |

Unlisted games default to `same-side`, which is the safe assumption.

## Using it

Two independent URL parameters on the picker:

```
http://pi-arcade.local:8088/?table=1            # filter to opposite-seat-friendly games
http://pi-arcade.local:8088/?rotate=2           # flip RetroArch output 180 on every launch
http://pi-arcade.local:8088/?table=1&rotate=2   # both
http://pi-arcade.local:8088/?system=nes&table=1 # composes with the system filter
```

They are separate on purpose. A table can be worth filtering for without a
flip — if the panel already faces whoever is picking — and a rotated panel may
still want the whole library.

`rotate` is RetroArch's `video_rotation`, in 90-degree steps:

| Value | Result |
|---|---|
| `0` | as mounted |
| `1` | 90° |
| `2` | 180° — the player opposite |
| `3` | 270° |

`1` and `3` matter if you mount the panel portrait, which is how the original
Pac-Man cocktail monitor sat. Anything outside `0`–`3` is ignored and the
cabinet keeps its configured orientation, so the upright install is unaffected.

`video_allow_rotate` is forced on alongside it — without that, NES cores
report a 0-degree preference and override the setting.

## Classifying a game

Edit `backend/tabletop.json`, which matches on the slugified clean title
(`Micro Machines (U) [!].nes` → `micro-machines`), so ROM dump suffixes do not
matter. For a ROM whose title does not match, add `"seating"` to its entry in
`games.json` — a per-ROM override wins over the curated list.

## Hardware notes

Square TVs are not made any more, and you do not want a TV regardless. Pac-Man's
monitor is 4:3 mounted **portrait**. The cheap modern substitute is a 4:3
(1024×768) or 5:4 (1280×1024) LCD computer monitor — old office panels are
plentiful — or a current 4:3 industrial/signage panel. Either avoids the
high-voltage hazard of working inside a CRT.

## Not yet built

Auto-flip between turns. The kiosk sets rotation once per launch; it does not
watch the game and flip at a turn boundary, which would need per-title memory
inspection. For now `alternating` games start in one orientation and players
either flip manually or agree to lean.
