// Patatin — On-screen keyboard overlay (launched by listener.js)
// Receives button commands from listener via stdin.

const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const readline = require('readline');

let win = null;
let rendererReady = false;
let pendingMessages = [];

function send(channel, data) {
  if (win && !win.isDestroyed() && rendererReady) {
    win.webContents.send(channel, data);
  } else {
    pendingMessages.push([channel, data]);
  }
}

app.on('ready', () => {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const kbWidth = 620;
  const kbHeight = 340;

  win = new BrowserWindow({
    x: Math.round((width - kbWidth) / 2),
    y: height - kbHeight,
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
  win.on('focus', () => win.blur());

  // Position keyboard away from where the user is actually typing.
  // Use the active window's bottom edge as the typing position estimate
  // (terminals, chat apps, etc. have the cursor at the bottom).
  // Fall back to mouse cursor position if window info unavailable.
  execFile('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell'], (err, wStdout) => {
    let typingY = height - 100; // default: assume bottom
    if (wStdout) {
      const wyMatch = wStdout.match(/Y=(\d+)/);
      const whMatch = wStdout.match(/HEIGHT=(\d+)/);
      if (wyMatch && whMatch) {
        const winY = parseInt(wyMatch[1]);
        const winH = parseInt(whMatch[1]);
        // Typing position = bottom of the active window
        typingY = winY + winH;
      }
    }
    // If typing position is in bottom half, put keyboard at top
    if (typingY > height * 0.5) {
      win.setPosition(Math.round((width - kbWidth) / 2), 20);
    }
    // Otherwise stays at bottom (default)
  });

  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    for (const [ch, d] of pendingMessages) win.webContents.send(ch, d);
    pendingMessages = [];
  });

  // Read commands from listener via stdin
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const cmd = line.trim();
    if (cmd === 'BACKSPACE') execFile('xdotool', ['key', 'BackSpace'], () => {});
    else if (cmd === 'SPACE') execFile('xdotool', ['key', 'space'], () => {});
    else if (cmd.startsWith('VOICE_STATE:')) send('voice-state', cmd.slice(12));
    else if (cmd === 'RECORDING') send('voice-state', 'recording');
    else if (cmd.startsWith('PARTIAL:')) send('voice-partial', cmd.slice(8));
    else if (cmd === 'VOICE_DONE') send('voice-done', '');
  });
  rl.on('close', () => {});
});

// IPC from renderer
ipcMain.on('type-key', (event, key) => {
  if (key === 'Backspace') execFile('xdotool', ['key', 'BackSpace'], () => {});
  else if (key === 'Enter') execFile('xdotool', ['key', 'Return'], () => {});
  else if (key === 'Space') execFile('xdotool', ['key', 'space'], () => {});
  else if (key === 'Tab') execFile('xdotool', ['key', 'Tab'], () => {});
  else execFile('xdotool', ['type', '--clearmodifiers', key], () => {});
});

ipcMain.on('close-keyboard', () => app.quit());
app.on('window-all-closed', () => app.quit());
