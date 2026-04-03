import { useEffect, useRef, useCallback } from 'react';

// Xbox 360 button indices (Web Gamepad API standard mapping)
export const BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16,
};

export const AXES = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3,
};

const STICK_THRESHOLD = 0.5;
const REPEAT_DELAY = 400;   // ms before repeat starts
const REPEAT_RATE = 120;    // ms between repeats

export function useGamepad(onInput) {
  const prevState = useRef({});
  const repeatTimers = useRef({});
  const animFrame = useRef(null);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const fireInput = useCallback((action, gamepadIndex = 0) => {
    onInputRef.current?.(action, gamepadIndex);
  }, []);

  const startRepeat = useCallback((key, action, gamepadIndex) => {
    if (repeatTimers.current[key]) return;
    // Fire immediately
    fireInput(action, gamepadIndex);
    // Then start repeat after delay
    repeatTimers.current[key] = setTimeout(() => {
      repeatTimers.current[key] = setInterval(() => {
        fireInput(action, gamepadIndex);
      }, REPEAT_RATE);
    }, REPEAT_DELAY);
  }, [fireInput]);

  const stopRepeat = useCallback((key) => {
    clearTimeout(repeatTimers.current[key]);
    clearInterval(repeatTimers.current[key]);
    delete repeatTimers.current[key];
  }, []);

  useEffect(() => {
    function pollGamepads() {
      const gamepads = navigator.getGamepads();

      for (let gi = 0; gi < gamepads.length; gi++) {
        const gp = gamepads[gi];
        if (!gp) continue;

        const prev = prevState.current[gi] || { buttons: [], axes: [] };
        const gpKey = (name) => `${gi}_${name}`;

        // D-pad and face buttons — press/release with repeat for directional
        const buttonActions = {
          [BUTTONS.A]: 'A',
          [BUTTONS.B]: 'B',
          [BUTTONS.X]: 'X',
          [BUTTONS.Y]: 'Y',
          [BUTTONS.LB]: 'LB',
          [BUTTONS.RB]: 'RB',
          [BUTTONS.BACK]: 'BACK',
          [BUTTONS.START]: 'START',
          [BUTTONS.DPAD_UP]: 'UP',
          [BUTTONS.DPAD_DOWN]: 'DOWN',
          [BUTTONS.DPAD_LEFT]: 'LEFT',
          [BUTTONS.DPAD_RIGHT]: 'RIGHT',
        };

        const repeatableActions = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);

        for (const [btnIdx, action] of Object.entries(buttonActions)) {
          const pressed = gp.buttons[btnIdx]?.pressed;
          const wasPressed = prev.buttons[btnIdx];

          if (pressed && !wasPressed) {
            if (repeatableActions.has(action)) {
              startRepeat(gpKey(action), action, gi);
            } else {
              fireInput(action, gi);
            }
          } else if (!pressed && wasPressed) {
            if (repeatableActions.has(action)) {
              stopRepeat(gpKey(action));
            }
          }
        }

        // Left stick as directional input
        const lx = gp.axes[AXES.LEFT_X] || 0;
        const ly = gp.axes[AXES.LEFT_Y] || 0;

        const stickDirs = {
          STICK_LEFT: lx < -STICK_THRESHOLD,
          STICK_RIGHT: lx > STICK_THRESHOLD,
          STICK_UP: ly < -STICK_THRESHOLD,
          STICK_DOWN: ly > STICK_THRESHOLD,
        };

        const stickToAction = {
          STICK_LEFT: 'LEFT',
          STICK_RIGHT: 'RIGHT',
          STICK_UP: 'UP',
          STICK_DOWN: 'DOWN',
        };

        for (const [stickDir, isActive] of Object.entries(stickDirs)) {
          const wasActive = prev[stickDir];
          if (isActive && !wasActive) {
            startRepeat(gpKey(stickDir), stickToAction[stickDir], gi);
          } else if (!isActive && wasActive) {
            stopRepeat(gpKey(stickDir));
          }
        }

        // Triggers (LT/RT) as scroll
        const lt = gp.buttons[BUTTONS.LT]?.value || 0;
        const rt = gp.buttons[BUTTONS.RT]?.value || 0;
        if (lt > 0.3 && !(prev.lt > 0.3)) fireInput('LT', gi);
        if (rt > 0.3 && !(prev.rt > 0.3)) fireInput('RT', gi);

        // Save state
        prevState.current[gi] = {
          buttons: gp.buttons.map(b => b.pressed),
          axes: [...gp.axes],
          lt,
          rt,
          STICK_LEFT: stickDirs.STICK_LEFT,
          STICK_RIGHT: stickDirs.STICK_RIGHT,
          STICK_UP: stickDirs.STICK_UP,
          STICK_DOWN: stickDirs.STICK_DOWN,
        };
      }

      animFrame.current = requestAnimationFrame(pollGamepads);
    }

    animFrame.current = requestAnimationFrame(pollGamepads);

    return () => {
      cancelAnimationFrame(animFrame.current);
      // Clear all repeat timers
      for (const key of Object.keys(repeatTimers.current)) {
        clearTimeout(repeatTimers.current[key]);
        clearInterval(repeatTimers.current[key]);
      }
      repeatTimers.current = {};
    };
  }, [startRepeat, stopRepeat, fireInput]);
}
