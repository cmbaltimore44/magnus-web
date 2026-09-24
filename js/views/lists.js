import * as listsApi from '../data/lists.js';
import { hashSegments } from '../hash.js';
import { showError, showToast } from '../toast.js';
import { deleteWithUndo, deleteRowsWithUndo } from '../undo.js';
import { isMissingSchema, SCHEMA_004_HINT } from '../schema.js';

// Lists (schema_004): groceries, wish list, packing… Each list is a set of
// checkable items with an optional link and price. Desktop shows the lists
// and the open list side by side; phones show one at a time (#/lists is the
// index, #/lists/<id> a list). The last open list is remembered per device.

const LAST_KEY = 'kanban.lists.lastOpen';
const PHONE = '(max-width: 720px)';

let userId = null;
let lists = [];
let items = [];
let currentId = null;
let editing = null; // { type: 'rename', id: listId } | { type: 'item', id: itemId } — refreshes leave it alone
let checkedOpen = false; // the Checked group starts collapsed
let showIndexOnPhone = false; // "All lists" was tapped: don't jump back into the last list
let schemaMissing = false;
let nextOrder = 0; // keeps rapid-fire adds in order before the server answers
const el = {};

function cacheElements() {
  Object.assign(el, {
    count: document.getElementById('lists-count'),
    newBtn: document.getElementById('new-list-btn'),
    schemaWrap: document.getElementById('lists-schema-wrap'),
    schemaHint: document.getElementById('lists-schema-hint'),
    layout: document.getElementById('lists-layout'),
    index: document.getElementById('lists-index'),
    detailEmpty: document.getElementById('lists-detail-empty'),
    detailContent: document.getElementById('lists-detail-content'),
    backBtn: document.getElementById('lists-back-btn'),
    header: document.getElementById('lists-detail-header'),
    title: document.getElementById('list-title'),
    meta: document.getElementById('list-meta'),
    renameBtn: document.getElementById('rename-list-btn'),
    deleteBtn: document.getElementById('delete-list-btn'),
    renameForm: document.getElementById('list-rename-form'),
    renameInput: document.getElementById('list-rename-input'),
    renameCancel: document.getElementById('list-rename-cancel'),
    itemForm: document.getElementById('list-item-form'),
    itemInput: document.getElementById('list-item-input'),
    items: document.getElementById('list-items'),
    total: document.getElementById('list-total'),
    totalValue: document.getElementById('list-total-value'),
    checkedHeader: document.getElementById('list-checked-header'),
    checkedToggle: document.getElementById('list-checked-toggle'),
    checkedLabel: document.getElementById('list-checked-label'),
    checkedCaret: document.getElementById('list-checked-caret'),
    clearBtn: document.getElementById('clear-checked-btn'),
    checkedItems: document.getElementById('list-checked-items'),
  });
}

// True while a rename or item edit is open (live updates wait for it).
export function isListsEditing() {
  return !!editing;
}

function readLast() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function writeLast(id) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    // storage unavailable: just won't be remembered
  }
}

const isPhone = () => window.matchMedia(PHONE).matches;

// The list id in the hash (#/lists/<id>), or null.
function routeId() {
  const [view, id] = hashSegments();
  return view === 'lists' && id ? id : null;
}

// Which list the detail pane shows.
function resolveCurrent() {
  const id = routeId();
  if (id) return lists.some((l) => l.id === id) ? id : null;
  if (isPhone()) return null;
  const last = readLast();
  if (last && lists.some((l) => l.id === last)) return last;
  return lists[0]?.id || null;
}

// Phones opening #/lists go straight back into the last open list.
function maybeReopenLast() {
  const [view, id] = hashSegments();
  if (view !== 'lists' || id || !isPhone() || showIndexOnPhone) return false;
  const last = readLast();
  if (!last || !lists.some((l) => l.id === last)) return false;
  location.replace('#/lists/' + last);
  return true;
}

function listItemsOf(listId) {
  return items
    .filter((i) => i.list_id === listId)
    .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)));
}

