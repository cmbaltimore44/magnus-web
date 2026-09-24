// Per-device preferences (localStorage, "kanban." prefix like the other keys).
// Color palette and light/dark live in theme-boot.js.

const FOCUS_KEY = 'kanban.focusMinutes';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode / storage full: the setting just won't stick
  }
}

export const DEFAULT_FOCUS_MINUTES = 25;

export function getFocusMinutes() {
  const n = Number(read(FOCUS_KEY));
  return Number.isInteger(n) && n >= 1 && n <= 180 ? n : DEFAULT_FOCUS_MINUTES;
}

export function setFocusMinutes(minutes) {
  write(FOCUS_KEY, minutes);
}
