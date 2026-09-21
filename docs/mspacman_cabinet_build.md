# Ms. Pac-Man cocktail refab — build plan

Status: **phase 1 in progress.** The two-player shader is written
(`shaders/cocktail-2p.glslp`) and its geometry is verified in simulation, but
it has not run in RetroArch on real hardware yet. No cabinet work started.

`launcher/dual_screen.sh --check` is a preflight for a two-monitor approach
this plan superseded — kept because it still answers a useful question
cheaply, not because it is the path.

The target: a cocktail cabinet running a Pi 4, with two players sitting
opposite each other and both reading the same game right-way-up on one screen.
Street Fighter across the table.

The cabinet is an original Ms. Pac-Man cocktail, but **cutting it or building a
new one are both on the table**, so the cabinet does not constrain the design.

**Agreed sequencing: prove the software first.** Nothing gets bought, cut or
built until the shader demonstrably works. Pi 4 pending.

### Phases

**Phase 1 — two players, hardware already owned.** A Dell S2440L (24", 1080p,
IPS, 12V 3.33A brick) Glen already has. Two seats at the short ends. This is
what gets built.

**Later, if phase 1 earns it.** Four players around the table with views at
0/90/180/270 — the shader is written with the split parameterised, so it is
the same code path. Four-player wants a bigger panel: on a 24" each player
gets about 8 x 6 in, on a 32" about the same, and only a 43" makes it roomy.
It also wants an **arcade core** in the kiosk, because the four-player Turtles
games (TMNT: The Arcade Game, Turtles in Time) and Gauntlet II are arcade
ROMs, not console ports — `ALLOWED_SYSTEMS` has no MAME/FBNeo entry yet.
A pool-table layout with recessed drink holders in the rails is the target
form. **Do not cut drink holes over the electronics bay** — put them outboard
of the glass, sealed, draining outside.

---

## What the original cabinet gives us

If it is kept largely intact, the hard physical problems are already solved:

- **Two control panels on opposite sides.** The seating we want is the seating
  it was built for.
- **A portrait monitor bay.** Ms. Pac-Man is a vertical game, so the screen's
  long axis already runs player to player — which suits the fallback layout
  below without any modification.
- **Glass top, finished cabinet, stools.** None of which we have to make.

One nice bit of symmetry: the original flipped the screen between turns because
alternating play was all the hardware could manage. Same cabinet, same seats,
and the shader lets both players play at once.

---

## Display — two layouts, decided by measurement

The cabinet is no longer a constraint: building a new one is on the table, as
is cutting the original. So pick the layout on merit, then decide the cabinet.

### Primary: 24" landscape, split down the middle, halves rotated 90° apart

Split a 24" 16:9 panel into two 960x1080 halves and rotate each **90 degrees in
opposite directions**. Players sit at the two short ends, facing each other
along the panel's long axis. From any other angle both halves look sideways and
point away from each other, which is exactly why it reads correctly from the
two seats.

### Fallback: 19" portrait, split near/far, far half rotated 180°

What the original bay takes without modification. The screen's long axis runs
player to player, so each band comes out landscape.

| Layout | Panel size | Per-player pixels | 4:3 game | Physical |
|---|---|---|---|---|
| 24" 16:9, 90° apart | 20.9 x 11.8 in | 1080x960 | 1080x810 | ~11.8 x 8.9 in |
| 19" 5:4 portrait, 180° | 14.8 x 11.9 in | 1024x640 | 853x640 | ~9.9 x 7.4 in |
| 22" 16:9, 90° apart | 19.1 x 10.7 in | 1080x870 | 1080x810 | ~10.7 x 8.0 in |

The 24" gives roughly **60% more picture per player** and uses the full 1080 in
the dimension that matters. The portrait split wastes resolution.

### The fit problem, if the original cabinet is kept intact

A 24" panel is ~20.9 in long; the bay was cut for a 19" CRT at ~15.2 x 11.4 in.
Depth is nearly identical, length is about **5.7 in over**. The custom cabinets
that run 24" monitors were built around the monitor.

Two things to check before concluding 24" needs cutting:

- **Measure the carcass, not just the aperture.** The opening is usually
  smaller than the interior. If the box is wide enough, the job is bezel and
  glass rather than structural wood.
