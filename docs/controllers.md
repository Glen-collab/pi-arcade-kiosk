# Pi Arcade Kiosk — Controller Setup

Everything you need to know about getting game controllers working on the Pi arcade kiosk (Pi 4 + Pi 5s). Covers wired pads, wireless dongles, the common cheap-pad gotchas, and 2-player setup.

---

## TL;DR

1. The installer (`install/install.sh`) fetches 436 official joypad autoconfig profiles. Any recognized controller maps automatically on plug-in.
2. Cheap NES/SNES pads have known chip conflicts — see the [Cheap pad gotchas](#cheap-pad-gotchas) section.
3. The launcher (`launcher/launch_game.sh`) enables **Select + Start = exit to game list** on every game.
4. Player 2 lights up the moment a second pad is plugged in — no "wake it up first" required.
5. **8BitDo is the recommended buy** — just works, no fiddling.

---

## Architecture

**Two layers of input handling:**

- **Picker (Chromium + Gamepad API)** — used to navigate the game list. Reads all connected pads via `navigator.getGamepads()` and ORs their inputs together, so any pad can drive the picker.
- **RetroArch (in-game)** — uses udev joypad driver + autoconfig profiles to know which physical button maps to which RetroPad input (A, B, X, Y, etc.).

**Per-launch override** (`/tmp/retroarch-launch-override.cfg`) is appended to the base config on every game launch. It pins Player 1 to the pad that hit "play", sets `input_max_users` to the number of plugged-in pads (so silent pad 2 still counts), and binds the Select+Start exit hotkey. It also injects per-system Player 1 button binds for systems that share a chip ID with a differently-laid-out pad (currently: PS1).

---

## How RetroArch picks a profile

RetroArch matches the connected device against `.cfg` files in `~/.config/retroarch/autoconfig/` by:

1. `input_vendor_id` + `input_product_id` (USB VID/PID), or
2. `input_device` name fallback

When a match is found, that profile's button bindings are applied to the next free player slot.

**The catch:** if two physically different pads share the same VID/PID/name, RetroArch can't tell them apart and uses whichever profile loaded last (alphabetical). This is the source of all the cheap-pad pain below.

---

## Cheap pad gotchas

### `0810:e501` "usb gamepad" — NES vs PS1 vs SNES vs SEGA

This chip ships in dozens of cheap pads with totally different physical layouts but **identical USB IDs**. Libretro provides 4 variant profiles (`usb_gamepad___________(NES|SNES|PS1|SEGA).cfg`) that all match the same VID/PID. They disabled the duplicates and left only the **PS1** variant active by default.

If you plug in a 2-button NES pad, the PS1 profile loads — it expects `A=btn1, B=btn2`. But the NES pad only has buttons 0 and 1, so "B" (shoot) points at a button that doesn't physically exist. In Contra, both buttons read as jump and shoot does nothing.

**Fix:** activate the NES variant, delete the others (already in the installer for new Pis). Manually:

```bash
cd ~/.config/retroarch/autoconfig/
sed -i 's/^#input_device = "usb gamepad/input_device = "usb gamepad/; s/^#input_vendor_id = "2064"/input_vendor_id = "2064"/; s/^#input_product_id = "58625"/input_product_id = "58625"/' 'usb_gamepad___________(NES).cfg'
rm -f 'usb_gamepad___________(PS1).cfg' 'usb_gamepad___________(SNES).cfg' 'usb_gamepad___________(SEGA).cfg'
```

**For PS1 games when this is the only chip available:** the launcher injects a PS1-style mapping at launch time when `SYSTEM=ps1`, overriding the NES autoconfig for that one game. Both pad types work — the right map is picked by what's being played.

### `0079:0126` "iNNEXT SNES Gamepad" — works out of box

The cheap SNES dongles with this chip have a dedicated `iNNEXT SNES Gamepad.cfg` profile. Full SNES layout (A, B, X, Y, L, R, Select, Start). No conflicts.

**But** the D-pad is exposed as a noisy analog axis that drifts off-center when idle, causing menus to auto-select. Mitigated globally by `input_axis_threshold = "0.7"` in `retroarch.cfg`.

### D-pad drift / ghost menu input

Cheap pads (especially dongle SNES) have analog D-pads that don't center perfectly. With the default `input_axis_threshold = 0.5`, the drift crosses the threshold and RetroArch reads it as constant directional input. Mortal Kombat 3's mode selector would scroll without anyone touching the pad.

**Fix (in `install/retroarch.cfg`):**
```
input_axis_threshold = "0.7"
```

Bumps the deadzone so small drift is ignored but intentional D-pad presses still register.

---

## Player 2 setup

Plug a second pad in (wired USB or USB dongle). That's it.

**Why this used to need a "wake-up" press:** the picker only counts pads that fired a button in the last 30 seconds. If you plugged in pad 2 without pressing anything, the launcher set `input_max_users = 1` and pad 2 was disabled in-game.

**Fix (in `launcher/launch_game.sh`):** floor `input_max_users` to the count of `/dev/input/js*` devices. If 2 dongles are physically plugged in, MK3 sees Player 2 from the moment the game loads — no wake-up needed. Capped at 4 (no kiosk game needs more).

---

## Exit hotkey

**Select + Start = quit RetroArch → back to game list.** Set in `launcher/launch_game.sh`:

```
input_enable_hotkey_btn = "8"   # Select
input_exit_emulator_btn = "9"   # Start
```

Select still works as a normal button (only the combo exits). Works on all 3 Pis, all systems.

---

## Recommended controllers

**8BitDo** (SN30 Pro, Pro 2, etc.) — has its own well-maintained autoconfig profiles in the libretro set. Plug in or pair Bluetooth, play. No NES-vs-PS1 ambiguity. No D-pad drift. Strongly recommended over cheap no-name pads if you're buying new.

**Bluetooth pairing tip for Pi 5:** use `bluetoothctl`:
```bash
bluetoothctl
> scan on
# put 8BitDo in pair mode (varies by model)
> pair <MAC>
> trust <MAC>
> connect <MAC>
> exit
```

The pad will auto-reconnect after the first successful pair as long as `trust` was called.

---

## Troubleshooting

### "Controller not configured" message
The `~/.config/retroarch/autoconfig/` directory is empty. Reinstall profiles:

```bash
cd /tmp && curl -sL https://github.com/libretro/retroarch-joypad-autoconfig/archive/refs/heads/master.tar.gz -o jpcfg.tar.gz
tar xzf jpcfg.tar.gz
cp retroarch-joypad-autoconfig-master/udev/*.cfg ~/.config/retroarch/autoconfig/
rm -rf jpcfg.tar.gz retroarch-joypad-autoconfig-master
```

### Pad detected but wrong buttons
Find the active matching profile (replace `<VID>` and `<PID>` with the decimal values from `cat /proc/bus/input/devices`):

```bash
for f in ~/.config/retroarch/autoconfig/*.cfg; do
  if grep -q "^input_vendor_id = \"<VID>\"" "$f" && grep -q "^input_product_id = \"<PID>\"" "$f"; then
    echo "MATCH: $(basename "$f")"
  fi
done
```

If there's no match, RetroArch falls back to udev's default mapping which often gets buttons in the wrong slots. Either create a custom profile or look for a known-good profile that matches your pad's name.

### Menu auto-selects in MK3 or similar
D-pad axis drift. Bump `input_axis_threshold` in `~/.config/retroarch/retroarch.cfg`:
```
input_axis_threshold = "0.7"
```
Then exit and relaunch the game.

### Pad 2 doesn't work in 2-player games
Confirm the launcher is up to date — `launch_game.sh` should contain the `JS_COUNT=$(ls /dev/input/js*` block that floors `input_max_users`. If older, reinstall from the repo or re-run `install/install.sh`.

### Inspect what's plugged in
```bash
ls /dev/input/js*                                  # raw joystick devices
cat /proc/bus/input/devices | grep -E 'Name|js'    # names + VID/PID per pad
timeout 5 jstest /dev/input/js0                    # live button/axis state (if jstest installed)
```

---

## Per-Pi notes

| Pi | Pads tested | Working configuration |
|----|-------------|----------------------|
| Pi 4 (Prime Athlete TV) | 2× cheap SNES dongles (`0079:0126`) | iNNEXT SNES profile, axis threshold 0.7, input_max_users auto-floored |
| Pi 5 (bsa-tv-2) | Cheap 2-button NES pad (`0810:e501`) | NES variant of usb_gamepad profile activated |
| Pi 5 (bsa-tv-3) | Same as bsa-tv-2 | Same setup |

All three accept any controller in the 436-profile set. Plug in and go.

---

## Related files

- `install/install.sh` — installs the 436 profiles + sets up retroarch.cfg
- `install/retroarch.cfg` — base RetroArch config with udev driver, autodetect, axis threshold
- `launcher/launch_game.sh` — per-launch override with exit hotkey, max_users floor, per-system Player 1 binds
- `docs/PI5_FULL_SETUP.md` — full setup guide including controllers (Step 6.5)