function editingBelongsTo(listId) {
  if (!editing || !listId) return false;
  if (editing.type === 'rename') return editing.id === listId;
  return items.some((i) => i.id === editing.id && i.list_id === listId);
}

const openCount = (listId) => items.filter((i) => i.list_id === listId && !i.done).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- rendering ----------

function render() {
  el.schemaWrap.hidden = !schemaMissing;
  el.layout.hidden = schemaMissing;
  el.newBtn.hidden = schemaMissing;
  if (schemaMissing) {
    el.schemaHint.textContent = `Lists need their database tables. ${SCHEMA_004_HINT}`;
    el.count.textContent = '';
    return;
  }
  currentId = resolveCurrent();
  if (editing && !editingBelongsTo(currentId)) editing = null;
  if (currentId) writeLast(currentId);
  el.layout.classList.toggle('showing-detail', !!routeId());
  renderIndex();
  renderDetail();
}

function renderIndex() {
  el.count.textContent = lists.length ? plural(lists.length, 'list') : '';
  el.index.innerHTML = '';
  if (!lists.length) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = 'No lists yet — make one for groceries, a wish list, packing…';
    el.index.appendChild(hint);
    return;
  }
  lists.forEach((list) => {
    const row = document.createElement('li');
    row.className = 'routine-row lists-index-row' + (list.id === currentId ? ' active' : '');
    row.draggable = true;
    row.dataset.id = list.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'link');

    const name = document.createElement('span');
    name.className = 'routine-name lists-index-name';
    name.textContent = list.name;
    row.appendChild(name);

    const n = openCount(list.id);
    const count = document.createElement('span');
    count.className = 'lists-index-count';
    count.textContent = String(n);
    count.title = `${n} unchecked`;
    row.appendChild(count);

    const open = () => {
      showIndexOnPhone = false;
      location.hash = '#/lists/' + list.id;
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open();
    });
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistListOrder();
    });
    el.index.appendChild(row);
  });
}

function renderDetail() {
  const list = lists.find((l) => l.id === currentId);
  el.detailContent.hidden = !list;
  el.detailEmpty.hidden = !!list;
  if (!list) {
    el.detailEmpty.textContent = lists.length ? 'Pick a list.' : 'Your lists will show up here.';
    return;
  }

  const all = listItemsOf(list.id);
  const open = all.filter((i) => !i.done);
  const checked = all.filter((i) => i.done);

  const renaming = editing?.type === 'rename' && editing.id === list.id;
  el.header.hidden = renaming;
  el.renameForm.hidden = !renaming;
  el.title.textContent = list.name;
  el.meta.textContent = !all.length ? '' : open.length ? `${open.length} to go` : 'All done';
  el.itemInput.placeholder = `Add to ${list.name}…`;

  el.items.innerHTML = '';
  if (!all.length) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = 'Nothing here yet — add the first item above.';
    el.items.appendChild(hint);
  }
  open.forEach((item) => el.items.appendChild(renderItem(item)));

  const priced = all.some((i) => i.price != null);
  el.total.hidden = !priced;
  if (priced) {
    el.totalValue.textContent = listsApi.money(open.reduce((sum, i) => sum + (i.price != null ? Number(i.price) : 0), 0));
  }

  el.checkedHeader.hidden = !checked.length;
  el.checkedLabel.textContent = `Checked (${checked.length})`;
  el.checkedCaret.textContent = checkedOpen ? '▾' : '▸';
  el.checkedToggle.setAttribute('aria-expanded', String(checkedOpen));
  el.checkedItems.hidden = !checked.length || !checkedOpen;
  el.checkedItems.innerHTML = '';
  if (checkedOpen) checked.forEach((item) => el.checkedItems.appendChild(renderItem(item)));

  if (renaming && document.activeElement !== el.renameInput) {
    el.renameInput.value = list.name;
    el.renameInput.focus();
    el.renameInput.select();
  }
}