- **A 22" panel is ~19.1 x 10.7 in**, and 20" 16:9 panels are smaller again.
  One may clear the existing opening while still beating the portrait split.

Either way a flat panel is far shallower than the CRT, so expect to build a
plywood or bracket adapter to shim it up near the glass. Too low and the
picture looks sunken and catches reflections off the underside.

## How both players see it right-way-up: the split shader

**One RetroArch instance, one panel, one shader.**

RetroArch's final shader pass maps the game's framebuffer onto the output
viewport, and a fragment shader controls that mapping per pixel. Write one that
samples the source texture twice, once per player's half. The rotation depends
on the layout: 90 degrees in opposite directions for the 24" split, or 0 and
180 for the portrait split. One game, one state, drawn twice in the same frame.

The two are the same shader with a different mapping — a 90 degree rotation
swaps the axes when sampling where 180 negates both. Writing it parameterised
costs nothing and means the layout decision does not have to be final.

Costs one extra texture sample per pixel — nothing on a Pi 4. No second
monitor, no compositor tricks, no netplay, no added input latency.

Implementation notes for when it gets written:

- Set RetroArch's aspect to **fill** and let the shader do the letterboxing
  inside each band. Fighting RetroArch's own aspect correction while the shader
  is also positioning things is how this gets confusing.
- Band split is cleanest when the panel's long dimension divides evenly in two.
- It is the same image twice, not two views. That is correct for this cabinet:
  Street Fighter, Bomberman and Micro Machines all legitimately show both
  players the same picture anyway.

**Not written yet.** This is the next build step.

---

## The shader

`shaders/cocktail-2p.glslp` + `cocktail-2p.glsl`.

Splits the viewport left/right and draws the same frame into each half rotated
90 degrees in opposite directions, for players seated at the two short ends.
Letterboxing is done inside the shader, per half, because RetroArch would
otherwise letterbox the panel once as a whole.

On a 1920x1080 panel each player gets a 1080x810 image with 75px of black
either side of their half — about 15% of the panel unused, which is the cost
of fitting 4:3 into a half-panel.

**GLSL, not .slang.** The Pi 4's V3D stack does not give RetroArch a glcore
context, and the `gl` driver the kiosk already configures loads `.glsl`.

RetroArch also needs `video_force_aspect = "false"` so the viewport is the
whole screen — otherwise RetroArch letterboxes first and the shader only sees
the letterboxed region.

### Verified so far

The fragment maths was replayed in a simulation against an asymmetric test
frame and the layout is correct: each half puts the game's "up" away from its
own player, and left/right land on the right hands. **Not yet run in
RetroArch** — that is the next step, and it needs nothing but the monitor and
a Windows RetroArch install.

---

## Input — open

Decision deferred until the cabinet has been opened and measured. Options on
the table:

1. **Rebuild the control panels** with arcade sticks and buttons. Most
   faithful to the cabinet, most work.
2. **Embed a gamepad** into each panel position.
3. **Store controllers under the cabinet** and pull them out to play.
4. **External arcade stick(s)** plugged in as needed.

Whatever the choice, a **USB encoder board** (Zero Delay or similar, roughly
$12 a side) turns sticks and buttons into a standard USB gamepad — which is
exactly what the kiosk already expects. No changes to the launch path.

Two things that will matter whichever route wins:

- **The original panels have a 4-way joystick and no fire buttons.** Start
  buttons are on the cabinet side. Fine for Pac-Man, useless for Street
  Fighter, which needs six.
- **If rebuilding, cut new panels and keep the originals intact.** They are
  getting harder to find and an unmolested pair is worth keeping in a box.
- A 4-way restrictor is *correct* for Ms. Pac-Man and *wrong* for Street
  Fighter, which wants 8-way. Decent sticks have a swappable restrictor plate.

---

## Before touching the CRT

**Discharge it, or hand it to someone who has done it before.** A CRT anode
holds a lethal charge long after the cabinet is unplugged, and twenty years in
a garage does not change that. This is the one genuinely dangerous step in the
project.

If you are not set up for it, pulling the whole chassis out intact and handing
it off is a perfectly good answer.

---

## Approaches considered and rejected

Recorded so they do not get re-litigated.

