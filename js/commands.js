import * as tasksApi from './data/tasks.js';
import { PALETTES } from './palettes.js';
import { MODES, MODE_LABELS, setPalette, setMode } from './theme.js';
import { openQuickAdd } from './quickAddBar.js';
import { startFocus, stopFocus, isFocusRunning } from './focus.js';
import { openTaskModal, refreshBoard } from './views/board.js';
import { handleNewProject } from './views/projects.js';
import { handleNewBook } from './views/library.js';

// Actions for the command palette (⌘⇧P, or ">" in global search).

const VIEWS = [
  ['Today', '#/today'],
  ['Upcoming', '#/upcoming'],
  ['Board', '#/board'],
  ['Routines', '#/routines'],
  ['Projects', '#/projects'],
  ['Library', '#/library'],
  ['Quotes', '#/library/quotes'],
  ['Reading stats', '#/library/stats'],
  ['Log', '#/log'],
  ['Insights', '#/insights'],
];

const go = (hash) => () => {
  location.hash = hash;
};

// Commands that don't depend on data.
function staticCommands() {
  const list = [
    ...VIEWS.map(([label, hash]) => ({ label: `Go to ${label}`, run: go(hash) })),
    { label: 'Quick add', hint: 'a', run: openQuickAdd },
    {
      label: 'New task',
      run: async () => {
        location.hash = '#/board';
        await refreshBoard();
        openTaskModal(null, 'todo');
      },
    },
    { label: 'New project', run: handleNewProject },
    {
      label: 'New book',
      run: async () => {
        location.hash = '#/library';
        await handleNewBook();
      },
    },
    {
      label: 'Add log entry',
      run: () => {
        location.hash = '#/log';
        setTimeout(() => document.getElementById('log-sleep')?.focus(), 50);
      },
    },
    ...PALETTES.map((p) => ({ label: `Theme: ${p.label}`, run: () => setPalette(p.key) })),
    ...MODES.map((m) => ({ label: `Light/dark: ${MODE_LABELS[m]}`, run: () => setMode(m) })),
    { label: 'Sign out', run: () => document.getElementById('sign-out-btn').click() },
  ];
  if (isFocusRunning()) list.unshift({ label: 'Stop focus timer', run: stopFocus });
  return list;
}

// Everything, including "Focus: <task>" for each open task.
export async function loadCommands() {
  let tasks = [];
  try {
    tasks = await tasksApi.listTasks();
  } catch {
    // the rest of the palette still works
  }
  const focus = tasks
    .filter((t) => t.status !== 'done')
    .map((t) => ({ label: `Focus: ${t.title}`, run: () => startFocus({ id: t.id, title: t.title }) }));
  return [...staticCommands(), ...focus];
}

// Fuzzy match: every query character in order; contiguous runs and word
// starts score higher. Returns -1 for no match.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return -1;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || /[\s:]/.test(t[i - 1])) score += 2;
    last = i;
    from = i + 1;
  }
  return score - t.length * 0.01;
}

// "Light/dark: Dark" — a match on the part after the colon counts extra, so
// "dark" finds Dark rather than every Light/dark entry.
function labelScore(query, label) {
  const whole = fuzzyScore(query, label);
  const colon = label.indexOf(': ');
  if (colon < 0) return whole;
  const tail = fuzzyScore(query, label.slice(colon + 2));
  return tail >= 0 ? Math.max(whole, tail + 5) : whole;
}

export function filterCommands(commands, query, limit = 40) {
  if (!query.trim()) return commands.filter((c) => !c.label.startsWith('Focus: ')).slice(0, limit);
  return commands
    .map((c) => ({ c, s: labelScore(query, c.label) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}