function renderItem(item) {
  if (editing?.type === 'item' && editing.id === item.id) return renderEditor(item);

  const row = document.createElement('li');
  row.className = 'routine-row lists-item-row' + (item.done ? ' completed' : '');
  row.dataset.id = item.id;
  row.draggable = !item.done;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'routine-check';
  checkbox.checked = item.done;
  checkbox.setAttribute('aria-label', `Check off ${item.text}`);
  checkbox.addEventListener('change', () => toggleItem(item, checkbox.checked));
  row.appendChild(checkbox);

  const body = document.createElement('div');
  body.className = 'lists-item-body';
  const text = document.createElement('span');
  text.className = 'routine-name lists-item-text';
  text.textContent = item.text;
  text.title = 'Edit';
  text.addEventListener('click', () => startEdit(item));
  body.appendChild(text);

  const url = listsApi.safeUrl(item.url);
  if (url) {
    const link = document.createElement('a');
    link.className = 'lists-item-link';
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${url.hostname.replace(/^www\./, '')} ↗`;
    link.draggable = false;
    body.appendChild(link);
  }
  row.appendChild(body);

  if (item.price != null) {
    const price = document.createElement('span');
    price.className = 'lists-price';
    price.textContent = listsApi.money(item.price);
    row.appendChild(price);
  }

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'routine-remove lists-edit-btn';
  edit.textContent = '✎';
  edit.title = 'Edit item';
  edit.setAttribute('aria-label', `Edit ${item.text}`);
  edit.addEventListener('click', () => startEdit(item));
  row.appendChild(edit);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'routine-remove';
  remove.textContent = '×';
  remove.title = 'Delete item';
  remove.setAttribute('aria-label', `Delete ${item.text}`);
  remove.addEventListener('click', () => removeItem(item));
  row.appendChild(remove);

  if (!item.done) {
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistItemOrder();
    });
  }
  return row;
}

function field(value, attrs) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
  return input;
}

function renderEditor(item) {
  const row = document.createElement('li');
  row.className = 'lists-item-editing';
  row.dataset.id = item.id;

  const form = document.createElement('form');
  form.className = 'lists-item-editor';
  form.autocomplete = 'off';

  const text = field(item.text, { 'aria-label': 'Item', placeholder: 'Item', required: '' });
  const url = field(item.url || '', { 'aria-label': 'Link (optional)', placeholder: 'Link (optional)', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' });
  const price = field(item.price == null ? '' : String(Number(item.price)), { 'aria-label': 'Price (optional)', placeholder: 'Price', inputmode: 'decimal' });
  price.className = 'lists-price-input';

  const fields = document.createElement('div');
  fields.className = 'lists-editor-fields';
  fields.append(url, price);

  const actions = document.createElement('div');
  actions.className = 'lists-editor-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', cancelEdit);
  actions.append(save, cancel);

  form.append(text, fields, actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveEdit(item, { text: text.value, url: url.value, price: price.value });
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelEdit();
    }
  });
  row.appendChild(form);
  requestAnimationFrame(() => text.focus());
  return row;
}

// ---------- items ----------

function startEdit(item) {
  editing = { type: 'item', id: item.id };
  renderDetail();
}

function cancelEdit() {
  editing = null;
  renderDetail();
}

async function saveEdit(item, fields) {
  const text = fields.text.trim();
  if (!text) {
    showToast('An item needs some text.', { type: 'info' });
    return;
  }
  let url;
  let price;
  try {
    url = listsApi.cleanUrl(fields.url);
    price = listsApi.parsePrice(fields.price);
  } catch (err) {
    showToast(err.message, { type: 'error' });
    return;
  }
  try {
    const updated = await listsApi.updateItem(item.id, { text, url, price });
    replaceItem(updated);
    editing = null;
    render();
  } catch (err) {
    showError(err);
  }
}

// Rows are looked up by id: a refresh may have swapped in new objects meanwhile.
function replaceItem(updated) {
  const index = items.findIndex((i) => i.id === updated.id);
  if (index >= 0) items[index] = updated;
}

async function toggleItem(item, done) {
  const current = items.find((i) => i.id === item.id) || item;
  const before = current.done;
  replaceItem({ ...current, done });
  render();
  try {
    await listsApi.updateItem(item.id, { done });
  } catch (err) {
    replaceItem({ ...current, done: before });
    render();
    showError(err);
  }
}

async function handleAddItem(e) {
  e.preventDefault();
  const listId = currentId;
  const text = el.itemInput.value.trim();
  if (!listId || !text) return;
  // Clear right away so the next item can be typed (and Enter can't add this one twice).
  el.itemInput.value = '';
  el.itemInput.focus();
  const order = Math.max(nextOrder, listItemsOf(listId).reduce((m, i) => Math.max(m, i.sort_order + 1), 0));
  nextOrder = order + 1;
  try {
    const created = await listsApi.createItem(userId, listId, text, order);
    items.push(created);
    render();
  } catch (err) {
    if (!el.itemInput.value) el.itemInput.value = text;
    showError(err);
  }
}

async function reloadData() {
  const [listRows, itemRows] = await Promise.all([listsApi.listLists(), listsApi.listAllItems()]);
  lists = listRows;
  items = itemRows;
}

async function reloadAndRender() {
  try {
    await reloadData();
  } catch (err) {
    showError(err);
    return;
  }
  render();
}

async function removeItem(item) {
  try {
    await deleteWithUndo({
      message: `Deleted “${item.text}”.`,
      table: 'list_items',
      id: item.id,
      del: () => listsApi.deleteItems([item.id]),
      onRestored: reloadAndRender,
    });
    items = items.filter((i) => i.id !== item.id);
    if (editing?.id === item.id) editing = null;
    render();
  } catch (err) {
    showError(err);
  }
}

async function clearChecked() {
  const ids = listItemsOf(currentId).filter((i) => i.done).map((i) => i.id);
  if (!ids.length) return;
  try {
    await deleteRowsWithUndo({
      message: `Cleared ${plural(ids.length, 'checked item')}.`,
      table: 'list_items',
      ids,
      del: () => listsApi.deleteItems(ids),
      onRestored: reloadAndRender,
    });
    items = items.filter((i) => !ids.includes(i.id));
    render();
  } catch (err) {
    showError(err);
  }
}

// ---------- lists ----------

export async function handleNewList() {
  if (schemaMissing) {
    showToast(`Lists need their database tables. ${SCHEMA_004_HINT}`, { type: 'info' });
    return;
  }
  try {
    const order = lists.reduce((m, l) => Math.max(m, l.sort_order + 1), 0);
    const created = await listsApi.createList(userId, 'New list', order);
    lists.push(created);
    writeLast(created.id);
    showIndexOnPhone = false;
    editing = { type: 'rename', id: created.id }; // name it straight away
    if (location.hash === '#/lists/' + created.id) render();
    else location.hash = '#/lists/' + created.id;
  } catch (err) {
    if (isMissingSchema(err)) {
      schemaMissing = true;
      render();
    } else showError(err);
  }
}

function startRename() {
  if (!currentId) return;
  editing = { type: 'rename', id: currentId };
  renderDetail();
}

function cancelRename() {
  editing = null;
  renderDetail();
}

async function handleRename(e) {
  e.preventDefault();
  const list = lists.find((l) => l.id === currentId);
  if (!list) return;
  const name = el.renameInput.value.trim();
  if (!name || name === list.name) {
    cancelRename();
    return;
  }
  try {
    const updated = await listsApi.renameList(list.id, name);
    lists = lists.map((l) => (l.id === updated.id ? updated : l));
    editing = null;
    el.renameInput.blur();
    render();
  } catch (err) {
    showError(err);
  }
}

async function handleDeleteList() {
  const list = lists.find((l) => l.id === currentId);
  if (!list) return;
  const n = listItemsOf(list.id).length;
  try {
    await deleteWithUndo({
      message: `Deleted “${list.name}”${n ? ` and its ${plural(n, 'item')}` : ''}.`,
      table: 'lists',
      id: list.id,
      del: () => listsApi.deleteList(list.id),
      cascades: [{ table: 'list_items', column: 'list_id' }],
      onRestored: async () => {
        await reloadData();
        writeLast(list.id);
        showIndexOnPhone = false;
        location.hash = '#/lists/' + list.id;
        render();
      },
    });
    lists = lists.filter((l) => l.id !== list.id);
    items = items.filter((i) => i.list_id !== list.id);
    if (readLast() === list.id) writeLast(null);
    editing = null;
    showIndexOnPhone = true;
    if (location.hash === '#/lists') render();
    else location.hash = '#/lists';
  } catch (err) {
    showError(err);
  }
}

// ---------- drag to reorder ----------

function rowAfter(container, selector, y) {
  const rows = Array.from(container.querySelectorAll(`${selector}:not(.dragging)`));
  return rows.find((row) => {
    const rect = row.getBoundingClientRect();
    return y - rect.top < rect.height / 2;
  });
}

function wireDragContainer(container, selector) {
  container.addEventListener('dragover', (e) => {
    const dragging = container.querySelector(`${selector}.dragging`);
    if (!dragging) return;
    e.preventDefault();
    const after = rowAfter(container, selector, e.clientY);
    if (after) container.insertBefore(dragging, after);
    else container.appendChild(dragging);
  });
}

function persistListOrder() {
  const ids = Array.from(el.index.querySelectorAll('.lists-index-row')).map((r) => r.dataset.id);
  if (ids.every((id, i) => lists[i]?.id === id)) return;
  lists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  lists.forEach((l, i) => (l.sort_order = i));
  listsApi.reorder('lists', ids).catch(showError);
}

function persistItemOrder() {
  const openIds = Array.from(el.items.querySelectorAll('.lists-item-row')).map((r) => r.dataset.id);
  const all = listItemsOf(currentId);
  const ids = [...openIds, ...all.filter((i) => i.done).map((i) => i.id)];
  if (ids.every((id, i) => all[i]?.id === id)) return;
  ids.forEach((id, index) => {
    const item = items.find((i) => i.id === id);
    if (item) item.sort_order = index;
  });
  listsApi.reorder('list_items', ids).catch(showError);
}

// ---------- init / refresh ----------

export async function initLists(uid) {
  userId = uid;
  cacheElements();

  el.newBtn.addEventListener('click', handleNewList);
  el.itemForm.addEventListener('submit', handleAddItem);
  el.renameBtn.addEventListener('click', startRename);
  el.renameForm.addEventListener('submit', handleRename);
  el.renameCancel.addEventListener('click', cancelRename);
  el.renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelRename();
    }
  });
  el.deleteBtn.addEventListener('click', handleDeleteList);
  el.clearBtn.addEventListener('click', clearChecked);
  el.checkedToggle.addEventListener('click', () => {
    checkedOpen = !checkedOpen;
    renderDetail();
  });
  el.backBtn.addEventListener('click', () => {
    showIndexOnPhone = true;
    editing = null;
    location.hash = '#/lists';
  });
  wireDragContainer(el.index, '.lists-index-row');
  wireDragContainer(el.items, '.lists-item-row');

  // Switch lists instantly from what's loaded; app.js's refresh then refetches.
  window.addEventListener('hashchange', () => {
    if (hashSegments()[0] !== 'lists') return;
    if (!maybeReopenLast()) render();
  });
  window.matchMedia(PHONE).addEventListener?.('change', () => render());

  await refreshLists();
  maybeReopenLast();
}

export async function refreshLists() {
  try {
    await reloadData();
    schemaMissing = false;
  } catch (err) {
    if (isMissingSchema(err)) {
      schemaMissing = true;
      render();
    } else showError(err);
    return;
  }
  if (editing) {
    // Don't wipe an open edit; the detail catches up when it closes.
    renderIndex();
    return;
  }
  render();
}