**Two displays, mirrored, one rotated 180°.** One RetroArch, output mirrored to
a second screen with a transform. Works, and gives each player a full screen
rather than half. Rejected here because this cabinet has one monitor bay and
two seats already facing each other — a second panel solves a problem the
cabinet does not have. Would need `wl-mirror` built from source, the least
certain dependency in any of these plans. `launcher/dual_screen.sh --check`
still tests for it.

**Netplay between two local instances.** Two RetroArch processes synced over
`127.0.0.1`. Reaches the same picture and pays frame-buffer latency for it —
landing that latency in fighting games, the genre least able to absorb it. The
shader gets there with one game state and no sync at all.

**Two independent instances.** Two unsynced games, own band each, race on
score. No shared match, so no good for Street Fighter. Possibly worth having
later for Tetris or Excitebike.

**A custom compositor** that grabs the frame and blits it twice rotated. This
is what the shader does, one layer down and for a fraction of the work. The
earlier conclusion that one panel "needs custom compositing, and that's a
project" was right about the compositor and wrong to stop there.

**PBP monitors.** Two HDMI *inputs* usually means two sources you switch
between, not two shown at once. Picture-by-Picture is the feature that actually
splits a panel, it is mostly found on ultrawides, and it typically splits
left/right rather than the near/far a table wants. Moot here anyway — the
cabinet's panel is whatever we fit to the bay.

---

## The hard limit worth remembering

**A single emulated game cannot give two players differently-oriented *views*.**
A libretro core hands RetroArch one framebuffer — the exact image the console
produced. There is no second camera to split off, because the hardware never
rendered one.

The shader duplicates and rotates that one image, which is the right answer for
shared-view games. It is not split-screen in the Mario Kart sense and cannot
become it. Games with native split-screen render their own two viewports into
that single image; each player can read their own viewport in their own band.

The arcade industry hit the same wall. When they wanted fighting games with
players facing each other, they used two cabinets and two screens — Nintendo's
VS. DualSystem in 1984, Sega's Versus City in the '90s. Nobody shipped
face-to-face fighting on one shared display, because the geometry does not
allow it. The shader is a trick the 1982 hardware could not have done.

---

## Measure first

Numbers needed before anything can be ordered or written:

1. Monitor bay opening — width, length, usable depth
2. Bezel/glass opening, which may be smaller than the bay
3. Control panel cutout dimensions, both sides
4. Distance from panel surface to the underside of the glass
5. Whether the existing wiring harness and power supply are being kept

---

## Build order

**Software first — this is the agreed order, not a suggestion.**

1. ~~Write the split shader~~ — done, geometry verified in simulation.
   **Next: run it in RetroArch on Windows against the S2440L.** Needs no
   cabinet, no Pi, nothing bought. Load `cocktail-2p.glslp`, set
   `video_force_aspect = false`, start Contra, walk round the desk.
2. Get the Pi 4; confirm the shader holds frame rate there with SNES.
3. Open the cabinet, measure everything above, photograph the panels.
4. Decide the layout (24" vs portrait) and therefore whether the cabinet gets
   cut, rebuilt, or left alone.
5. Remove and dispose of the CRT chassis safely.
6. Source and test-fit the panel; build the mount.
7. Decide input, build or wire it, confirm both pads enumerate.
8. Assemble, glass back on, play Street Fighter.

Steps 1 and 2 cost nothing but time and settle whether the whole idea works.
Everything expensive or irreversible sits behind them.

---

## What to play

Full seating rules in `cocktail_table.md`.

**Face to face, shared view — the reason for the build.** Street Fighter II,
Super Bomberman (four players), Micro Machines, Super Off Road, Smash TV.

**Turn-based, also excellent.** Kirby's Dream Course is close to purpose-built
for a table: top-down, alternating turns. Golf, Anticipation, Track & Field.

**System priority: SNES first.** It emulates essentially perfectly on a Pi 4
with full `snes9x`, and its multiplayer library is the best of the four. NES is
a good bonus — and Ms. Pac-Man herself runs on a MAME core if you want the
cabinet playing its own game again. **N64 is a bonus at best**: `parallel_n64`
on a Pi 4 is playable for a handful of titles and nowhere near the whole
library. Do not design the cabinet around it.
