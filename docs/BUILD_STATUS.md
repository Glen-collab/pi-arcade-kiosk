# Cocktail table — build status

Written 2026-09-23. Everything below is done and verified unless it says
otherwise. Read `mspacman_cabinet_build.md` for the design and the reasoning;
this file is the "where did we get to" snapshot.

**One-line summary: the software is finished and tested. What's left is
physical — a monitor power brick, control panels, and the cabinet.**

---

## The Pi

| | |
|---|---|
| Model | Raspberry Pi 4 Model B Rev 1.5, 4 GB |
| Hostname | `pi-cocktail` (deliberately not `pi-arcade`, which the Zero 2 W holds) |
| IP | `192.168.1.177` on the house WiFi |
| OS | Raspberry Pi OS **Desktop** 64-bit, Debian 13 Trixie, labwc/Wayland |
| Boot | 256 GB NVMe in a Realtek RTL9210CN **USB** enclosure — the Pi 4 has no PCIe, so the M.2 HAT bought for a Pi 5 does not apply |
| Disk | 217 GB free |
| SSH | key auth working from this Windows box (`~/.ssh/id_ed25519`, "claude-on-bsa-tv-3") |
| sudo | passwordless via `/etc/sudoers.d/010_pi-nopasswd` |

**Connect with `ssh -4 pi@pi-cocktail.local`.** The `-4` matters: mDNS hands
back an IPv6 link-local address that times out mid-handshake over WiFi. Or use
the IP directly.

**Not done:** Tailscale. `sudo tailscale up` needs a browser to authorise, so
it was left for Glen. Until then the Pi is LAN-only.

### Installed

RetroArch 1.20.0, cores `nestopia` / `snes9x` / `mgba` / `parallel_n64` (the
last pulled from the libretro buildbot by `install/install.sh`), Flask, and 439
joypad autoconfig profiles. `pi-arcade.service` is installed but **disabled and
inactive** — deliberately, since there is no display attached yet.

---

## Library

**1,268 games: 847 NES, 421 SNES.** Every one boots.

- NES came from `F:\3538 NES ROMS...\Roms\USA` (857 files)
- SNES came from `Desktop\snes`, which is byte-identical to `F:\SNES`
- **GBA and N64 deliberately skipped.** GBA is a single-player handheld library
  with a 3:2 aspect the shader would need reworking for. N64 will not render
  acceptably on a Pi 4 — `parallel_n64` needs desktop OpenGL the Pi does not
  have, and its marquee multiplayer is native split-screen anyway.

### Three cleanups already applied

1. **35 SNES entries were directories**, each wrapping a loose `.smc`, so the
   picker could not see them. They happened to be the headline titles — Turtles
   in Time, Street Fighter II, Contra III, Super Castlevania IV, Ultimate MK3.
   Flattened with checksum dedup. This was pre-existing on the Desktop, not
   caused by the transfer.
2. **16 bad ROMs removed** after the sweep below. Originals remain on F:.
3. **24 duplicate `.smc` files removed** where the same game also existed as a
   `.zip` — fallout from cleanup 1.

### ROM sweep

Every ROM was booted for 60 frames to see whether the core accepted it. Full
results in `rom_sweep_results.tsv`. **1,292 of 1,308 passed (98.8%).**

The 16 failures, now deleted from the Pi:

| System | Titles |
|---|---|
| NES | Adventures of Captain Comic, Al Unser Jr Turbo Racing `[a1]`, CIRCUS.NES, Crystalis (Prototype), Deja Vu, Lode Runner, M.U.S.C.L.E., Secret Scout, Ultimate Stuntman, Xenophobe |
| SNES | Bram Stoker's Dracula, Dragon-Ball Z Super Butouden (ENG), Stargate, Stone Protectors, Tuff E Nuff, Twisted Tales of Spike McFang |

Retail `Crystalis` and `Al Unser Jr` survived — only a prototype and an
alternate dump failed.

Most of these are **HANG**, not "won't load": the core wedges hard enough to
ignore SIGTERM. In a sealed cabinet that is a locked-up table with no way out
but the power lead, which is why the sweep was worth running before any wood
was cut. `timeout` alone could not kill them; `timeout -k` was required.

**Worth knowing:** `Stargate (U) [!]` and `Tuff E Nuff (U) [!]` carry the `[!]`
verified-good-dump tag. They are not corrupt — they hang `snes9x` specifically.
A different core (snes9x2010, bsnes, mesen-s) would likely run them, via a
per-game core override in `launch_game.sh`. Nobody has tried.

**All Street Fighter and Mortal Kombat titles passed** and are live: SF II,
SF II Turbo, Super SF II, SF Alpha 2, SF 2010 (NES), MK, MK I, MK II, MK III,
Ultimate MK3.

