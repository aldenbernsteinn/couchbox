# Patatin — Xbox-style Couch Gaming Dashboard

## Project Location
`~/Patatin/`

## Core Principle: Read-Only Windows SSD
**The Windows SSD at `/mnt/windows` is ALWAYS read-only.** Never remount it read-write. When games or tools need to write (shader caches, saves, updates), use **fuse-overlayfs** to layer a writable local directory on top. This keeps the Windows partition safe for dual-boot.

Pattern:
```bash
fuse-overlayfs \
  -o "lowerdir=/mnt/windows/path/to/game" \
  -o "upperdir=~/.local/overlay/game/upper" \
  -o "workdir=~/.local/overlay/game/work" \
  -o "squash_to_uid=1000,squash_to_gid=1000" \
  ~/Games/GameName
```
Reads come from Windows SSD, writes go to local SSD. All overlays are mounted by `~/.steam/overlay/mount-overlay.sh` (systemd service `steam-overlay`).

## Architecture
- **Listener** (`~/Patatin/listener.js`): Tiny Node.js service (8MB) that reads Xbox controllers via `/dev/input/jsX`. Runs as systemd user service. Spawns/kills Electron on Guide button press.
- **App** (`~/Patatin/app/`): Electron + jQuery UI. Only runs when visible. Fully killed when hidden (zero resources).

## Launch
The listener runs automatically on boot via systemd. Press Xbox Guide button or Super+Shift+H to toggle Patatin.

- Manual launch (for dev/testing): `/home/aldenb/Patatin/app/node_modules/electron/dist/electron /home/aldenb/Patatin/app`
- Listener service: `systemctl --user status patatin-listener`
- Overlay service: `systemctl --user status steam-overlay`
- Restart listener: `systemctl --user restart patatin-listener`
- View logs: `journalctl --user -u patatin-listener -f`

## Build
No build step needed — legacy jQuery app, not React/Vite. Edit files directly and relaunch.

## Key Files
- `listener.js` — Guide button listener (systemd service)
- `app/index.js` — Electron main process
- `app/xbox.js` — UI logic, game detection, music, navigation
- `app/index.html` — HTML structure
- `app/main.css` — Styling
- `app/electron/controllerGrab.js` — Evdev controller reading module (used by listener)
- `cache/music/` — Per-game music files (organized by Steam appId)
- `toggle.sh` — Keyboard shortcut toggle script (Super+Shift+H)
- `app/keyboard.js` — Electron main process for on-screen keyboard overlay
- `app/keyboard.html` — On-screen keyboard UI (QWERTY, gamepad-navigable)
- `check-textfield.py` — X11 XFixes cursor shape detection (I-beam = text field)

## Windows SSD
Mounted read-only at `/mnt/windows` (NTFS, fstab entry). Games are read from there via fuse-overlayfs. **Never remount read-write.**

## Game Directories (Overlays)
- Steam games: `~/.steam/steam/steamapps/common/` (overlay of Windows SSD Steam libraries)
- Hogwarts Legacy: `~/Games/HogwartsLegacy/` (overlay)
- PvZ GW2: `~/Games/PvZGW2/` (overlay)

## Game Launch Methods
- **Steam games**: `steam://rungameid/{appId}` — Proton handles Windows→Linux
- **Epic games (Hogwarts Legacy)**: Heroic Games Launcher (`heroic --no-gui launch`)
- **EA games (PvZ GW2)**: Lutris
- **Windows-only games** (anti-cheat): Blocked in UI with "REQUIRES WINDOWS" badge

## Mouse Mode (Hidden Mode)
When Patatin is hidden (Electron killed), the listener turns the Xbox controller into a system mouse:
- **Left stick** → moves mouse cursor (velocity-based, ~60fps via `xdotool`)
- **A button** → left click (hold = hold). If clicked on a text field, spawns on-screen keyboard
- **B button** → close keyboard overlay
- **Auto-timeout**: deactivates after 10s of no joystick input
- **Real mouse detection**: monitors `/dev/input/event3` (Logitech receiver) — deactivates mouse mode when real mouse moves
- **Large cursor**: swaps to `whiteglass` theme at 64px when active, restores `MacTahoe-cursors` 24px when inactive
- **Keyboard overlay**: `app/keyboard.js` + `app/keyboard.html` — Electron frameless window, joystick-navigable QWERTY, types via `xdotool`
- **Text field detection**: `check-textfield.py` checks cursor shape via X11 XFixes — I-beam cursor = text field

### Dependencies
- `xdotool` — mouse movement, clicks, typing (`sudo apt install xdotool`)

## Installed Tools
- Steam (deb, not snap) — `/usr/games/steam`
- Heroic Games Launcher — `/usr/bin/heroic` (for Epic games)
- Lutris — `/usr/games/lutris` (for EA games)
- Proton Experimental — `~/.steam/steam/steamapps/common/Proton - Experimental/`
- fuse-overlayfs — overlay mounts for read-only game files
