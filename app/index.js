// Patatin — main process (based on xbox-ui-windows)
const { app, BrowserWindow, BrowserView, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

let mainWindow = null;
let youtubeView = null;

// ===== Disable Game Bar from claiming Xbox Home button =====
try {
  execSync('reg add "HKCU\\SOFTWARE\\Microsoft\\GameBar" /v UseNexusForGameBarEnabled /t REG_DWORD /d 0 /f', { windowsHide: true });
  execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f', { windowsHide: true });
} catch {}

// ===== Disable Steam from stealing the Xbox Guide button =====
try {
  // Disable Steam Input for Xbox controllers so Steam Big Picture doesn't intercept Guide
  execSync('reg add "HKCU\\Software\\Valve\\Steam" /v SteamController_XBoxSupport /t REG_DWORD /d 0 /f', { windowsHide: true });
} catch {}

// Also disable Steam's Guide button chord (Big Picture shortcut)
const steamConfigDir = 'C:\\Program Files (x86)\\Steam\\config';
const steamConfigFile = path.join(steamConfigDir, 'config.vdf');
if (fs.existsSync(steamConfigFile)) {
  try {
    let cfg = fs.readFileSync(steamConfigFile, 'utf8');
    // Disable the Guide button from opening Big Picture
    if (!cfg.includes('"UseSteamControllerConfig"')) {
      // Don't modify if we can't find the right spot — registry approach is primary
    }
  } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    autoHideMenuBar: true,
    title: "Patatin",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

// ===== YouTube TV =====
let ytActive = false;

function openYouTubeTV() {
  ytActive = true;
  if (youtubeView) {
    mainWindow.setBrowserView(youtubeView);
    resizeYouTubeView();
    return;
  }
  youtubeView = new BrowserView({
    webPreferences: {
      contextIsolation: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'youtubePreload.js'),
    },
  });
  mainWindow.setBrowserView(youtubeView);
  resizeYouTubeView();
  youtubeView.webContents.setUserAgent(
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36'
  );
  youtubeView.webContents.loadURL('https://www.youtube.com/tv');
}

// Forward controller key events to YouTube TV BrowserView
ipcMain.on('yt-key', (event, key) => {
  if (youtubeView && ytActive) {
    youtubeView.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
    setTimeout(() => {
      youtubeView.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
    }, 50);
  }
});

function resizeYouTubeView() {
  if (!youtubeView || !mainWindow) return;
  const [width, height] = mainWindow.getSize();
  youtubeView.setBounds({ x: 0, y: 0, width, height });
}

function closeYouTubeTV() {
  ytActive = false;
  if (youtubeView) mainWindow.removeBrowserView(youtubeView);
}

// ===== IPC =====
ipcMain.on('open-youtube', () => openYouTubeTV());
ipcMain.on('close-youtube', () => closeYouTubeTV());
ipcMain.on('launch-uri', (event, uri) => shell.openExternal(uri));
ipcMain.on('launch-exe', (event, exe) => {
  require('child_process').exec(`start "" "${exe}"`);
});
ipcMain.on('quit-app', () => app.quit());

// ===== APP READY =====
app.whenReady().then(() => {
  createWindow();
  mainWindow.on('resize', resizeYouTubeView);

  // F24 = Xbox short press → toggle Patatin
  globalShortcut.register('F24', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setFullScreen(true);
    }
  });

  // F23 = Xbox long press → show shutdown overlay
  globalShortcut.register('F23', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setFullScreen(true);
    mainWindow.webContents.send('show-shutdown-overlay');
  });

  // Auto-launch xbox-button-remapper if available
  const remapperPath = path.join(__dirname, '..', 'tools', 'xbox-button-remapper', 'Xbox Controller button remapper.exe');
  if (fs.existsSync(remapperPath)) {
    spawn(remapperPath, [], { detached: true, stdio: 'ignore' }).unref();
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
