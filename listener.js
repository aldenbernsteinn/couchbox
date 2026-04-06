#!/usr/bin/env node
// Patatin Listener — tiny service that waits for Xbox Guide button
// Spawns/kills Electron on press. Zero overhead when UI is not shown.

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const ELECTRON = path.join(__dirname, 'app', 'node_modules', 'electron', 'dist', 'electron');
const APP_DIR = path.join(__dirname, 'app');
const JS_EVENT_SIZE = 8;
const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_INIT = 0x80;
const GUIDE_BUTTON = 8;
const LONG_PRESS_MS = 800;

let electronProc = null;
let guideDown = false;
let longPressTimer = null;

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
  if (electronProc) return; // already running
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
  // Force kill after 2s if still alive
  const pid = electronProc.pid;
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 2000);
  electronProc = null;
}

function onGuideButton(pressed) {
  if (pressed) {
    guideDown = true;
    longPressTimer = setTimeout(() => {
      // Long press — launch with shutdown overlay
      guideDown = false;
      if (electronProc) killPatatin();
      setTimeout(() => launchPatatin(['--shutdown-overlay']), 300);
    }, LONG_PRESS_MS);
  } else {
    if (guideDown) {
      // Short press — toggle
      clearTimeout(longPressTimer);
      guideDown = false;
      if (electronProc) {
        killPatatin();
      } else {
        launchPatatin();
      }
    }
  }
}

// Open controller devices
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
        if ((type & ~JS_EVENT_INIT) === JS_EVENT_BUTTON && number === GUIDE_BUTTON && !(type & JS_EVENT_INIT)) {
          onGuideButton(value === 1);
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

console.log('Patatin listener started. Press Xbox Guide to toggle UI.');
