// Patatin — On-screen keyboard overlay (launched by listener.js)
// Frameless, always-on-top, transparent window at bottom of screen.
// Joystick navigates keys, A types, B closes.

const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

let win = null;

app.on('ready', () => {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const kbWidth = 620;
  const kbHeight = 340;

  win = new BrowserWindow({
    x: Math.round((width - kbWidth) / 2),
    y: height - kbHeight - 40,
    width: kbWidth,
    height: kbHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'keyboard.html'));
  win.setAlwaysOnTop(true, 'screen-saver');

  win.on('focus', () => {
    win.blur();
  });
});

// IPC: renderer sends typed character → inject via xdotool
ipcMain.on('type-key', (event, key) => {
  if (key === 'Backspace') {
    execFile('xdotool', ['key', 'BackSpace'], () => {});
  } else if (key === 'Enter') {
    execFile('xdotool', ['key', 'Return'], () => {});
  } else if (key === 'Space') {
    execFile('xdotool', ['key', 'space'], () => {});
  } else if (key === 'Tab') {
    execFile('xdotool', ['key', 'Tab'], () => {});
  } else {
    execFile('xdotool', ['type', '--clearmodifiers', key], () => {});
  }
});

ipcMain.on('close-keyboard', () => {
  app.quit();
});

app.on('window-all-closed', () => app.quit());
