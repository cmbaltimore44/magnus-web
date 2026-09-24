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

const WEIGHT_UNIT_KEY = 'kanban.weightUnit';
export const WEIGHT_UNITS = ['lb', 'kg'];

// Just the label shown next to weights; stored values aren't converted.
export function getWeightUnit() {
  const unit = read(WEIGHT_UNIT_KEY);
  return WEIGHT_UNITS.includes(unit) ? unit : 'lb';
}

export function setWeightUnit(unit) {
  write(WEIGHT_UNIT_KEY, unit);
}

const START_VIEW_KEY = 'kanban.startView';
export const START_VIEWS = [
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['board', 'Board'],
  ['routines', 'Routines'],
  ['projects', 'Projects'],
  ['library', 'Library'],
  ['log', 'Log'],
  ['insights', 'Insights'],
];

// The view shown when the app opens without a #/view in the URL.
export function getStartView() {
  const view = read(START_VIEW_KEY);
  return START_VIEWS.some(([key]) => key === view) ? view : 'today';
}

export function setStartView(view) {
  write(START_VIEW_KEY, view);
}
