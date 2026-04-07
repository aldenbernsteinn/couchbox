// Patatin — On-screen keyboard overlay (launched by listener.js)
// Fullscreen transparent click-through window.
// Keyboard and voice overlay position themselves via CSS.

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
  const { width, height } = display.size; // full display, not workArea

  win = new BrowserWindow({
    x: 0,
    y: 0,
    width: width,
    height: height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    type: 'toolbar', // prevents window manager from adding borders on Linux
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'keyboard.html'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true); // click-through — all input via gamepad
  win.on('focus', () => win.blur());

  // Tell renderer where the typing cursor is so keyboard can position away from it
  execFile('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell'], (err, wStdout) => {
    let typingY = height - 100;
    if (wStdout) {
      const wyMatch = wStdout.match(/Y=(\d+)/);
      const whMatch = wStdout.match(/HEIGHT=(\d+)/);
      if (wyMatch && whMatch) {
        typingY = parseInt(wyMatch[1]) + parseInt(whMatch[1]);
      }
    }
    // Send to renderer so it can position keyboard
    const kbPosition = typingY > height * 0.5 ? 'top' : 'bottom';
    win.webContents.on('did-finish-load', () => {
      rendererReady = true;
      win.webContents.send('kb-position', kbPosition);
      for (const [ch, d] of pendingMessages) win.webContents.send(ch, d);
      pendingMessages = [];
    });
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
