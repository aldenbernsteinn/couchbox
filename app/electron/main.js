const { app, BrowserWindow, BrowserView, ipcMain, shell } = require('electron');
const path = require('path');
const { detectAllGames } = require('./gameDetector');

let mainWindow = null;
let youtubeView = null;


function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Load built files (run `npm run build` or `vite build` first)
  // For dev with hot reload, start vite dev server first then uncomment:
  // mainWindow.loadURL('http://localhost:5173');
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  mainWindow.setMenuBarVisibility(false);

  // F11 toggles fullscreen, Escape exits kiosk
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });
}

// YouTube TV as embedded BrowserView
function openYouTubeTV() {
  if (youtubeView) {
    mainWindow.setBrowserView(youtubeView);
    resizeYouTubeView();
    return;
  }

  youtubeView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'youtubePreload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setBrowserView(youtubeView);
  resizeYouTubeView();

  // Smart TV user-agent to get the TV interface
  youtubeView.webContents.setUserAgent(
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36'
  );
  youtubeView.webContents.loadURL('https://www.youtube.com/tv');
}

function resizeYouTubeView() {
  if (!youtubeView || !mainWindow) return;
  const [width, height] = mainWindow.getSize();
  youtubeView.setBounds({ x: 0, y: 0, width, height });
}

function closeYouTubeTV() {
  if (youtubeView) {
    mainWindow.removeBrowserView(youtubeView);
  }
}

// IPC handlers
ipcMain.handle('get-games', async () => {
  return await detectAllGames();
});

ipcMain.handle('launch-app', async (event, appConfig) => {
  const { type, uri, exe } = appConfig;
  switch (type) {
    case 'uri':
      shell.openExternal(uri);
      break;
    case 'exe':
      const { exec } = require('child_process');
      exec(`start "" "${exe}"`);
      break;
    case 'youtube':
      openYouTubeTV();
      break;
    case 'xbox-store':
      shell.openExternal('ms-windows-store://');
      break;
    default:
      break;
  }
});

ipcMain.handle('close-youtube', () => {
  closeYouTubeTV();
});

// Resize YouTube view when window resizes
app.on('ready', () => {
  createWindow();
  mainWindow.on('resize', resizeYouTubeView);
});

app.on('window-all-closed', () => {
  app.quit();
});
