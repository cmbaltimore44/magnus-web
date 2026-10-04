import * as tasksApi from '../data/tasks.js';
import * as projectsApi from '../data/projects.js';
import * as categoriesApi from '../data/categories.js';
import { groupUpcoming, UPCOMING_GROUPS, UPCOMING_LABELS } from '../stats.js';
import { todayISO } from '../dates.js';
import { getCategory, formatDue } from '../taskDisplay.js';
import { openTaskModal, refreshBoard } from './board.js';
import { showActionToast, showError } from '../toast.js';
import { notifyDataChanged } from '../events.js';

// Upcoming: open tasks (due date) and unfinished projects (target date),
// overdue through the next 7 days.

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

let tasks = [];
let projects = [];
let categories = [];

const el = {};

function cacheElements() {
  Object.assign(el, {
    list: document.getElementById('upcoming-list'),
    count: document.getElementById('upcoming-count'),
  });
}

function render() {
  const today = todayISO();
  const groups = groupUpcoming(tasks, projects, today);
  const total = UPCOMING_GROUPS.reduce((n, g) => n + groups[g].length, 0);
  el.count.textContent = total ? `${total} item${total === 1 ? '' : 's'}` : '';
  el.list.innerHTML = '';

  if (total === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Nothing due in the next 7 days.';
    el.list.appendChild(hint);
    return;
  }

  UPCOMING_GROUPS.forEach((key) => {
    const items = groups[key];
    if (!items.length) return;
    const header = document.createElement('div');
    header.className = 'checklist-header upcoming-group-header';
    const label = document.createElement('span');
    label.className = 'meta-label' + (key === 'overdue' ? ' upcoming-overdue' : '');
    label.textContent = `${UPCOMING_LABELS[key]} (${items.length})`;
    header.appendChild(label);
    el.list.appendChild(header);
    items.forEach((x) => el.list.appendChild(renderRow(x, key)));
  });
}

function renderRow({ kind, date, item }, groupKey) {
  const row = document.createElement('div');
  row.className = 'upcoming-row';

  if (kind === 'task') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'routine-check';
    checkbox.title = 'Mark done';
    checkbox.setAttribute('aria-label', `Mark “${item.title}” done`);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => markDone(item));
    row.appendChild(checkbox);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'upcoming-check-spacer';
    row.appendChild(spacer);
  }

  const due = document.createElement('span');
  due.className = 'due-badge upcoming-date' + (groupKey === 'overdue' ? ' overdue' : '');
  due.textContent = formatDue(date);
  row.appendChild(due);

  const title = document.createElement('span');
  title.className = 'upcoming-title';
  title.textContent = kind === 'task' ? item.title : item.name;
  row.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'task-meta upcoming-meta';
  if (kind === 'task') {
    const dot = document.createElement('span');
    dot.className = 'priority-dot priority-' + (item.priority || 'medium');
    dot.title = PRIORITY_LABELS[item.priority || 'medium'] + ' priority';
    meta.appendChild(dot);
    const cat = getCategory(categories, item.category_id);
    if (cat) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.setProperty('--chip-color', cat.color);
      chip.textContent = cat.name;
      meta.appendChild(chip);
    }
  } else {
    const tag = document.createElement('span');
    tag.className = 'project-row-status';
    tag.textContent = 'Project';
    meta.appendChild(tag);
  }
  row.appendChild(meta);

  row.addEventListener('click', async () => {
    if (kind === 'project') {
      location.hash = '#/projects/' + item.id;
      return;
    }
    try {
      await refreshBoard(); // the editor edits the Board's copy of the task
      openTaskModal(item.id);
    } catch (err) {
      showError(err);
    }
  });

  return row;
}

async function markDone(task) {
  const previous = { status: task.status, is_starred: task.is_starred };
  const fields = { status: 'done' };
  if (task.is_starred) fields.is_starred = false;
  try {
    await tasksApi.updateTask(task.id, fields);
    tasks = tasks.filter((t) => t.id !== task.id);
    render();
    notifyDataChanged('upcoming');
    showActionToast(`Done: ${task.title}`, {
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await tasksApi.updateTask(task.id, previous);
          notifyDataChanged('undo');
        } catch (err) {
          showError(err);
        }
      },
    });
  } catch (err) {
    showError(err);
    render();
  }
}

export async function initUpcoming() {
  cacheElements();
}

export async function refreshUpcoming() {
  try {
    [tasks, projects, categories] = await Promise.all([
      tasksApi.listOpenTasks(), // Upcoming only shows open tasks
      projectsApi.listProjects(),
      categoriesApi.listCategories(),
    ]);
  } catch (err) {
    showError(err);
    return;
  }
  render();
}
