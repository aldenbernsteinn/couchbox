# YouTube TV-UI on PC/SteamDeck

Source: https://gist.github.com/BananaAcid/a23844d757a41833ea540d73283cecf9

## Overview
Run YouTube's SmartTV interface on PC or SteamDeck with gamepad support.
Uses Chromium + extensions + Tampermonkey userscripts + Steam controller config.

## Core Requirements

### Browser Setup
- Chromium or Ungoogled Chromium (separate installation from main browser)
- Extensions:
  - YouTube TV On PC (enables TV interface access)
  - Tampermonkey (userscript manager)
  - YouTube Playback Speed Control
- Optional: uBlock Origin Lite, YouTube NonStop, Auto Quality for YouTube

### System Integration
- Steam (for gamepad-to-keyboard translation)
- Gamepad/Controller connected

## Installation Steps

1. Install Chromium with the noted extensions
2. Enable Tampermonkey userscripts via browser settings
3. Navigate to `youtube.com/tv` and create webapp via browser menu ("Install page as app")
4. Add Chromium to Steam as a Non-Steam Game with specific launch parameters
5. Configure gamepad controls via Steam controller configurator
6. Apply userscripts for reload, cursor hiding, and feature enablement

## Launch Parameters

**Windows:**
```
"C:\Program Files\Chromium\Application\chrome.exe" --profile-directory=Default --start-maximized --start-fullscreen --app=https://www.youtube.com/tv
```

**Linux/SteamDeck (Flatpak):**
```
flatpak run com.chromium.Chromium --profile-directory=Default --start-maximized --start-fullscreen --app=https://www.youtube.com/tv
```

## Gamepad Mapping (via Steam Input)

| Button | Action |
|---|---|
| A | Enter / Select |
| B | Escape / Back |
| X | Play / Pause (Space) |
| Y | Search |
| LB | Previous video |
| RB | Next video |
| D-pad | Navigation |
| Left Stick | Navigation (with turbo repeat) |
| Menu/Start | Reload (F5) |
| View/Back | Fullscreen toggle (F11) |

## Quality Optimization

Modify user-agent string in the "YouTube TV On PC" extension's `rules.json`:
- Change from Android user-agent to PS4 identifier
- This unlocks higher quality options (1080p+)

Example PS4 user-agent:
```
Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)
```

## Tampermonkey Userscripts

### 1. Reload Script
Handles delayed extension loading by reloading after extensions are ready.

### 2. CursorHide Script
Auto-hides mouse cursor after 3 seconds of inactivity. Reappears on movement.

### 3. BackgroundFix Script
Adds missing UI backgrounds during video playback to fix visual glitches.

### 4. FeaturesEnable Script
Unlocks disabled TV interface features:
- Voice input
- Animations
- Exit overlays
- Ambient screen mode (prevents display sleep)

## CouchBox Integration Notes

For CouchBox, we embed `youtube.com/tv` directly in an Electron BrowserView:
- Set user-agent to Smart TV / PS4 string
- Fullscreen within CouchBox window
- Gamepad input passes through via Web Gamepad API (YouTube TV reads it natively)
- No need for Steam controller config — CouchBox handles gamepad directly
- Apply the userscript logic (cursor hide, feature enable) as preload scripts in the BrowserView
