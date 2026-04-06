const fs = require('fs');

// Linux joystick event struct: 4 bytes time, 2 bytes value, 1 byte type, 1 byte number = 8 bytes
const JS_EVENT_SIZE = 8;
const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_INIT = 0x80;
const GUIDE_BUTTON = 8; // Xbox guide button number on Linux js interface

class ControllerGrab {
  constructor(onGuideButton) {
    this.onGuideButton = onGuideButton;
    this.devices = new Map(); // jsPath -> { fd, active }
    this._pollInterval = null;
  }

  // Find Xbox controllers by reading /proc/bus/input/devices
  findXboxControllers() {
    try {
      const content = fs.readFileSync('/proc/bus/input/devices', 'utf8');
      const blocks = content.split('\n\n');
      const jsPaths = [];

      for (const block of blocks) {
        if (block.includes('X-Box') || block.includes('Xbox') || block.includes('xbox')) {
          const match = block.match(/H: Handlers=.*?(js\d+)/);
          if (match) {
            jsPaths.push(`/dev/input/${match[1]}`);
          }
        }
      }
      return jsPaths;
    } catch {
      return [];
    }
  }

  start() {
    // Initial scan
    this._scanAndOpen();

    // Re-scan every 2 seconds for hotplug
    this._pollInterval = setInterval(() => this._scanAndOpen(), 2000);
  }

  _scanAndOpen() {
    const jsPaths = this.findXboxControllers();
    for (const jsPath of jsPaths) {
      if (!this.devices.has(jsPath)) {
        this._openDevice(jsPath);
      }
    }
  }

  _openDevice(jsPath) {
    try {
      // Open in read-only, non-blocking mode
      const fd = fs.openSync(jsPath, 'r');
      const entry = { fd, active: true };
      this.devices.set(jsPath, entry);

      const buf = Buffer.alloc(JS_EVENT_SIZE);

      const readLoop = () => {
        if (!entry.active) return;

        fs.read(fd, buf, 0, JS_EVENT_SIZE, null, (err, bytesRead) => {
          if (err || bytesRead !== JS_EVENT_SIZE) {
            // Device disconnected or error
            entry.active = false;
            this.devices.delete(jsPath);
            try { fs.closeSync(fd); } catch {}
            return;
          }

          const value = buf.readInt16LE(4);
          const type = buf.readUInt8(6);
          const number = buf.readUInt8(7);

          // Only care about button events (not init), specifically the guide button
          if ((type & ~JS_EVENT_INIT) === JS_EVENT_BUTTON && number === GUIDE_BUTTON) {
            if (!(type & JS_EVENT_INIT)) {
              // Real event, not initial state report
              this.onGuideButton(value === 1); // true = pressed, false = released
            }
          }

          readLoop();
        });
      };

      readLoop();
    } catch {
      // Permission denied or device not available
    }
  }

  stop() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    for (const [jsPath, entry] of this.devices) {
      entry.active = false;
      try { fs.closeSync(entry.fd); } catch {}
    }
    this.devices.clear();
  }
}

module.exports = { ControllerGrab };
