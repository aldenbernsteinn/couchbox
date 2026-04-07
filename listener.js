#!/usr/bin/env node
// Patatin Listener — tiny service that waits for Xbox Guide button
// Spawns/kills Electron on press. Zero overhead when UI is not shown.
// When UI is hidden: left stick → mouse, right stick → scroll, A → click,
// D-pad → arrow keys, RT → Enter, LT → Esc, Back → Super.

const fs = require('fs');
const { spawn, execFile } = require('child_process');
const path = require('path');

const ELECTRON = path.join(__dirname, 'app', 'node_modules', 'electron', 'dist', 'electron');
const APP_DIR = path.join(__dirname, 'app');

// Joystick event constants (linux/joystick.h)
const JS_EVENT_SIZE = 8;
const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_AXIS = 0x02;
const JS_EVENT_INIT = 0x80;
const GUIDE_BUTTON = 8;
const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_BACK = 6;
const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_LT = 2;
const AXIS_RIGHT_X = 3;
const AXIS_RIGHT_Y = 4;
const AXIS_RT = 5;
const AXIS_DPAD_X = 6;
const AXIS_DPAD_Y = 7;

// Mouse mode settings
const DEADZONE = 4000;          // ~12% of 32767, ignore stick drift
const STICKY_DEADZONE = 12000;  // ~37% — harder to break free when on interactive element
const MOUSE_SPEED = 18;         // max pixels per tick at full deflection
const SCROLL_SPEED = 3;         // scroll lines per tick at full deflection
const MOUSE_TICK_MS = 16;       // ~60fps
const CURSOR_POLL_MS = 150;     // check cursor shape every 150ms
const IDLE_TIMEOUT_MS = 60000;  // deactivate after 60s of no input
const TRIGGER_THRESHOLD = 16000; // trigger must be past ~50% to fire
const DEFAULT_CURSORS = new Set(['left_ptr', 'default', 'arrow', 'top_left_arrow']);

// Cursor settings
const CURSOR_THEME_BIG = 'whiteglass';
const CURSOR_SIZE_BIG = 64;
const CURSOR_THEME_NORMAL = 'MacTahoe-cursors';
const CURSOR_SIZE_NORMAL = 24;

// Raw input_event struct (for real mouse detection): 24 bytes on x86_64
const INPUT_EVENT_SIZE = 24;
const EV_REL = 0x02;  // relative movement (mouse)
const EV_KEY = 0x01;  // key/button press

// Electron state
let electronProc = null;
let guideDown = false;

// Mouse mode state
let stickX = 0;
let stickY = 0;
let rStickX = 0;
let rStickY = 0;
let mouseModeActive = false;
let mouseInterval = null;
let aButtonDown = false;
let idleTimer = null;
let mouseWatchFd = null;

// Trigger/dpad state (for edge detection)
let ltFired = false;
let rtFired = false;
let dpadLastX = 0;
let dpadLastY = 0;

// Cursor snap state
let onInteractive = false;    // true when cursor is over a clickable/interactive element
let cursorPollTimer = null;

// Keyboard overlay state
let keyboardProc = null;
let cursorHideProc = null;

// Whisper server state
const WHISPER_PYTHON = path.join(__dirname, 'tools', 'whisper-venv', 'bin', 'python3');
const WHISPER_SERVER = path.join(__dirname, 'whisper-server.py');
let whisperProc = null;
let whisperReady = false;
let voiceRecording = false;

// ── Cursor helpers ──────────────────────────────────────────────────

function setCursor(theme, size) {
  execFile('gsettings', ['set', 'org.gnome.desktop.interface', 'cursor-theme', theme], () => {});
  execFile('gsettings', ['set', 'org.gnome.desktop.interface', 'cursor-size', String(size)], () => {});
}

function hideCursor() {
  if (cursorHideProc) return;
  cursorHideProc = spawn('python3', ['-c', [
    'import ctypes, ctypes.util, signal, sys',
    'signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))',
    'x11 = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11"))',
    'xfixes = ctypes.cdll.LoadLibrary(ctypes.util.find_library("Xfixes"))',
    'x11.XOpenDisplay.restype = ctypes.c_void_p',
    'dpy = x11.XOpenDisplay(None)',
    'root = x11.XDefaultRootWindow(dpy)',
    'xfixes.XFixesHideCursor(dpy, root)',
    'x11.XFlush(dpy)',
    'signal.pause()',
  ].join('\n')], { stdio: 'ignore' });
  cursorHideProc.on('exit', () => { cursorHideProc = null; });
}

