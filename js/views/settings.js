import { fillPaletteSelect, getMode, setMode, setPalette, getPalette, onThemeChange, MODES, MODE_LABELS } from '../theme.js';
import * as settings from '../settings.js';
import { showToast } from '../toast.js';
import { SECTIONS, renderTabBar } from '../phoneNav.js';

// Settings: per-device preferences (all in localStorage).

const el = {};

function segmented(container, options, current, onPick) {
  container.innerHTML = '';
  options.forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scale-btn segmented-btn' + (value === current ? ' selected' : '');
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(value === current));
    btn.addEventListener('click', () => onPick(value));
    container.appendChild(btn);
  });
}

function renderTheme() {
  el.palette.value = getPalette();
  segmented(
    el.mode,
    MODES.map((m) => [m, MODE_LABELS[m]]),
    getMode(),
    (m) => setMode(m)
  );
}

function renderWeightUnit() {
  segmented(
    el.weightUnit,
    settings.WEIGHT_UNITS.map((u) => [u, u]),
    settings.getWeightUnit(),
    (u) => {
      settings.setWeightUnit(u);
      renderWeightUnit();
    }
  );
}

// Checkboxes limited to 4; the bar only changes once exactly 4 are picked
// (in section order).
let pickedTabs = null;

function renderPhoneTabs() {
  const picked = pickedTabs || settings.getPhoneTabs();
  const full = picked.length === settings.PHONE_TAB_COUNT;
  el.phoneTabs.innerHTML = '';
  SECTIONS.filter((s) => s.key !== 'settings').forEach(({ key, label }) => {
    const row = document.createElement('label');
    row.className = 'phone-tab-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = key;
    box.checked = picked.includes(key);
    box.disabled = full && !box.checked;
    box.addEventListener('change', () => togglePhoneTab(key, box.checked));
    const text = document.createElement('span');
    text.textContent = label;
    row.append(box, text);
    el.phoneTabs.appendChild(row);
  });
  const missing = settings.PHONE_TAB_COUNT - picked.length;
  el.phoneTabsNote.textContent = missing
    ? `Pick ${missing} more to update the bar. The rest are under More.`
    : 'The rest, and Settings, are under More. Only affects phone-width screens.';
}

function togglePhoneTab(key, on) {
  const picked = new Set(pickedTabs || settings.getPhoneTabs());
  if (on) picked.add(key);
  else picked.delete(key);
  const ordered = SECTIONS.map((s) => s.key).filter((k) => picked.has(k));
  if (ordered.length === settings.PHONE_TAB_COUNT) {
    settings.setPhoneTabs(ordered);
    pickedTabs = null;
    renderTabBar();
  } else {
    pickedTabs = ordered;
  }
  renderPhoneTabs();
  // Re-rendering replaced the checkbox; keep focus on this option.
  el.phoneTabs.querySelector(`input[value="${key}"]`)?.focus();
}

function render() {
  renderTheme();
  el.focus.value = String(settings.getFocusMinutes());
  renderWeightUnit();
  el.startView.value = settings.getStartView();
  renderPhoneTabs();
}

function handleFocusChange() {
  const n = Number(el.focus.value);
  if (!Number.isInteger(n) || n < 1 || n > 180) {
    showToast('Focus length should be a whole number of minutes from 1 to 180.', { type: 'error' });
    el.focus.value = String(settings.getFocusMinutes());
    return;
  }
  settings.setFocusMinutes(n);
  showToast(`Focus sessions now last ${n} min.`, { type: 'success', duration: 2000 });
}

export function initSettings() {
  Object.assign(el, {
    palette: document.getElementById('settings-palette'),
    mode: document.getElementById('settings-mode'),
    focus: document.getElementById('settings-focus'),
    weightUnit: document.getElementById('settings-weight-unit'),
    startView: document.getElementById('settings-start-view'),
    phoneTabs: document.getElementById('settings-phone-tabs'),
    phoneTabsNote: document.getElementById('settings-phone-tabs-note'),
  });
  fillPaletteSelect(el.palette);
  el.palette.addEventListener('change', () => setPalette(el.palette.value));
  settings.START_VIEWS.forEach(([key, label]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    el.startView.appendChild(opt);
  });
  el.startView.addEventListener('change', () => settings.setStartView(el.startView.value));
  el.focus.addEventListener('change', handleFocusChange);
  onThemeChange(renderTheme);
  render();
}

export function refreshSettings() {
  render();
}
