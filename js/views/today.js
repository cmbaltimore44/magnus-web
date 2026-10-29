import * as tasksApi from '../data/tasks.js';
import * as categoriesApi from '../data/categories.js';
import * as routinesApi from '../data/routines.js';
import * as completionsApi from '../data/completions.js';
import * as quotesApi from '../data/quotes.js';
import * as booksApi from '../data/books.js';
import { loadGoals } from '../data/lists.js';
import { getCategory as getCategoryFrom, dueStatus, formatDue, repeatBadge } from '../taskDisplay.js';
import { describeRepeat } from '../repeat.js';
import { showError } from '../toast.js';
import { renderYesterdayChip, yesterdayISO } from '../yesterdayChip.js';
import * as assistantApi from '../data/assistant.js';
import { isMissingSchema } from '../schema.js';

const TIME_OF_DAY_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

let tasks = [];
let categories = [];
let routines = [];
let completions = new Map();
let quote = null;
let books = [];
let goals = [];
let userId = null;
let dayClosed = null; // null = unknown or no schema_007: the control stays hidden

// "Done for today" shows from this hour on (local time).
const CLOSE_FROM_HOUR = 17;

const el = {};

function cacheElements() {
  Object.assign(el, {
    date: document.getElementById('today-date'),
    starredList: document.getElementById('today-starred-list'),
    quote: document.getElementById('today-quote'),
    routinesWidget: document.getElementById('today-routines-widget'),
    goals: document.getElementById('today-goals'),
    close: document.getElementById('today-close'),
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

// Evenings: close the day without journaling, so the 10 pm "Close the day?"
// push doesn't come. After closing it reads "Day closed · undo".
function renderClose() {
  if (!el.close) return;
  el.close.replaceChildren();
  el.close.hidden = dayClosed === null || new Date().getHours() < CLOSE_FROM_HOUR;
  if (el.close.hidden) return;
  const day = completionsApi.todayISO();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost';
  if (dayClosed) {
    const note = document.createElement('span');
    note.className = 'today-close-note';
    note.textContent = 'Day closed';
    el.close.appendChild(note);
    button.textContent = 'Undo';
    button.setAttribute('aria-label', 'Undo: reopen today');
  } else {
    button.textContent = 'Done for today';
    button.title = 'Close the day: no "Close the day?" notification tonight';
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await assistantApi.setDayClosed(userId, day, !dayClosed);
      dayClosed = !dayClosed;
    } catch (err) {
      showError(err);
    }
    renderClose();
  });
  el.close.appendChild(button);
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

    const repeat = repeatBadge(task, describeRepeat);
    if (repeat) meta.appendChild(repeat);

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

      row.appendChild(renderYesterdayChip(dates, (checked) => toggleCompletion(routine, checked, yesterdayISO())));

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

// day: today, or yesterday from the chip on the row.
async function toggleCompletion(routine, checked, day = completionsApi.todayISO()) {
  const dates = completions.get(routine.id) || new Set();
  try {
    if (checked) {
      await completionsApi.markComplete(routine.user_id, routine.id, day);
      dates.add(day);
    } else {
      await completionsApi.markIncomplete(routine.id, day);
      dates.delete(day);
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

export async function initToday(uid) {
  userId = uid;
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
  // Before schema_007 (or offline) the close control just stays hidden.
  dayClosed = await assistantApi.isDayClosed(completionsApi.todayISO()).catch((err) => (isMissingSchema(err) ? null : dayClosed));
  renderGoals();
  renderStarred();
  renderRoutinesWidget();
  renderQuote();
  renderClose();
}
