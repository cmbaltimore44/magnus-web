import { PALETTES } from './palettes.js';

// Theme state and application live in js/theme-boot.js (loaded in <head> so
// the saved theme applies before first paint); this wires up the controls.
const MODES = ['auto', 'light', 'dark'];
const MODE_ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
const MODE_TITLE = {
  auto: 'Light/dark: following system (click for light)',
  light: 'Light/dark: light (click for dark)',
  dark: 'Light/dark: dark (click to follow system)',
};

export function initTheme(toggleBtn, paletteSelect) {
  const theme = window.lifeTrackerTheme;
  if (!theme) return;

  const renderMode = () => {
    const mode = theme.getMode();
    toggleBtn.textContent = MODE_ICON[mode] || MODE_ICON.auto;
    toggleBtn.title = MODE_TITLE[mode] || MODE_TITLE.auto;
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
  };
  toggleBtn.addEventListener('click', () => {
    const next = MODES[(MODES.indexOf(theme.getMode()) + 1) % MODES.length];
    theme.setMode(next);
    renderMode();
  });
  renderMode();

  if (paletteSelect) {
    paletteSelect.innerHTML = '';
    for (const { key, label } of PALETTES) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      paletteSelect.appendChild(opt);
    }
    const current = theme.getPalette();
    paletteSelect.value = PALETTES.some((p) => p.key === current) ? current : PALETTES[0].key;
    paletteSelect.addEventListener('change', () => theme.setPalette(paletteSelect.value));
  }
}
