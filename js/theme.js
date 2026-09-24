import { PALETTES } from './palettes.js';

// Theme state and application live in js/theme-boot.js (loaded in <head> so
// the saved theme applies before first paint); this wires up the controls
// (sidebar, Settings, command palette) and keeps them in step.
export const MODES = ['auto', 'light', 'dark'];
export const MODE_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const MODE_ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
const MODE_TITLE = {
  auto: 'Light/dark: following system (click for light)',
  light: 'Light/dark: light (click for dark)',
  dark: 'Light/dark: dark (click to follow system)',
};

const listeners = [];

function theme() {
  return window.lifeTrackerTheme;
}

export function getPalette() {
  const current = theme()?.getPalette();
  return PALETTES.some((p) => p.key === current) ? current : PALETTES[0].key;
}

export function getMode() {
  return theme()?.getMode() || 'auto';
}

export function setPalette(key) {
  theme()?.setPalette(key);
  listeners.forEach((fn) => fn());
}

export function setMode(mode) {
  theme()?.setMode(mode);
  listeners.forEach((fn) => fn());
}

// Called whenever the palette or mode changes from any control.
export function onThemeChange(fn) {
  listeners.push(fn);
}

export function fillPaletteSelect(select) {
  select.innerHTML = '';
  for (const { key, label } of PALETTES) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = getPalette();
}

export function initTheme(toggleBtn, paletteSelect) {
  if (!theme()) return;

  const render = () => {
    const mode = getMode();
    toggleBtn.textContent = MODE_ICON[mode] || MODE_ICON.auto;
    toggleBtn.title = MODE_TITLE[mode] || MODE_TITLE.auto;
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
    if (paletteSelect) paletteSelect.value = getPalette();
  };
  toggleBtn.addEventListener('click', () => {
    setMode(MODES[(MODES.indexOf(getMode()) + 1) % MODES.length]);
  });

  if (paletteSelect) {
    fillPaletteSelect(paletteSelect);
    paletteSelect.addEventListener('change', () => setPalette(paletteSelect.value));
  }
  onThemeChange(render);
  render();
}
