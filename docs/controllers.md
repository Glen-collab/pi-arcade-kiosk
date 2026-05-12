# Controllers

## USB gamepads
RetroArch auto-detects most USB pads (8BitDo, Buffalo, generic SNES-style). Plug it in, run any game from the launcher, and the buttons should already work.

If they don't, in RetroArch:
1. Press **F1** to open the menu
2. Settings → Input → User 1 Binds → Bind All
3. Press each NES button (A, B, Start, Select, D-pad) when prompted

The autoconfig is saved to `~/.config/retroarch/autoconfig/` and re-applies on next boot.

## Bluetooth pads
8BitDo SN30 / Pro 2 etc.:

```bash
sudo bluetoothctl
power on
agent on
scan on
# put pad in pairing mode (button combo varies by model)
pair <MAC>
trust <MAC>
connect <MAC>
exit
```

After it's paired once, RetroArch picks it up automatically next time.

## Keyboard fallback (no controller plugged in)
RetroArch's NES default mapping:

| NES button | Keyboard |
|---|---|
| D-pad | Arrow keys |
| A | X |
| B | Z |
| Start | Enter |
| Select | Right Shift |
| Quit | F4 |
| Menu | F1 |

## Two players
Plug in a second pad — it's User 2 automatically. Or two keyboards via USB hub (RetroArch User 2 keyboard binds default to: WASD, S/A, etc.) — adjust in F1 → Input.
