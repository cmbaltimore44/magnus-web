import * as tasksApi from './data/tasks.js';
import * as categoriesApi from './data/categories.js';
import * as listsApi from './data/lists.js';
import * as booksApi from './data/books.js';
import { addWantToRead } from './bookQuickAdd.js';
import { refreshLibrary } from './views/library.js';
import { hashSegments } from './hash.js';
import { parseQuickAdd, describeQuickAdd, findList } from './quickAdd.js';
import { isMissingSchema, SCHEMA_004_HINT } from './schema.js';
import { showError, showToast } from './toast.js';
import { notifyDataChanged, isTyping, anyModalOpen } from './events.js';

// Quick add: one line → a new task (or, with "+groceries oat milk", an item
// on a list, or with "book: Piranesi by Susanna Clarke", a Want to Read
// book), from any view (syntax in js/quickAdd.js).
// On desktop it's a bar above every view; on phones a floating + opens it.

const INBOX_MESSAGE = 'Journal inbox is only available in Magnus.';
const LIST_USAGE = 'Type +list then the item, e.g. +groceries oat milk.';
const BOOK_USAGE = 'Type book: then a title (and "by" the author), or an ISBN.';
const MAX_STARRED = 3;

let userId = null;
let categories = [];
let lists = [];
let listsMissing = false; // schema_004 not run yet
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
  try {
    lists = await listsApi.listLists();
    listsMissing = false;
    renderPreview();
  } catch (err) {
    listsMissing = isMissingSchema(err);
    renderPreview();
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
  if (parsed.book) {
    el.preview.textContent = describeQuickAdd(parsed);
    return;
  }
  if (parsed.list != null) {
    if (listsMissing) {
      el.preview.textContent = `Lists need their database tables. ${SCHEMA_004_HINT}`;
      el.preview.classList.add('quickadd-preview-warn');
      return;
    }
    el.preview.textContent = describeQuickAdd(parsed, categories, lists);
    if (parsed.list && !findList(lists, parsed.list)) el.preview.classList.add('quickadd-preview-warn');
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
  if (parsed.book) {
    await addBook(parsed.book);
    return;
  }
  if (parsed.list != null) {
    await addToList(parsed);
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

// "+groceries oat milk" → "oat milk" at the end of Groceries.
async function addToList(parsed) {
  if (!parsed.list || !parsed.text) {
    showToast(LIST_USAGE, { type: 'info' });
    return;
  }
  busy = true;
  try {
    try {
      lists = await listsApi.listLists();
    } catch (err) {
      if (!isMissingSchema(err)) throw err;
      listsMissing = true;
      showToast(`Lists need their database tables. ${SCHEMA_004_HINT}`, { type: 'info' });
      return;
    }
    const list = findList(lists, parsed.list);
    if (!list) {
      showToast(`No list named “${parsed.list}”.`, { type: 'error' });
      return;
    }
    await listsApi.appendItem(userId, list.id, parsed.text);
    el.input.value = '';
    renderPreview();
    showToast(`Added “${parsed.text}” to ${list.name}.`, { type: 'success', duration: 2500 });
    if (el.form.classList.contains('open')) closeQuickAdd();
    notifyDataChanged('quickadd');
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
  }
}

// "book: Piranesi by Susanna Clarke" → saved to Want to Read straight away;
// author/cover/ISBN are filled in from Open Library in the background when
// there's one clear match (js/bookQuickAdd.js).
async function addBook(fields) {
  if (!fields.isbn && !fields.title) {
    showToast(BOOK_USAGE, { type: 'info' });
    return;
  }
  busy = true;
  try {
    const books = await booksApi.listBooks();
    const { book, enriched } = await addWantToRead(userId, fields, books);
    el.input.value = '';
    renderPreview();
    showToast(`Added “${book.title}” to Want to Read.`, { type: 'success', duration: 2500 });
    if (el.form.classList.contains('open')) closeQuickAdd();
    notifyDataChanged('quickadd');
    enriched.then((updated) => {
      if (!updated) return;
      showToast(`Found details for “${updated.title}”.`, { type: 'success', duration: 2500 });
      if (hashSegments()[0] === 'library') refreshLibrary();
    });
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
  // Phone sheet: tapping away from an empty quick add closes it.
  el.input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!el.input.value.trim() && !el.form.contains(document.activeElement)) closeQuickAdd();
    }, 150);
  });
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
