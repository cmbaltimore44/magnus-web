import { fetchSearchIndex } from './data/search.js';
import { showError } from './toast.js';
import { openTaskModal, refreshBoard } from './views/board.js';
import { openQuoteResult } from './views/library.js';
import { highlightRoutine } from './views/routines.js';
import { loadCommands, filterCommands } from './commands.js';

const PROJECT_STATUS_LABELS = { not_started: 'Not Started', in_progress: 'In Progress', done: 'Done' };
const TIME_OF_DAY_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const TYPE_ORDER = ['task', 'project', 'book', 'quote', 'routine'];
const TYPE_LABELS = { task: 'Tasks', project: 'Projects', book: 'Books', quote: 'Quotes', routine: 'Routines' };
const MAX_PER_GROUP = 8;
const SEARCH_HINT = '↑↓ to navigate · ↵ to open · > for commands · esc to close';
const COMMAND_HINT = '↑↓ to navigate · ↵ to run · esc to close';
const PICKER_HINT = 'Type to filter · ↑↓ to navigate · ↵ to pick · esc to close';

const el = {};
let index = [];
let renderedItems = [];
let activeIndex = -1;
let commands = [];
let searchPlaceholder = ''; // from index.html, restored after a picker
let picker = null; // while picking from a list (openPicker): { label, items, empty, typed }

// Typing ">" first (VS Code style) turns search into the command palette.
const isCommandMode = (term) => term.trimStart().startsWith('>');

function cacheElements() {
  Object.assign(el, {
    fab: document.getElementById('search-fab'),
    overlay: document.getElementById('search-modal-overlay'),
    input: document.getElementById('search-modal-input'),
    hint: document.getElementById('search-hint'),
    commandBtn: document.getElementById('command-btn'),
    results: document.getElementById('search-results'),
  });
  searchPlaceholder = el.input.placeholder;
}

function buildIndex({ tasks, projects, books, quotes, routines }) {
  const items = [];
  tasks.forEach((t) =>
    items.push({
      type: 'task',
      id: t.id,
      title: t.title,
      subtitle: t.notes || '',
      searchText: `${t.title} ${t.notes || ''}`.toLowerCase(),
      raw: t,
    })
  );
  projects.forEach((p) =>
    items.push({
      type: 'project',
      id: p.id,
      title: p.name,
      subtitle: PROJECT_STATUS_LABELS[p.status] || '',
      searchText: `${p.name} ${p.notes || ''}`.toLowerCase(),
      raw: p,
    })
  );
  books.forEach((b) =>
    items.push({
      type: 'book',
      id: b.id,
      title: b.title,
      subtitle: b.author || '',
      searchText: `${b.title} ${b.author || ''} ${b.notes || ''}`.toLowerCase(),
      raw: b,
    })
  );
  quotes.forEach((q) =>
    items.push({
      type: 'quote',
      id: q.id,
      title: q.quote_text,
      subtitle: q.attribution || '',
      searchText: `${q.quote_text} ${q.attribution || ''}`.toLowerCase(),
      raw: q,
    })
  );
  routines.forEach((r) =>
    items.push({
      type: 'routine',
      id: r.id,
      title: r.name,
      subtitle: TIME_OF_DAY_LABELS[r.time_of_day] || '',
      searchText: r.name.toLowerCase(),
      raw: r,
    })
  );
  return items;
}

function renderHint(text) {
  el.results.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = text;
  el.results.appendChild(hint);
}

function setActive(newIndex) {
  const rows = el.results.querySelectorAll('.search-result-row');
  rows.forEach((r) => r.classList.remove('active'));
  if (newIndex < 0 || newIndex >= rows.length) {
    activeIndex = -1;
    return;
  }
  activeIndex = newIndex;
  rows[activeIndex].classList.add('active');
  rows[activeIndex].scrollIntoView({ block: 'nearest' });
}

function renderRow(item) {
  const row = document.createElement('div');
  row.className = 'search-result-row';

  const title = document.createElement('div');
  title.className = 'search-result-title';
  title.textContent = item.title;
  row.appendChild(title);

  if (item.subtitle) {
    const subtitle = document.createElement('div');
    subtitle.className = 'search-result-subtitle';
    subtitle.textContent = item.subtitle;
    row.appendChild(subtitle);
  }

  row.addEventListener('click', () => selectResult(item));
  el.results.appendChild(row);
  renderedItems.push(item);
}

function renderCommands(query) {
  const matches = filterCommands(commands, query);
  if (!matches.length) {
    renderHint(commands.length ? 'No matching commands.' : 'Loading…');
    return;
  }
  const label = document.createElement('div');
  label.className = 'search-result-group-label';
  label.textContent = 'Commands';
  el.results.appendChild(label);
  matches.forEach((c) => renderRow({ type: 'command', title: c.label, subtitle: c.hint ? `Shortcut: ${c.hint}` : '', run: c.run }));
  setActive(0);
}