function showCursor() {
  if (cursorHideProc) {
    cursorHideProc.kill('SIGTERM');
    cursorHideProc = null;
  }
}

// ── Cursor shape polling (for snap-to-interactive) ──────────────────

function pollCursorShape() {
  const script = path.join(__dirname, 'get-cursor.py');
  execFile('python3', [script], { timeout: 500 }, (err, stdout) => {
    if (!stdout) return;
    const name = stdout.trim().toLowerCase();
    onInteractive = !DEFAULT_CURSORS.has(name);
  });
}

function startCursorPoll() {
  cursorPollTimer = setInterval(pollCursorShape, CURSOR_POLL_MS);
}

function stopCursorPoll() {
  clearInterval(cursorPollTimer);
  cursorPollTimer = null;
  onInteractive = false;
}

// ── Deadzone + velocity ─────────────────────────────────────────────

function applyDeadzone(val, dz) {
  if (Math.abs(val) < dz) return 0;
  const sign = val > 0 ? 1 : -1;
  return sign * (Math.abs(val) - dz) / (32767 - dz);
}

function mouseMoveTick() {
  // Don't move mouse when keyboard overlay is open (type mode)
  if (keyboardProc) return;

  // Use sticky deadzone when over interactive element (harder to break free)
  const dz = onInteractive ? STICKY_DEADZONE : DEADZONE;

  // Left stick → mouse movement
  const dx = applyDeadzone(stickX, dz);
  const dy = applyDeadzone(stickY, dz);
  if (dx !== 0 || dy !== 0) {
    const moveX = Math.round(dx * MOUSE_SPEED);
    const moveY = Math.round(dy * MOUSE_SPEED);
    if (moveX !== 0 || moveY !== 0) {
      execFile('xdotool', ['mousemove_relative', '--', String(moveX), String(moveY)], () => {});
    }
  }

  // Right stick → scroll
  const sy = applyDeadzone(rStickY, DEADZONE);
  if (sy !== 0) {
    const lines = Math.round(Math.abs(sy) * SCROLL_SPEED);
    // xdotool click 4 = scroll up, 5 = scroll down
    const button = sy < 0 ? '4' : '5';
    for (let i = 0; i < Math.max(1, lines); i++) {
      execFile('xdotool', ['click', button], () => {});
    }
  }
  const sx = applyDeadzone(rStickX, DEADZONE);
  if (sx !== 0) {
    // xdotool click 6 = scroll left, 7 = scroll right
    const button = sx < 0 ? '6' : '7';
    const lines = Math.round(Math.abs(sx) * SCROLL_SPEED);
    for (let i = 0; i < Math.max(1, lines); i++) {
      execFile('xdotool', ['click', button], () => {});
    }
  }
}

// ── Real mouse/keyboard detection ───────────────────────────────────

function findPhysicalMouse() {
  try {
    const entries = fs.readdirSync('/dev/input/by-id/');
    for (const e of entries) {
      if (e.endsWith('-event-mouse')) {
        const target = fs.readlinkSync(`/dev/input/by-id/${e}`);
        return path.resolve('/dev/input/by-id/', target);
      }
    }
  } catch {}
  return null;
}

function startMouseWatch() {
  const devPath = findPhysicalMouse();
  if (!devPath) return;
  try {
    const fd = fs.openSync(devPath, 'r');
    mouseWatchFd = fd;
    const buf = Buffer.alloc(INPUT_EVENT_SIZE);
    const readLoop = () => {
      if (mouseWatchFd !== fd) return;
      fs.read(fd, buf, 0, INPUT_EVENT_SIZE, null, (err, bytesRead) => {
        if (err || bytesRead !== INPUT_EVENT_SIZE) {
          try { fs.closeSync(fd); } catch {}
          if (mouseWatchFd === fd) mouseWatchFd = null;
          return;
        }
        const type = buf.readUInt16LE(16);
        if (type === EV_REL || type === EV_KEY) {
          if (mouseModeActive) {
            console.log('Real mouse/keyboard detected — deactivating mouse mode');
            stopMouseMode();
          }
        }
        readLoop();
      });
    };
    readLoop();
    console.log(`Watching real mouse at ${devPath}`);
  } catch {}
}

function stopMouseWatch() {
  if (mouseWatchFd !== null) {
    try { fs.closeSync(mouseWatchFd); } catch {}
    mouseWatchFd = null;
  }
}

// ── Whisper server lifecycle ────────────────────────────────────────

