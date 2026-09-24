// Per-device preferences (localStorage, "kanban." prefix like the other keys).
// Color palette and light/dark live in theme-boot.js.

import { settingsFrom } from './pomodoro.js';

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

// Pomodoro lengths (minutes) and the long-break interval, validated by the
// shared engine (js/pomodoro.js). The old single "focus length" key is still
// read as the focus length until the first save.
const POMODORO_KEY = 'kanban.pomodoroSettings';

export function getPomodoroSettings() {
  let raw = {};
  try {
    raw = JSON.parse(read(POMODORO_KEY)) || {};
  } catch {
    raw = {};
  }
  if (raw.focus == null && read(FOCUS_KEY) != null) raw = { ...raw, focus: read(FOCUS_KEY) };
  return settingsFrom(raw);
}

export function setPomodoroSettings(values) {
  write(POMODORO_KEY, JSON.stringify(settingsFrom({ ...getPomodoroSettings(), ...values })));
}

export function getFocusMinutes() {
  return getPomodoroSettings().focus;
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
  ['lists', 'Lists'],
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

// Phone tab bar (js/phoneNav.js): the 4 sections pinned to the bottom bar on
// phone-width screens; everything else is under "More". Settings always
// lives in More, so it can't be pinned.
const PHONE_TABS_KEY = 'kanban.phoneTabs';
export const PHONE_TAB_COUNT = 4;
export const DEFAULT_PHONE_TABS = ['today', 'upcoming', 'lists', 'library'];

export function getPhoneTabs() {
  try {
    const tabs = JSON.parse(read(PHONE_TABS_KEY));
    const valid = new Set(START_VIEWS.map(([key]) => key));
    if (
      Array.isArray(tabs) &&
      tabs.length === PHONE_TAB_COUNT &&
      new Set(tabs).size === PHONE_TAB_COUNT &&
      tabs.every((t) => valid.has(t))
    ) {
      return tabs;
    }
  } catch {
    // unreadable: fall back to the default
  }
  return [...DEFAULT_PHONE_TABS];
}

export function setPhoneTabs(tabs) {
  write(PHONE_TABS_KEY, JSON.stringify(tabs));
}
