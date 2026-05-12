# Adding games

Two steps: copy the ROM file, register it in the catalog.

## 1. Copy the ROM

```bash
# from this Windows Desktop, the F: drive collection:
scp "F:/3538 NES ROMS (every rom ever) with ALL Emulators/Roms/USA/<rom-name>.nes" \
    pi@<pi-ip>:~/pi_arcade_kiosk/roms/nes/
```

## 2. Register it in `backend/games.json`

Add an entry to the `games` array:

```json
{
  "id": "shortname",
  "title": "Display Name",
  "system": "nes",
  "rom": "Exact Filename (U).nes",
  "description": "One-line blurb shown on the tile."
}
```

Rules:
- `id` — unique, lowercase, no spaces. Used internally only.
- `system` — must be `"nes"` (until SNES/PS1 are added).
- `rom` — must match the filename in `roms/nes/` exactly, including spaces and parens.

## 3. Reload

The launcher reads `games.json` on every page load — just refresh the browser. No restart needed.

## Naming tips

The F: drive collection uses the **No-Intro / Goodset** convention:
- `(U)` — USA, `(E)` — Europe, `(J)` — Japan
- `[!]` — verified good dump
- `[a1]` — alternate dump
- `(PRG1)` — revision 1

For the launcher it doesn't matter — Flask/RetroArch handles whatever you name the file. Just make sure `games.json` has the exact same string.
