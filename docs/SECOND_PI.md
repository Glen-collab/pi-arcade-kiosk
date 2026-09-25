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

The repos are private, so `git clone` will ask for credentials. Either run
`gh auth login` first, or make the repos public.

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
