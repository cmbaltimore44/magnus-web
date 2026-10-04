import * as tasksApi from '../data/tasks.js';
import * as categoriesApi from '../data/categories.js';
import * as routinesApi from '../data/routines.js';
import * as completionsApi from '../data/completions.js';
import * as quotesApi from '../data/quotes.js';
import * as booksApi from '../data/books.js';
import { loadGoals } from '../data/lists.js';
import { getCategory as getCategoryFrom, dueStatus, formatDue } from '../taskDisplay.js';
import { showError } from '../toast.js';

const TIME_OF_DAY_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

let tasks = [];
let categories = [];
let routines = [];
let completions = new Map();
let quote = null;
let books = [];
let goals = [];

const el = {};

function cacheElements() {
  Object.assign(el, {
    date: document.getElementById('today-date'),
    starredList: document.getElementById('today-starred-list'),
    quote: document.getElementById('today-quote'),
    routinesWidget: document.getElementById('today-routines-widget'),
    goals: document.getElementById('today-goals'),
  });
}

function getCategory(categoryId) {
  return getCategoryFrom(categories, categoryId);
}

// Your active goals (the unchecked items of a list named "Goals"), as a
// strip under the header; tapping it opens the list.
function renderGoals() {
  if (!el.goals) return;
  el.goals.replaceChildren();
  el.goals.hidden = goals.length === 0;
  if (!goals.length) return;
  const link = document.createElement('a');
  link.className = 'today-goals-link';
  link.href = `#/lists/${goals[0].list_id}`;
  const label = document.createElement('span');
  label.className = 'today-goals-label';
  label.textContent = 'Goals';
  link.appendChild(label);
  const ul = document.createElement('ul');
  ul.className = 'today-goals-list';
  for (const g of goals) {
    const li = document.createElement('li');
    li.textContent = g.text;
    ul.appendChild(li);
  }
  link.appendChild(ul);
  el.goals.appendChild(link);
}

function renderDate() {
  el.date.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function renderStarred() {
  el.starredList.innerHTML = '';
  const starred = tasks.filter((t) => t.is_starred).slice(0, 3);

  if (starred.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Star up to 3 tasks on the Board to feature them here.';
    el.starredList.appendChild(hint);
    return;
  }

  starred.forEach((task) => {
    const card = document.createElement('div');
    card.className = 'task-card' + (task.status === 'done' ? ' done' : '');

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'task-meta';

    const dot = document.createElement('span');
    dot.className = 'priority-dot priority-' + (task.priority || 'medium');
    meta.appendChild(dot);

    const cat = getCategory(task.category_id);
    if (cat) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.setProperty('--chip-color', cat.color);
      chip.textContent = cat.name;
      meta.appendChild(chip);
    }

    if (task.due_date) {
      const badge = document.createElement('span');
      const status = dueStatus(task);
      badge.className = 'due-badge' + (status ? ' ' + status : '');
      badge.textContent = (status === 'overdue' ? 'Overdue · ' : '') + formatDue(task.due_date);
      meta.appendChild(badge);
    }

    card.appendChild(meta);
    el.starredList.appendChild(card);
  });
}

function renderRoutinesWidget() {
  const staticHeader = el.routinesWidget.firstElementChild;
  el.routinesWidget.innerHTML = '';
  el.routinesWidget.appendChild(staticHeader);

  const today = completionsApi.todayISO();

  ['morning', 'afternoon', 'evening'].forEach((tod) => {
    const groupRoutines = routines
      .filter((r) => r.time_of_day === tod)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (groupRoutines.length === 0) return;

    const header = document.createElement('div');
    header.className = 'routine-group-header';
    const h3 = document.createElement('h2');
    h3.textContent = TIME_OF_DAY_LABELS[tod];
    header.appendChild(h3);
    el.routinesWidget.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'routine-list';

    groupRoutines.forEach((routine) => {
      const dates = completions.get(routine.id) || new Set();
      const isDone = dates.has(today);
      const streak = completionsApi.computeStreak(dates, today);

      const row = document.createElement('li');
      row.className = 'routine-row' + (isDone ? ' completed' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'routine-check';
      checkbox.checked = isDone;
      checkbox.addEventListener('change', () => toggleCompletion(routine, checkbox.checked));
      row.appendChild(checkbox);

      const name = document.createElement('span');
      name.className = 'routine-name';
      name.textContent = routine.name;
      row.appendChild(name);

      if (streak > 0) {
        const streakBadge = document.createElement('span');
        streakBadge.className = 'routine-streak';
        streakBadge.textContent = `🔥 ${streak}`;
        row.appendChild(streakBadge);
      }

      list.appendChild(row);
    });

    el.routinesWidget.appendChild(list);
  });

  if (routines.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No routines yet.';
    el.routinesWidget.appendChild(hint);
  }
}

async function toggleCompletion(routine, checked) {
  const today = completionsApi.todayISO();
  const dates = completions.get(routine.id) || new Set();
  try {
    if (checked) {
      await completionsApi.markComplete(routine.user_id, routine.id, today);
      dates.add(today);
    } else {
      await completionsApi.markIncomplete(routine.id, today);
      dates.delete(today);
    }
    completions.set(routine.id, dates);
    renderRoutinesWidget();
  } catch (err) {
    showError(err);
    renderRoutinesWidget();
  }
}

function renderQuote() {
  el.quote.innerHTML = '';
  if (!quote) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Add a book highlight or quote to your Library to feature one here.';
    el.quote.appendChild(hint);
    return;
  }

  const text = document.createElement('div');
  text.className = 'quote-text';
  text.textContent = `“${quote.quote_text}”`;
  el.quote.appendChild(text);

  const formattedAttribution = quotesApi.formatAttribution(quote, books);
  if (formattedAttribution) {
    const attribution = document.createElement('div');
    attribution.className = 'quote-attribution';
    attribution.textContent = formattedAttribution;
    el.quote.appendChild(attribution);
  }
}

export async function initToday() {
  cacheElements();
  renderDate();
  await refreshToday();
}

export async function refreshToday() {
  try {
    [tasks, categories, routines, completions, books, goals] = await Promise.all([
      tasksApi.listTasks(),
      categoriesApi.listCategories(),
      routinesApi.listRoutines(),
      completionsApi.listCompletions(),
      booksApi.listBooks(),
      loadGoals(),
    ]);
    // Only roll a new featured quote when there isn't one yet, so refocusing
    // the tab (which re-triggers this refresh) doesn't swap it out under you.
    if (!quote) quote = await quotesApi.pickRandomQuote().catch(() => null); // no quote rather than no Today
  } catch (err) {
    showError(err);
    return;
  }
  renderGoals();
  renderStarred();
  renderRoutinesWidget();
  renderQuote();
}
