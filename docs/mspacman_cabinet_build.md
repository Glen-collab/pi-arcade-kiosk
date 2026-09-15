# Ms. Pac-Man cocktail refab — build plan

Status: **not built.** Nothing here is wired up yet. The only executable piece
in the repo is `launcher/dual_screen.sh --check`, a preflight for the
two-monitor approach this plan now supersedes — kept because it still answers
a useful question, not because it is the path.

The target: an original Ms. Pac-Man cocktail cabinet, refurbished, running a
Pi 4. Two players sitting opposite each other, both reading the same game
right-way-up, on the cabinet's single screen. Street Fighter across the table.

---

## What the cabinet gives us for free

The refab is easier than a scratch build, because the hard physical problems
are already solved:

- **Two control panels on opposite sides.** The seating we want is the seating
  it was built for.
- **A portrait monitor bay.** Ms. Pac-Man is a vertical game, so the screen's
  long axis already runs from one player to the other. This turns out to be
  exactly the orientation the split shader wants — see the geometry below.
- **Glass top, finished cabinet, stools.** None of which we have to make.

One nice bit of symmetry: the original flipped the screen between turns because
alternating play was all the hardware could manage. Same cabinet, same seats,
and the shader lets both players play at once.

---

## Display

### Geometry

Mount the panel portrait, matching the CRT it replaces. The screen's long axis
runs player-to-player; split it into a near band and a far band, one per
player. Because the full screen is portrait, each **band comes out landscape** —
which is the right shape for a 4:3 console game.

| Panel | Portrait | Per-player band | Band aspect | 4:3 game fits |
|---|---|---|---|---|
| 1280×1024 (5:4) | 1024×1280 | 1024×640 | 1.60 | 853×640 |
| 1024×768 (4:3) | 768×1024 | 768×512 | 1.50 | 683×512 |
| 1600×1200 (4:3) | 1200×1600 | 1200×800 | 1.50 | 1067×800 |

### Picking a panel — physical fit first, resolution second

**Match the original diagonal and aspect.** A 19" 5:4 LCD has a screen area of
roughly 15.1" × 12.1"; a 19" 4:3 CRT is about 15.2" × 11.4". Near enough that
it drops into the existing bay and sits under the existing bezel.

This is why a cheap 1080p panel is the wrong buy despite the tempting
resolution: a 19" 16:9 screen is about 16.5" × 9.3", so in portrait it is
9.3" wide and 16.5" long — narrower *and* longer than the opening. It will not
sit right behind the glass.

So: a 19"–20" 4:3 or 5:4 LCD monitor. Old office panels, plentiful and cheap.

**Measure the bay before buying anything.** Midway cocktails were commonly
19"-class but not universally, and the mount depends on numbers this document
does not have.

### Mounting

A flat panel is far shallower than the CRT, so expect to build a plywood or
bracket adapter to shim it up near the glass. Too low and the picture looks
sunken and picks up reflections off the underside of the glass.

---

## How both players see it right-way-up: the split shader

**One RetroArch instance, one panel, one shader.**

RetroArch's final shader pass maps the game's framebuffer onto the output
viewport, and a fragment shader controls that mapping per pixel. Write one that
samples the source texture twice: the near band drawn normally, the far band
drawn rotated 180°. One game, one state, duplicated and flipped in the same
frame.

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

1. Open the cabinet, measure everything above, photograph the panels
2. Remove and dispose of the CRT chassis safely
3. Source and test-fit the panel; build the mount
4. Write and test the split shader on a bench setup — does not need the cabinet
5. Decide input, build or wire it, confirm both pads enumerate
6. Pi 4 install: existing `install/install.sh`, plus rotation config
7. Assemble, glass back on, play Street Fighter

Steps 4 and 5 are independent and can happen in either order while waiting on
parts.

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