function startWhisper() {
  if (whisperProc) return;
  whisperReady = false;
  console.log('Starting Whisper server (loading model into VRAM)...');
  whisperProc = spawn(WHISPER_PYTHON, [WHISPER_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let wBuf = '';
  whisperProc.stdout.on('data', (d) => {
    wBuf += d.toString();
    let lines = wBuf.split('\n');
    wBuf = lines.pop();
    for (const line of lines) {
      if (line === 'READY') {
        whisperReady = true;
        console.log('Whisper model loaded and ready');
      } else if (line === 'RECORDING' || line.startsWith('PARTIAL:')) {
        sendToKeyboard(line);
      } else if (line.startsWith('RESULT:')) {
        voiceRecording = false;
        const text = line.slice(7).trim();
        if (text) {
          sendToKeyboard('VOICE_STATE:writing');
          execFile('xdotool', ['type', '--clearmodifiers', '--delay', '15', text], () => {
            sendToKeyboard('VOICE_DONE');
            resetIdleTimer();
          });
        } else {
          sendToKeyboard('VOICE_DONE');
        }
      }
    }
  });
  whisperProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[whisper] ${msg}`);
  });
  whisperProc.on('exit', () => {
    console.log('Whisper server exited');
    whisperProc = null;
    whisperReady = false;
  });
}

function stopWhisper() {
  if (!whisperProc) return;
  console.log('Stopping Whisper server (freeing VRAM)...');
  if (whisperProc.stdin.writable) whisperProc.stdin.write('QUIT\n');
  const pid = whisperProc.pid;
  setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, 3000);
  whisperProc = null;
  whisperReady = false;
}

function sendToWhisper(cmd) {
  if (whisperProc && whisperReady && whisperProc.stdin.writable) {
    whisperProc.stdin.write(cmd + '\n');
  }
}

// ── Idle timeout ────────────────────────────────────────────────────

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (mouseModeActive) {
      console.log('Idle timeout — deactivating mouse mode');
      stopMouseMode();
    }
  }, IDLE_TIMEOUT_MS);
}

// ── Mouse mode lifecycle ────────────────────────────────────────────

function startMouseMode() {
  if (mouseModeActive) return;
  mouseModeActive = true;
  stickX = 0;
  stickY = 0;
  rStickX = 0;
  rStickY = 0;
  ltFired = false;
  rtFired = false;
  dpadLastX = 0;
  dpadLastY = 0;
  mouseInterval = setInterval(mouseMoveTick, MOUSE_TICK_MS);
  setCursor(CURSOR_THEME_BIG, CURSOR_SIZE_BIG);
  startMouseWatch();
  startCursorPoll();
  startWhisper();
  resetIdleTimer();
  console.log('Mouse mode ON');
}

function stopMouseMode() {
  if (!mouseModeActive) return;
  mouseModeActive = false;
  clearInterval(mouseInterval);
  mouseInterval = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  stickX = 0;
  stickY = 0;
  rStickX = 0;
  rStickY = 0;
  setCursor(CURSOR_THEME_NORMAL, CURSOR_SIZE_NORMAL);
  stopMouseWatch();
  stopCursorPoll();
  stopWhisper();
  if (aButtonDown) {
    execFile('xdotool', ['mouseup', '1'], () => {});
    aButtonDown = false;
  }
  killKeyboard();
  console.log('Mouse mode OFF');
}

// ── A button (click) ────────────────────────────────────────────────

function onAButton(pressed) {
  if (!mouseModeActive) return;
  resetIdleTimer();
  aButtonDown = pressed;
  if (pressed) {
    execFile('xdotool', ['mousedown', '1'], () => {
      checkForTextField();
    });
  } else {
    execFile('xdotool', ['mouseup', '1'], () => {});
  }
}

// ── Text field detection ────────────────────────────────────────────

function checkForTextField() {
  const script = path.join(__dirname, 'check-textfield.py');
  execFile('python3', [script], { timeout: 2000 }, (err, stdout) => {
    if (stdout && stdout.trim() === 'TEXT' && mouseModeActive && !keyboardProc) {
      launchKeyboard();
    }
  });
}

// ── Keyboard overlay ────────────────────────────────────────────────

function launchKeyboard() {
  if (keyboardProc) return;
  console.log('Launching keyboard overlay...');
  hideCursor();
  keyboardProc = spawn(ELECTRON, [path.join(APP_DIR, 'keyboard.js')], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  keyboardProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.includes('Gtk-WARNING')) console.log(`[keyboard] ${msg}`);
  });
  keyboardProc.on('exit', () => {
    console.log('Keyboard overlay exited');
    keyboardProc = null;
    voiceRecording = false;
    showCursor();
  });
}

function sendToKeyboard(cmd) {
  if (keyboardProc && keyboardProc.stdin && keyboardProc.stdin.writable) {
    keyboardProc.stdin.write(cmd + '\n');
  }
}

function killKeyboard() {
  if (!keyboardProc) return;
  console.log('Killing keyboard overlay...');
  voiceRecording = false;
  showCursor();
  const pid = keyboardProc.pid;
  keyboardProc.kill('SIGTERM');
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 2000);
  keyboardProc = null;
}

// ── B button ────────────────────────────────────────────────────────

function onBButton(pressed) {
  if (!pressed) return;
  if (keyboardProc) {
    killKeyboard();
  }
}

// ── Back button (⊙) — voice toggle when kb open, Super otherwise ──

function onBackButton(pressed) {
  if (!mouseModeActive) return;
  if (!pressed) return;
  resetIdleTimer();
  if (keyboardProc) {
    if (!voiceRecording) {
      voiceRecording = true;
      clearTimeout(idleTimer); idleTimer = null;
      sendToWhisper('RECORD');
      sendToKeyboard('VOICE_STATE:recording');
    } else {
      voiceRecording = false;
      resetIdleTimer();
      sendToWhisper('STOP');
      sendToKeyboard('VOICE_STATE:transcribing');
    }
  } else {
    execFile('xdotool', ['key', 'super'], () => {});
  }
}

// ── LB / RB — move text cursor ─────────────────────────────────────

function onLBButton(pressed) {
  if (!mouseModeActive || !keyboardProc) return;
  if (!pressed) return;
  resetIdleTimer();
  execFile('xdotool', ['key', 'Left'], () => {});
}

function onRBButton(pressed) {
  if (!mouseModeActive || !keyboardProc) return;
  if (!pressed) return;
  resetIdleTimer();
  execFile('xdotool', ['key', 'Right'], () => {});
}

// ── X button (backspace, hold to repeat) ────────────────────────────

let xRepeatTimer = null;

function onXButton(pressed) {
  if (!mouseModeActive || !keyboardProc) {
    clearInterval(xRepeatTimer); clearTimeout(xRepeatTimer);
    xRepeatTimer = null;
    return;
  }
  if (pressed) {
    resetIdleTimer();
    sendToKeyboard('BACKSPACE');
    xRepeatTimer = setTimeout(() => {
      xRepeatTimer = setInterval(() => { sendToKeyboard('BACKSPACE'); }, 80);
    }, 400);
  } else {
    clearTimeout(xRepeatTimer); clearInterval(xRepeatTimer);
    xRepeatTimer = null;
  }
}

// ── Y button (space) ────────────────────────────────────────────────

function onYButton(pressed) {
  if (!mouseModeActive || !keyboardProc) return;
  if (pressed) { resetIdleTimer(); sendToKeyboard('SPACE'); }
}

// ── D-pad (arrow keys — blocked when kb open) ───────────────────────

function onDpadX(value) {
  if (!mouseModeActive) return;
  resetIdleTimer();
  if (keyboardProc) { dpadLastX = value; return; }
  if (value === -32767 && dpadLastX !== -32767) execFile('xdotool', ['key', 'Left'], () => {});
  else if (value === 32767 && dpadLastX !== 32767) execFile('xdotool', ['key', 'Right'], () => {});
  dpadLastX = value;
}

function onDpadY(value) {
  if (!mouseModeActive) return;
  resetIdleTimer();
  if (keyboardProc) { dpadLastY = value; return; }
  if (value === -32767 && dpadLastY !== -32767) execFile('xdotool', ['key', 'Up'], () => {});
  else if (value === 32767 && dpadLastY !== 32767) execFile('xdotool', ['key', 'Down'], () => {});
  dpadLastY = value;
}

// ── Triggers (LT → Esc, RT → Enter) ────────────────────────────────

function onLeftTrigger(value) {
  if (!mouseModeActive) return;
  if (value > TRIGGER_THRESHOLD && !ltFired) {
    ltFired = true; resetIdleTimer();
    execFile('xdotool', ['key', 'Escape'], () => {});
  } else if (value < TRIGGER_THRESHOLD) { ltFired = false; }
}

function onRightTrigger(value) {
  if (!mouseModeActive) return;
  if (value > TRIGGER_THRESHOLD && !rtFired) {
    rtFired = true; resetIdleTimer();
    execFile('xdotool', ['key', 'Return'], () => {});
    if (keyboardProc) killKeyboard();
  } else if (value < TRIGGER_THRESHOLD) { rtFired = false; }
}

// ── Guide button (unchanged logic) ─────────────────────────────────

function onGuideButton(pressed) {
  if (pressed) {
    guideDown = true;
  } else {
    if (guideDown) {
      guideDown = false;
      if (electronProc) {
        killPatatin();
      } else {
        launchPatatin();
      }
    }
  }
}

// ── Electron lifecycle ──────────────────────────────────────────────

function findXboxControllers() {
  try {
    const content = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const blocks = content.split('\n\n');
    const paths = [];
    for (const block of blocks) {
      if (block.includes('X-Box') || block.includes('Xbox') || block.includes('xbox')) {
        const match = block.match(/H: Handlers=.*?(js\d+)/);
        if (match) paths.push(`/dev/input/${match[1]}`);
      }
    }
    return paths;
  } catch { return []; }
}

function launchPatatin(args = []) {
  if (electronProc) return;
  stopMouseMode();
  console.log('Launching Patatin...');
  electronProc = spawn(ELECTRON, [APP_DIR, ...args], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
    stdio: 'ignore',
  });
  electronProc.on('exit', () => {
    console.log('Patatin exited');
    electronProc = null;
  });
}

function killPatatin() {
  if (!electronProc) return;
  console.log('Killing Patatin...');
  electronProc.kill('SIGTERM');
  const pid = electronProc.pid;
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 2000);
  electronProc = null;
}

// ── Device reading ──────────────────────────────────────────────────

const devices = new Map();

function openDevice(jsPath) {
  if (devices.has(jsPath)) return;
  try {
    const fd = fs.openSync(jsPath, 'r');
    const entry = { fd, active: true };
    devices.set(jsPath, entry);
    const buf = Buffer.alloc(JS_EVENT_SIZE);

    const readLoop = () => {
      if (!entry.active) return;
      fs.read(fd, buf, 0, JS_EVENT_SIZE, null, (err, bytesRead) => {
        if (err || bytesRead !== JS_EVENT_SIZE) {
          entry.active = false;
          devices.delete(jsPath);
          try { fs.closeSync(fd); } catch {}
          return;
        }
        const value = buf.readInt16LE(4);
        const type = buf.readUInt8(6);
        const number = buf.readUInt8(7);
        const realType = type & ~JS_EVENT_INIT;
        const isInit = !!(type & JS_EVENT_INIT);

        if (realType === JS_EVENT_BUTTON && !isInit) {
          if (number === GUIDE_BUTTON) {
            onGuideButton(value === 1);
          } else if (number === BUTTON_A) {
            onAButton(value === 1);
          } else if (number === BUTTON_B) {
            onBButton(value === 1);
          } else if (number === BUTTON_X) {
            onXButton(value === 1);
          } else if (number === BUTTON_Y) {
            onYButton(value === 1);
          } else if (number === BUTTON_LB) {
            onLBButton(value === 1);
          } else if (number === BUTTON_RB) {
            onRBButton(value === 1);
          } else if (number === BUTTON_BACK) {
            onBackButton(value === 1);
          }
        } else if (realType === JS_EVENT_AXIS && !isInit) {
          if (number === AXIS_LEFT_X) {
            stickX = value;
            if (!mouseModeActive && !electronProc && Math.abs(value) > DEADZONE) {
              startMouseMode();
            }
            if (mouseModeActive) resetIdleTimer();
          } else if (number === AXIS_LEFT_Y) {
            stickY = value;
            if (!mouseModeActive && !electronProc && Math.abs(value) > DEADZONE) {
              startMouseMode();
            }
            if (mouseModeActive) resetIdleTimer();
          } else if (number === AXIS_RIGHT_X) {
            rStickX = value;
            if (mouseModeActive) resetIdleTimer();
          } else if (number === AXIS_RIGHT_Y) {
            rStickY = value;
            if (mouseModeActive) resetIdleTimer();
          } else if (number === AXIS_DPAD_X) {
            onDpadX(value);
          } else if (number === AXIS_DPAD_Y) {
            onDpadY(value);
          } else if (number === AXIS_LT) {
            onLeftTrigger(value);
          } else if (number === AXIS_RT) {
            onRightTrigger(value);
          }
        }
        readLoop();
      });
    };
    readLoop();
    console.log(`Listening on ${jsPath}`);
  } catch {}
}

function scan() {
  const paths = findXboxControllers();
  for (const p of paths) openDevice(p);
}

// Initial scan + periodic rescan for hotplug
scan();
setInterval(scan, 2000);

// Reset cursor on startup in case a previous session left it big
setCursor(CURSOR_THEME_NORMAL, CURSOR_SIZE_NORMAL);

console.log('Patatin listener started. Press Xbox Guide to toggle UI. Joystick → mouse when hidden.');
