# Building a second cabinet

Everything the first table needed is now either in a repo or in a script. The
only thing that cannot be is the ROM library — copyrighted, ~700 MB, copied
cabinet to cabinet.

## What lives where

| | |
|---|---|
| `Glen-collab/pi-arcade-kiosk` (branch `cocktail-table`) | picker, launcher, shader, backend, these docs |
| `Glen-collab/table-arcade` | the twelve two-player HTML games |
| Nowhere — copied by hand | ROMs (847 NES, 421 SNES) |

## Steps

**1. Flash the card.** Raspberry Pi Imager, **Raspberry Pi OS (64-bit)** — the
full Desktop image, not Lite. Lite has no Wayland session, so there is nothing
for Chromium to open onto. In the Imager's settings gear, set the hostname
(`pi-cocktail2`), the username `pi`, your wifi, and enable SSH with your public
key. Doing it there saves hunting for a keyboard later.

**2. Boot it and find it.**

```bash
ssh -4 pi@pi-cocktail2.local
```

`-4` matters. The `.local` name often resolves to an IPv6 link-local address
first, and that connection hangs for two minutes rather than failing.

**3. Install.**

```bash
curl -sL https://raw.githubusercontent.com/Glen-collab/pi-arcade-kiosk/cocktail-table/install/bootstrap.sh | bash
```

Ten to fifteen minutes, mostly apt. It ends by checking its own work: picker
responding, table games served, both emulator cores present, ROM counts. If
something is wrong it says so rather than claiming success.

`pi-arcade-kiosk` is public, so that part needs no credentials. `table-arcade`
is private: the script will report that it could not read it and carry on
installing everything else, leaving the TABLE ARCADE tab empty. Fix it by
running `gh auth login` on the Pi and re-running, by making that repo public
(it holds no ROMs and no keys), or by rsyncing the folder from the first
cabinet — the script prints all three.

**4. Copy the ROMs.** From the *first* cabinet:

```bash
~/pi_arcade_kiosk/install/sync_roms.sh pi@pi-cocktail2.local
```

**5. Reboot.** `sudo reboot`. It comes up in the picker with no desktop visible.

## Keeping them in step

On either cabinet:

```bash
~/pi_arcade_kiosk/install/update.sh
```

Pulls both repos and restarts. It refuses to touch a repo with uncommitted
local changes rather than clobbering work someone did on the cabinet itself.

For pushing work-in-progress from Windows without committing, `install/deploy.sh`
still rsyncs a working tree over. `update.sh` is the one to use for anything
that is actually finished.

## Hardware notes

- **Controllers.** Any two USB pads. The installer fetches ~430 joypad profiles,
  so recognised pads map on plug-in. The DragonRise `0079:0126` SNES clones are
  the ones the cocktail table was built and tested against.
- **Monitor.** The cocktail shader assumes a landscape panel with players at the
  short ends. Brightness is driven over HDMI with `ddcutil`; it works on the
  Dell S2440L. Power control (VCP D6) is ignored by that monitor and probably
  by yours — do not build anything that depends on it.
- **Storage.** USB SSD is fine; the whole install is under 1 GB plus ROMs.

## What the installer does not do

- **Set a rotation at boot.** Deliberate. The picker is landscape; the shader
  and the table games set rotation per-launch. There is no persistent
  rotation to configure.
- **Install a PS1 or arcade core.** Neither is in use yet.
- **Set up Tailscale.** Still worth doing if you want to reach a cabinet that
  is not on your wifi.

## What was verified, and how

A second Pi does not exist yet, so the install was tested by simulating one on
the first cabinet: a throwaway config directory containing exactly what
`bootstrap.sh` writes, then RetroArch launched against it with the per-launch
cocktail override the picker uses.

- **The cocktail shader loads from a clean config.** Proven by running twice and
  diffing the logs. Without `--set-shader` RetroArch logs `Stock GLSL shaders
  will be used` and creates no framebuffer object; with it, that warning
  disappears and it creates the viewport FBO the shader pass needs.
- **Audio comes up on the packaged config.** The live cabinet has
  `audio_device = "plughw:0,0"` written into it, which the repo config does not
  set — and deliberately still does not, because card ordering differs between
  machines and hardcoding it would be more likely to break a second Pi than fix
  it. ALSA's default device worked in the test. If a new cabinet is silent,
  that setting is the first thing to try.

What this did NOT prove: that the split looks right at both seats on the second
cabinet's monitor. That needs eyes on the actual table. It was measured on the
first one (0.9976 correlation against the expected image at both seats), and
the shader is byte-identical, so the remaining risk is the panel, not the code.
