# Two-screen cocktail build — plan

Status: **not built.** Only the preflight (`launcher/dual_screen.sh --check`)
exists, and it changes nothing. Everything below is the plan for when the
Pi 4 arrives.

The target: two players sitting opposite each other, both reading the same
game right-way-up, on one Pi. Street Fighter across a table.

---

## The decision, and the three ideas it beat

**What we're building: one emulator, two displays, one rotated 180°.**

A single RetroArch instance renders the game on HDMI-1. Its output is mirrored
onto HDMI-2 with a 180° transform. One game, one state, nothing to keep in
sync, no added input latency. Both players look at their own screen.

This is correct rather than a compromise: Street Fighter, Bomberman and Micro
Machines all legitimately show both players the same image anyway, so
duplicating it is exactly right. It also fixes games with *native* split-screen
— Mario Kart renders its own two viewports into one image, and each player can
read their own viewport on their own screen.

### Rejected: netplay between two local instances

Two RetroArch processes on the same Pi, same ROM, synced over `127.0.0.1`.
Reaches the same picture and pays frame-buffer latency for it — landing that
latency in fighting games, the genre least able to absorb it. Mirroring gets
there with one game state and zero sync. **Netplay is not needed for anything
in this build.**

### Rejected: one panel split in half, each half rotated

The original idea. Rotation in wlroots is an **output** transform — it applies
to a whole display, not to a window — so there is no clean way to rotate one
half of one screen. It would need custom compositing: grab the frame, blit it
twice at different rotations. That's a project, not a config change. Two
physical displays sidestep it completely.

### Rejected: two independent instances

Two unsynced games, own screen each, race on score. Works, no latency, but
it is not one shared match — no good for Street Fighter. Worth keeping as a
possible later mode for Tetris and Excitebike; not the main path.

### The dead end worth remembering

**A single emulated game cannot give two players differently-oriented views.**
A libretro core hands RetroArch one framebuffer — the exact image the console
produced. There is no second camera to split off, because the hardware never
rendered one. No amount of software moves this. It is why the mirror approach
exists, and why `tabletop.json` ships an empty `either_side` list.

The arcade industry landed in the same place: when they wanted fighting games
with players facing each other, they used two cabinets and two screens
(Nintendo's VS. DualSystem, 1984; Sega's Versus City in the '90s). Nobody ever
shipped face-to-face fighting on one shared display.

So this cabinet is less a Pac-Man cocktail table and more a VS. DualSystem.

---

## Hardware

| Item | Note |
|---|---|
| **Raspberry Pi 4, 4 GB** | Dual HDMI is the reason for the Pi 4, as much as the speed. 4 GB is comfortable; 2 GB would probably do. |
| **Two identical displays** | 4:3 (1024×768) or 5:4 (1280×1024) LCD monitors. Old office panels are plentiful and nearly free. Identical matters — same size and resolution keeps both players' view the same. |
| 2× micro-HDMI → HDMI | Pi 4 uses micro-HDMI. Easy to forget. |
| Two USB pads | One per player, as now. |
| Good 5 V / 3 A supply | Two displays plus two pads is not the load a phone charger wants. |

Do **not** hunt a CRT. Pac-Man's monitor was 4:3 mounted portrait; a flat panel
does the same job without the high-voltage hazard of working inside a tube.
Square TVs are not made, and a TV is the wrong device here regardless.

The Zero 2 W stays useful as a single-player NES kiosk — which is what this
repo was originally built for.

---

## Build steps

### 1. Preflight — run this first, before anything else

```bash
bash launcher/dual_screen.sh --check
```

It verifies the session is Wayland, that `wlr-randr` and `wl-mirror` are
present, lists the connected outputs, asks `wl-mirror` which flags it actually
supports, and prints the exact command it would run. It changes nothing.

**This is the step that de-risks the whole build.** The `wl-mirror` assumption
below is the one part that could not be verified from a Windows machine.

### 2. Install the tools

```bash
sudo apt install wlr-randr
```

`wl-mirror` is **not** in Pi OS apt and has to be built from
<https://github.com/Ferdi265/wl-mirror>. Budget time for this; it is the least
certain step.

### 3. Confirm both outputs

```bash
wlr-randr
```

Expect roughly `HDMI-A-1` and `HDMI-A-2`. If only one appears with both
monitors plugged in, that is a `config.txt` / firmware issue, not a Wayland
one.

### 4. Start the mirror

```bash
bash launcher/dual_screen.sh --start   # --stop to undo
```

Then sit on both sides and check that each screen reads right-way-up.

### 5. Make it persistent

Once it works by hand, wrap it in a systemd unit alongside `pi-arcade.service`
so it comes up on boot. **Not written yet** — deliberately, since the working
invocation should come from step 4 on real hardware rather than from a guess.

### 6. Wire it to the picker

`?table=1&rotate=…` already exist on the `cocktail-table` branch. With the
mirror doing the rotation, `rotate` is probably unnecessary — the game renders
normally on HDMI-1 and the mirror flips the copy. Worth re-checking once the
hardware is up; one of the two may turn out redundant.

---

## Open questions — answer these on hardware

1. **Does `wl-mirror` build and run on Pi OS under labwc?** The biggest
   unknown. Everything else assumes yes.
2. **Does it support `--transform`?** If not, this approach cannot rotate and
   the whole plan needs rethinking. The preflight reports this explicitly.
3. **Can it pin itself fullscreen to the second output?** If `--fullscreen-output`
   is missing, a labwc window rule can place it instead.
4. **What does mirroring cost in frame rate?** A second composite pass per
   frame. Likely fine on a Pi 4 for SNES; measure rather than assume.
5. **Does the mirror survive RetroArch starting and quitting?** It mirrors an
   *output*, not a window, so it should — but confirm, because that assumption
   is why the mirror is independent of the game lifecycle.

---

## What to play on it

Full seating rules in `cocktail_table.md`. For this cabinet specifically:

**Face to face, shared view — the reason for the build.** Street Fighter II,
Super Bomberman (four players), Micro Machines, Super Off Road, Smash TV,
Mario Kart (native split, one viewport each).

**Turn-based, also excellent.** Kirby's Dream Course is close to purpose-built
for a table: top-down, alternating turns. Golf, Anticipation, Track & Field.

**System priority: SNES first.** It emulates essentially perfectly on a Pi 4
with full `snes9x`, and its multiplayer library is the best of the four. NES is
a good bonus. **N64 is a bonus at best** — `parallel_n64` on a Pi 4 is playable
for a handful of titles (Mario Kart 64 roughly holds up, GoldenEye is rough)
and nowhere near the whole library. Do not design the cabinet around N64.
