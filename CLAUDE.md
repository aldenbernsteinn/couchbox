# Patatin — Xbox-style Couch Gaming Dashboard

## Project Location
`~/Patatin/`

## Architecture
- **Listener** (`~/Patatin/listener.js`): Tiny Node.js service (8MB) that reads Xbox controllers via `/dev/input/jsX`. Runs as systemd user service. Spawns/kills Electron on Guide button press.
- **App** (`~/Patatin/app/`): Electron + jQuery UI. Only runs when visible. Fully killed when hidden (zero resources).

## Launch
The listener runs automatically on boot via systemd. Press Xbox Guide button to show/hide Patatin.

- Manual launch (for dev/testing): `/home/aldenb/Patatin/app/node_modules/electron/dist/electron /home/aldenb/Patatin/app`
- Listener service: `systemctl --user status patatin-listener`
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

## Windows SSD
Mounted read-only at `/mnt/windows` (NTFS, fstab entry). Games are read from there. Never modified.

## Game Launch
- Steam games: `steam://rungameid/{appId}` (Proton handles Windows→Linux)
- Non-Steam games: Launched directly through Proton with NVAPI enabled
- Windows-only games (anti-cheat): Blocked in UI with "REQUIRES WINDOWS" badge
