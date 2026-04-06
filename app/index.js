// Patatin — main process (Linux port, launched by listener.js)
const { app, BrowserWindow, BrowserView, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

let mainWindow = null;
let youtubeView = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    title: 'Patatin',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });

  // If launched with --shutdown-overlay, tell renderer to show it
  if (process.argv.includes('--shutdown-overlay')) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('show-shutdown-overlay');
    });
  }
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
  if (youtubeView && mainWindow) mainWindow.removeBrowserView(youtubeView);
}

// ===== IPC handlers =====
ipcMain.on('open-youtube', () => openYouTubeTV());
ipcMain.on('close-youtube', () => closeYouTubeTV());
ipcMain.on('launch-uri', (event, uri) => shell.openExternal(uri));

ipcMain.on('launch-exe', (event, exe) => {
  // Launch non-Steam games through Proton
  const gameName = path.basename(path.dirname(exe));
  const slug = gameName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const prefixDir = path.join(os.homedir(), '.proton', slug);
  fs.mkdirSync(prefixDir, { recursive: true });

  const steamRoot = path.join(os.homedir(), '.steam', 'steam');
  let protonBin = null;
  try {
    const commonDir = path.join(steamRoot, 'steamapps', 'common');
    for (const d of fs.readdirSync(commonDir)) {
      if (d.startsWith('Proton')) {
        const candidate = path.join(commonDir, d, 'proton');
        if (fs.existsSync(candidate)) { protonBin = candidate; break; }
      }
    }
  } catch {}

  if (protonBin) {
    const env = {
      ...process.env,
      STEAM_COMPAT_DATA_PATH: prefixDir,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
      PROTON_ENABLE_NVAPI: '1',
      DXVK_ENABLE_NVAPI: '1',
    };
    const child = spawn(protonBin, ['run', exe], { env, detached: true, stdio: 'ignore' });
    child.unref();
  }

  // Quit Patatin after launching game
  setTimeout(() => app.quit(), 2000);
});

ipcMain.on('quit-app', () => app.quit());
ipcMain.on('hide-window', () => app.quit());
ipcMain.on('system-shutdown', () => { exec('systemctl poweroff'); });
ipcMain.on('system-reboot', () => { exec('systemctl reboot'); });

// ===== APP READY =====
app.whenReady().then(() => {
  createWindow();
  mainWindow.on('resize', resizeYouTubeView);
});

app.on('window-all-closed', () => app.quit());