// Picker: the items in their given order, filtered by what's typed. The
// typed row (if any) comes after the matches, so enter still picks a real
// one; with no matches it's the only row.
function renderPicker(term) {
  const q = term.trim().toLowerCase();
  let matches = picker.items.filter((item) => item.title.toLowerCase().includes(q));
  const extra = q && picker.typed ? picker.typed(term) : null;
  if (extra) matches = [...matches, extra]; // every match contains q, so last (or alone)
  if (!matches.length) {
    renderHint(picker.empty);
    return;
  }
  const label = document.createElement('div');
  label.className = 'search-result-group-label';
  label.textContent = picker.label;
  el.results.appendChild(label);
  matches.forEach((item) => renderRow({ ...item, type: 'command' }));
  setActive(0);
}

function renderResults(term) {
  el.results.innerHTML = '';
  renderedItems = [];
  if (picker) {
    el.hint.textContent = PICKER_HINT;
    renderPicker(term);
    return;
  }
  el.hint.textContent = isCommandMode(term) ? COMMAND_HINT : SEARCH_HINT;
  if (isCommandMode(term)) {
    renderCommands(term.trimStart().slice(1));
    return;
  }
  const q = term.trim().toLowerCase();
  if (!q) {
    renderHint('Start typing to search tasks, projects, books, quotes, and routines.');
    return;
  }

  TYPE_ORDER.forEach((type) => {
    const matches = index
      .filter((item) => item.type === type && item.searchText.includes(q))
      .sort((a, b) => {
        const aRank = a.title.toLowerCase().includes(q) ? 0 : 1;
        const bRank = b.title.toLowerCase().includes(q) ? 0 : 1;
        return aRank - bRank;
      })
      .slice(0, MAX_PER_GROUP);
    if (matches.length === 0) return;

    const label = document.createElement('div');
    label.className = 'search-result-group-label';
    label.textContent = TYPE_LABELS[type];
    el.results.appendChild(label);

    matches.forEach(renderRow);
  });

  if (renderedItems.length === 0) {
    renderHint('No matches.');
    return;
  }
  setActive(0);
}

async function selectResult(item) {
  close();
  try {
    if (item.type === 'command') {
      await item.run();
    } else if (item.type === 'project') {
      location.hash = '#/projects/' + item.id;
    } else if (item.type === 'book') {
      location.hash = '#/library/books/' + item.id;
    } else if (item.type === 'task') {
      location.hash = '#/board';
      await refreshBoard();
      openTaskModal(item.id);
    } else if (item.type === 'quote') {
      await openQuoteResult(item.id, item.raw.book_id);
    } else if (item.type === 'routine') {
      location.hash = '#/routines';
      highlightRoutine(item.id);
    }
  } catch (err) {
    showError(err);
  }
}

export async function open(prefill = '') {
  picker = null;
  el.input.placeholder = searchPlaceholder;
  el.overlay.classList.add('open');
  el.input.value = prefill;
  commands = [];
  renderResults(prefill);
  el.input.focus();
  const [raw, cmds] = await Promise.all([
    fetchSearchIndex().catch((err) => {
      showError(err);
      return null;
    }),
    loadCommands(),
  ]);
  index = raw ? buildIndex(raw) : [];
  commands = cmds;
  renderResults(el.input.value);
}

export function openCommandPalette() {
  return open('>');
}

// The same box as a picker: items are { title, subtitle, run }, shown in
// order under `label` and filtered by typing; picking one runs it.
// typed(text) → an extra item for the text itself (or null), e.g. the focus
// timer's "Focus on “job apps”".
export function openPicker({ label, placeholder, items, empty = 'No matches.', typed = null }) {
  picker = { label, items, empty, typed };
  el.input.placeholder = placeholder;
  el.input.value = '';
  el.overlay.classList.add('open');
  renderResults('');
  el.input.focus();
}

function close() {
  el.overlay.classList.remove('open');
  picker = null;
  el.input.placeholder = searchPlaceholder;
}

export function initSearch() {
  cacheElements();

  el.fab.addEventListener('click', () => open());
  el.commandBtn.addEventListener('click', openCommandPalette);

  el.overlay.addEventListener('click', (e) => {
    if (e.target === el.overlay) close();
  });

  el.input.addEventListener('input', () => renderResults(el.input.value));

  el.input.addEventListener('keydown', (e) => {
    const rows = el.results.querySelectorAll('.search-result-row');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length) setActive((activeIndex + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((activeIndex - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && renderedItems[activeIndex]) selectResult(renderedItems[activeIndex]);
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      openCommandPalette();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && el.overlay.classList.contains('open')) {
      close();
    }
  });
}
