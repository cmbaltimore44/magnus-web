import { supabase } from './supabaseClient.js';
import { getPhoneTabs } from './settings.js';
import { groupUpcoming } from './stats.js';
import { todayISO } from './dates.js';
import { dueStatus } from './taskDisplay.js';

// Phone-width navigation (style.css hides all of this above 720px, where the
// sidebar is used): a bottom tab bar with the 4 pinned sections (Settings →
// "Tab bar on phones") plus "More", which opens a bottom sheet with every
// other section as a tile, each with a live number where one makes sense.

export const SECTIONS = [
  { key: 'today', label: 'Today', icon: '☀️' },
  { key: 'upcoming', label: 'Upcoming', icon: '📅' },
  { key: 'board', label: 'Board', icon: '📋' },
  { key: 'routines', label: 'Routines', icon: '🔁' },
  { key: 'projects', label: 'Projects', icon: '🧩' },
  { key: 'lists', label: 'Lists', icon: '📝' },
  { key: 'library', label: 'Library', icon: '📚' },
  { key: 'log', label: 'Log', icon: '✏️' },
  { key: 'insights', label: 'Insights', icon: '📈' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

const PHONE = window.matchMedia('(max-width: 720px)');

const el = {};
let activeView = null;
let lastFocus = null;
let countsRun = 0;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ---------- live numbers (one light query per table, only for tiles shown) ----------

function makeLoaders() {
  const cache = {};
  const once = (key, fn) => (cache[key] ||= fn());
  const today = todayISO();
  return {
    tasks: () => once('tasks', () => rows(supabase.from('tasks').select('status, due_date, is_starred'))),
    projects: () => once('projects', () => rows(supabase.from('projects').select('status, target_date'))),
    today,
  };
}

const COUNTS = {
  today: async (d) => {
    const n = (await d.tasks()).filter((t) => t.is_starred && t.status !== 'done').length;
    return `${n} starred`;
  },
  upcoming: async (d) => {
    const groups = groupUpcoming(await d.tasks(), await d.projects(), d.today);
    const n = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    return `${n} this week`;
  },
  board: async (d) => {
    const tasks = await d.tasks();
    const overdue = tasks.filter((t) => dueStatus(t) === 'overdue').length;
    if (overdue) return `${overdue} overdue`;
    return `${tasks.filter((t) => t.status !== 'done').length} open`;
  },
  routines: async (d) => {
    const [routines, done] = await Promise.all([
      rows(supabase.from('routines').select('id')),
      rows(supabase.from('routine_completions').select('routine_id').eq('completed_date', d.today)),
    ]);
    const ids = new Set(routines.map((r) => r.id));
    const doneToday = new Set(done.map((c) => c.routine_id).filter((id) => ids.has(id))).size;
    return `${doneToday}/${routines.length} today`;
  },
  projects: async (d) => `${(await d.projects()).filter((p) => p.status !== 'done').length} active`,
  lists: async () => {
    const items = await rows(supabase.from('list_items').select('done'));
    return `${items.filter((i) => !i.done).length} unchecked`;
  },
  library: async () => {
    const books = await rows(supabase.from('books').select('status'));
    return `${books.filter((b) => b.status === 'want_to_read').length} want to read`;
  },
  log: async (d) => {
    const entries = await rows(supabase.from('log_entries').select('id').eq('entry_date', d.today).limit(1));
    return entries.length ? 'logged today ✓' : 'not logged today';
  },
};

// Fills in each tile's number as its query comes back; a failed query
// (offline with nothing saved, table not migrated yet…) just leaves it blank.
function loadCounts(tiles) {
  const run = ++countsRun;
  const loaders = makeLoaders();
  tiles.forEach(({ key, countEl }) => {
    const count = COUNTS[key];
    if (!count) return;
    count(loaders)
      .then((text) => {
        if (run === countsRun) countEl.textContent = text;
      })
      .catch(() => {});
  });
}

// ---------- tab bar ----------

function navigate(key) {
  location.hash = '#/' + key;
}

function tabButton({ key, label, icon }, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tabbar-item';
  btn.dataset.view = key;
  const iconEl = document.createElement('span');
  iconEl.className = 'tabbar-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const labelEl = document.createElement('span');
  labelEl.className = 'tabbar-label';
  labelEl.textContent = label;
  btn.append(iconEl, labelEl);
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderTabBar() {
  const pins = getPhoneTabs();
  el.bar.innerHTML = '';
  SECTIONS.filter((s) => pins.includes(s.key)).forEach((section) => {
    el.bar.appendChild(tabButton(section, () => navigate(section.key)));
  });
  el.moreBtn = tabButton({ key: 'more', label: 'More', icon: '•••' }, openSheet);
  el.moreBtn.setAttribute('aria-haspopup', 'dialog');
  el.moreBtn.setAttribute('aria-controls', 'more-sheet');
  el.moreBtn.setAttribute('aria-expanded', String(!!el.overlay && sheetOpen()));
  el.bar.appendChild(el.moreBtn);
  if (activeView) setPhoneNavActive(activeView);
}

export function setPhoneNavActive(view) {
  activeView = view;
  if (!el.bar) return;
  const pinned = getPhoneTabs().includes(view);
  el.bar.querySelectorAll('.tabbar-item').forEach((btn) => {
    const on = btn.dataset.view === 'more' ? !pinned : btn.dataset.view === view;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

// ---------- More sheet ----------

function tile({ key, label, icon }, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'more-tile' + (key === activeView ? ' active' : '');
  if (key === activeView) btn.setAttribute('aria-current', 'page');
  const iconEl = document.createElement('span');
  iconEl.className = 'more-tile-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const labelEl = document.createElement('span');
  labelEl.className = 'more-tile-label';
  labelEl.textContent = label;
  const countEl = document.createElement('span');
  countEl.className = 'more-tile-count';
  btn.append(iconEl, labelEl, countEl);
  btn.addEventListener('click', onClick);
  return { btn, countEl };
}

function renderSheet() {
  const pins = getPhoneTabs();
  el.grid.innerHTML = '';
  const tiles = [];
  SECTIONS.filter((s) => !pins.includes(s.key)).forEach((section) => {
    const { btn, countEl } = tile(section, () => {
      closeSheet(false);
      navigate(section.key);
    });
    el.grid.appendChild(btn);
    tiles.push({ key: section.key, countEl });
  });
  const actions = [
    { key: 'commands', label: 'Commands', icon: '⌘', target: 'command-btn' },
    { key: 'signout', label: 'Sign out', icon: '↩', target: 'sign-out-btn' },
  ];
  actions.forEach((action) => {
    const { btn } = tile(action, () => {
      closeSheet(false);
      document.getElementById(action.target)?.click();
    });
    btn.classList.add('more-tile-action');
    el.grid.appendChild(btn);
  });
  loadCounts(tiles);
}

function sheetOpen() {
  return el.overlay.classList.contains('open');
}

function openSheet() {
  if (sheetOpen()) return;
  lastFocus = document.activeElement;
  renderSheet();
  el.overlay.classList.add('open');
  el.moreBtn?.setAttribute('aria-expanded', 'true');
  // Next frame so the slide-up transition runs from the closed position.
  requestAnimationFrame(() => {
    el.overlay.classList.add('shown');
    el.close.focus();
  });
}

function closeSheet(restoreFocus = true) {
  if (!sheetOpen()) return;
  countsRun++;
  el.overlay.classList.remove('open', 'shown');
  el.moreBtn?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  else if (!restoreFocus) el.moreBtn?.focus({ preventScroll: true });
  lastFocus = null;
}

// Keep Tab inside the sheet while it's open.
function trapFocus(e) {
  const focusable = [...el.sheet.querySelectorAll('button')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function initPhoneNav() {
  Object.assign(el, {
    bar: document.getElementById('phone-tabbar'),
    overlay: document.getElementById('more-sheet-overlay'),
    sheet: document.getElementById('more-sheet'),
    grid: document.getElementById('more-sheet-grid'),
    close: document.getElementById('more-sheet-close'),
  });
  renderTabBar();
  el.close.addEventListener('click', () => closeSheet());
  el.overlay.addEventListener('click', (e) => {
    if (e.target === el.overlay) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (!sheetOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  });
  window.addEventListener('hashchange', () => closeSheet(false));
  // Rotating / resizing to the desktop layout hides the bar: don't leave the sheet up.
  PHONE.addEventListener('change', () => {
    if (!PHONE.matches) closeSheet(false);
  });
}
