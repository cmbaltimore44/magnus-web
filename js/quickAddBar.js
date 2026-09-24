import * as tasksApi from './data/tasks.js';
import * as categoriesApi from './data/categories.js';
import { parseQuickAdd, describeQuickAdd } from './quickAdd.js';
import { showError, showToast } from './toast.js';
import { notifyDataChanged, isTyping, anyModalOpen } from './events.js';

// Quick add: one line → a new task, from any view (syntax in js/quickAdd.js).
// On desktop it's a bar above every view; on phones a floating + opens it.

const INBOX_MESSAGE = 'Journal inbox is only available in Magnus.';
const MAX_STARRED = 3;

let userId = null;
let categories = [];
let busy = false;
const el = {};

function cacheElements() {
  Object.assign(el, {
    form: document.getElementById('quickadd-form'),
    input: document.getElementById('quickadd-input'),
    preview: document.getElementById('quickadd-preview'),
    fab: document.getElementById('quickadd-fab'),
  });
}

async function loadCategories() {
  try {
    categories = await categoriesApi.listCategories();
    renderPreview();
  } catch {
    // Preview just won't resolve #categories; submitting reports real errors.
  }
}

function renderPreview() {
  const text = el.input.value.trim();
  el.preview.classList.remove('quickadd-preview-warn');
  if (!text) {
    el.preview.textContent = '';
    el.preview.hidden = true;
    return;
  }
  el.preview.hidden = false;
  const parsed = parseQuickAdd(text, categories);
  if (parsed.inbox != null) {
    el.preview.textContent = INBOX_MESSAGE;
    el.preview.classList.add('quickadd-preview-warn');
    return;
  }
  if (!parsed.title) {
    el.preview.textContent = 'Add a title';
    return;
  }
  const details = describeQuickAdd(parsed, categories);
  el.preview.textContent = `New task: ${parsed.title}${details ? ' · ' + details : ''}`;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (busy) return;
  const text = el.input.value.trim();
  if (!text) return;
  const parsed = parseQuickAdd(text, categories);
  if (parsed.inbox != null) {
    showToast(INBOX_MESSAGE, { type: 'info' });
    return;
  }
  if (!parsed.title) {
    showToast('Add a title for the task.', { type: 'info' });
    return;
  }

  busy = true;
  try {
    const tasks = await tasksApi.listTasks();
    let isStarred = parsed.is_starred;
    if (isStarred && tasks.filter((t) => t.is_starred).length >= MAX_STARRED) {
      isStarred = false;
      showToast(`Added without a star — you already have ${MAX_STARRED} starred tasks for Today.`, { type: 'info' });
    }
    await tasksApi.createTask(
      userId,
      {
        title: parsed.title,
        due_date: parsed.due_date,
        priority: parsed.priority,
        category_id: parsed.category_id,
        is_starred: isStarred,
        status: 'todo',
      },
      tasks.length
    );
    el.input.value = '';
    renderPreview();
    showToast(`Added “${parsed.title}”.`, { type: 'success', duration: 2500 });
    if (el.form.classList.contains('open')) closeQuickAdd();
    notifyDataChanged('quickadd');
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
  }
}

export function openQuickAdd() {
  el.form.classList.add('open');
  el.input.focus();
  loadCategories();
}

function closeQuickAdd() {
  el.form.classList.remove('open');
  el.input.blur();
}

export function initQuickAdd(uid) {
  userId = uid;
  cacheElements();

  el.form.addEventListener('submit', handleSubmit);
  el.input.addEventListener('input', renderPreview);
  el.input.addEventListener('focus', loadCategories);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      el.input.value = '';
      renderPreview();
      closeQuickAdd();
    }
  });
  el.fab.addEventListener('click', () => {
    if (el.form.classList.contains('open')) closeQuickAdd();
    else openQuickAdd();
  });

  // "a" anywhere (not while typing or in a dialog) jumps to quick add.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (isTyping(e.target) || anyModalOpen()) return;
    e.preventDefault();
    openQuickAdd();
  });

  renderPreview();
}