---

## The shader — verified working

`shaders/cocktail-2p.glslp` + `.glsl`. Installed at
`~/.config/retroarch/shaders/` on the Pi.

Splits the viewport left/right, draws the same frame into each half rotated 90
degrees in opposite directions. **Players sit at the two ENDS of the monitor**,
facing each other along its long axis — not the top and bottom edges. Each gets
1080x810.

### How it was verified without a monitor

RetroArch's `--max-frames-ss` takes a screenshot at the end of a headless run,
so frames can be captured off the Pi with nothing plugged in. Compare each
candidate transform of each half against a no-shader capture of the same frame
by normalised cross-correlation.

**Both seats score 0.9976** against the known-good reference; the mirrored
alternative scores 0.3692. Not "looks right" — measured.

### Two bugs found this way, and a lesson

1. **The halves were swapped.** Each player was reading the half rendered for
   the person opposite — a clean rotation, but 180 degrees out for the viewer.
   Fixed by exchanging the branches.
2. **A "fix" that made it worse.** The first capture was misread as mirrored,
   and a y-flip added to correct it. The mapping was already a clean rotation
   and the flip *introduced* a mirror. Reverted.

**A rotation can never produce a mirror.** Mirrored output always means an odd
number of flips crept in, so the fix is to remove one, never to add one.

And: judging rotated text by eye is unreliable. Raw MSE could not separate the
candidates either. Correlation against a known-good capture could.

### Wiring

Cocktail mode is a **per-launch** option, not a global setting — a 6th
positional arg on `launch_game.sh`, set by the picker when the URL carries
`?table=1`. Global `video_shader_enable` would put the split on every game
forever, including single-screen play. A missing preset falls back to shaders
off rather than launching into a broken pipeline.

`video_force_aspect = false` is required, or RetroArch letterboxes the panel
before the shader sees it.

**GLSL, not `.slang`** — the Pi's V3D stack gives RetroArch only OpenGL ES 3.1,
and it reports `Default shader backend found: glsl`. A `.slang` shader has no
backend to load into and fails silently.

---

## Performance — not a concern

Measured with the shader active, headless, unthrottled:

| Title | FPS | vs 60 |
|---|---|---|
| Turtles in Time | 404 | 6.7x |
| Street Fighter II | 397 | 6.6x |
| Contra III | 394 | 6.6x |
| Yoshi's Island (SuperFX2) | 332 | 5.5x |
| Doom (SuperFX2) | 272 | 4.5x |
| Kirby's Dream Land 3 (SA-1) | 270 | 4.5x |
| Kirby Super Star (SA-1) | 223 | 3.7x |
| Super Mario RPG (SA-1) | 222 | 3.7x |

The SuperFX and SA-1 titles expected to be too slow are the slowest here and
still run at nearly 4x what they need. That worry was unfounded.

**Caveat:** headless, so this proves **CPU-side emulation** has 3.7-6.6x
headroom. The GPU and presentation path is not measured. An A/B of the shader
came back showing negative cost, which is impossible — run-to-run variance
(~15%) swamps it, so shader cost is below the noise floor rather than known.

---

## Still to do

**Physical, blocking everything visual:**

1. **12 V 3.33 A power brick** for the Dell S2440L. Search "Dell S2440L power
   adapter"; the S2240L/S2340L share it. A 12 V **5 A** unit costs the same and
   leaves headroom to run cabinet lighting off one supply.
2. Control panels — undecided. Rebuilt arcade panels, embedded pads, stored
   controllers, or an external stick. A USB encoder per side makes any of them
   look like a normal gamepad to the kiosk, so the launch path does not change.
3. Cabinet. Cutting the Ms. Pac-Man or building new are both acceptable.
   Measurements list is in `mspacman_cabinet_build.md`.

**Software, all optional:**

- Tailscale (needs a browser)
- Per-game core overrides, which would likely recover Stargate and Tuff E Nuff
- Arcade core (MAME/FBNeo) — needed for 4-player Turtles and Gauntlet II, which
  are arcade ROMs, not console ports
- Controller input is **completely untested** — nothing has ever been plugged
  into this Pi, so the joypad-index and `num_users` logic is unexercised here
- Audio is unverified; ALSA failed in every test because no HDMI sink is
  attached

---

## What is and is not in git

**In git**, on branch `cocktail-table` of `Glen-collab/pi-arcade-kiosk`: the
shader, the launcher, the backend and frontend changes, `tabletop.json`, all
docs including this file, and the sweep results TSV.

**Not in git, and would be lost if the Pi were reimaged:** the ROMs (they live
on F:), the Pi's `retroarch.cfg`, the SSH key in `authorized_keys`, and the
sudoers file. All reproducible from `install/install.sh` plus this document.
