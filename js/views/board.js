import * as tasksApi from '../data/tasks.js';
import * as categoriesApi from '../data/categories.js';
import { getCategory as getCategoryFrom, dueStatus, formatDue } from '../taskDisplay.js';
import { showError, showToast } from '../toast.js';
import { stopVoiceInput } from '../voiceInput.js';
import { deleteWithUndo } from '../undo.js';
import { notifyDataChanged } from '../events.js';

const COLORS = [
  '#bf5433', '#c9463f', '#b8791a', '#2fa84f',
  '#8a4fd9', '#d94f9e', '#1fb6b6', '#6b6b70',
];

const COLUMNS = ['todo', 'doing', 'done'];

let userId = null;
let tasks = [];
let categories = [];
let editingTaskId = null;
let selectedColor = COLORS[0];
let isCustomColor = false;
let draggingTaskId = null;
let filterText = '';
let filterCategoryId = '';

const el = {};
let lists = {};
let counts = {};

function cacheElements() {
  Object.assign(el, {
    taskCount: document.getElementById('task-count'),
    searchInput: document.getElementById('search-input'),
    categoryFilter: document.getElementById('category-filter'),
    manageCategoriesBtn: document.getElementById('manage-categories-btn'),
    newTaskBtn: document.getElementById('new-task-btn'),

    taskModalOverlay: document.getElementById('task-modal-overlay'),
    taskModalTitle: document.getElementById('task-modal-title'),
    taskModalClose: document.getElementById('task-modal-close'),
    taskForm: document.getElementById('task-form'),
    taskId: document.getElementById('task-id'),
    taskTitle: document.getElementById('task-title'),
    taskCategory: document.getElementById('task-category'),
    taskDue: document.getElementById('task-due'),
    taskStatus: document.getElementById('task-status'),
    taskPriority: document.getElementById('task-priority'),
    taskNotes: document.getElementById('task-notes'),
    taskDeleteBtn: document.getElementById('task-delete-btn'),
    taskCancelBtn: document.getElementById('task-cancel-btn'),

    categoryModalOverlay: document.getElementById('category-modal-overlay'),
    categoryModalClose: document.getElementById('category-modal-close'),
    categoryList: document.getElementById('category-list'),
    categoryForm: document.getElementById('category-form'),
    categoryName: document.getElementById('category-name'),
    colorSwatches: document.getElementById('color-swatches'),
    customColorInput: document.getElementById('custom-color-input'),
  });

  lists = {
    todo: document.getElementById('list-todo'),
    doing: document.getElementById('list-doing'),
    done: document.getElementById('list-done'),
  };

  counts = {
    todo: document.getElementById('count-todo'),
    doing: document.getElementById('count-doing'),
    done: document.getElementById('count-done'),
  };
}

// ---------- helpers ----------

function getCategory(categoryId) {
  return getCategoryFrom(categories, categoryId);
}

// ---------- rendering ----------

function renderCategoryFilterOptions() {
  const previous = el.categoryFilter.value;
  el.categoryFilter.innerHTML = '<option value="">All categories</option>';
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    el.categoryFilter.appendChild(opt);
  });
  if (categories.some((c) => c.id === previous)) el.categoryFilter.value = previous;
}

function renderTaskCategoryOptions() {
  el.taskCategory.innerHTML = '';
  if (categories.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No categories yet';
    el.taskCategory.appendChild(opt);
    return;
  }
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    el.taskCategory.appendChild(opt);
  });
}

function matchesFilters(task) {
  if (filterCategoryId && task.category_id !== filterCategoryId) return false;
  if (filterText) {
    const haystack = (task.title + ' ' + (task.notes || '')).toLowerCase();
    if (!haystack.includes(filterText.toLowerCase())) return false;
  }
  return true;
}

function renderBoard() {
  const visible = tasks.filter(matchesFilters);

  COLUMNS.forEach((col) => {
    const container = lists[col];
    container.innerHTML = '';
    const colTasks = visible
      .filter((t) => t.status === col)
      .sort((a, b) => {
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return a.sort_order - b.sort_order;
      });

    counts[col].textContent = colTasks.length;

    if (colTasks.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = col === 'todo' ? 'No tasks yet' : 'Nothing here';
      container.appendChild(hint);
      return;
    }

    colTasks.forEach((task) => container.appendChild(renderCard(task)));
  });

  el.taskCount.textContent = tasks.length
    ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
    : '';
}

function renderCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.status === 'done' ? ' done' : '');
  card.draggable = true;
  card.dataset.id = task.id;

  const titleRow = document.createElement('div');
  titleRow.className = 'task-title-row';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  titleRow.appendChild(title);

  const starBtn = document.createElement('button');
  starBtn.className = 'star-btn' + (task.is_starred ? ' starred' : '');
  starBtn.type = 'button';
  starBtn.title = task.is_starred ? 'Unstar' : 'Star for Today (max 3)';
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStar(task);
  });
  titleRow.appendChild(starBtn);

  card.appendChild(titleRow);

  if (task.notes) {
    const notes = document.createElement('div');
    notes.className = 'task-notes';
    notes.textContent = task.notes;
    card.appendChild(notes);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const dot = document.createElement('span');
  dot.className = 'priority-dot priority-' + (task.priority || 'medium');
  dot.title = (task.priority || 'medium') + ' priority';
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

  card.addEventListener('click', () => openTaskModal(task.id));

  card.addEventListener('dragstart', () => {
    draggingTaskId = task.id;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    draggingTaskId = null;
    card.classList.remove('dragging');
  });

  return card;
}

// ---------- task modal ----------

export function openTaskModal(taskId, defaultColumn) {
  editingTaskId = taskId || null;
  renderTaskCategoryOptions();

  if (editingTaskId) {
    const task = tasks.find((t) => t.id === editingTaskId);
    if (!task) {
      // Card is stale (e.g. deleted from another device since the last refresh).
      editingTaskId = null;
      renderBoard();
      return;
    }
    el.taskModalTitle.textContent = 'Edit Task';
    el.taskId.value = task.id;
    el.taskTitle.value = task.title;
    el.taskCategory.value = task.category_id || '';
    el.taskDue.value = task.due_date || '';
    el.taskStatus.value = task.status;
    el.taskPriority.value = task.priority || 'medium';
    el.taskNotes.value = task.notes || '';
    el.taskDeleteBtn.hidden = false;
  } else {
    el.taskModalTitle.textContent = 'New Task';
    el.taskForm.reset();
    el.taskId.value = '';
    el.taskStatus.value = defaultColumn || 'todo';
    el.taskPriority.value = 'medium';
    el.taskDeleteBtn.hidden = true;
  }

  el.taskModalOverlay.classList.add('open');
  el.taskTitle.focus();
}

function closeTaskModal() {
  el.taskModalOverlay.classList.remove('open');
  editingTaskId = null;
  stopVoiceInput();
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const title = el.taskTitle.value.trim();
  if (!title) return;

  const fields = {
    title,
    category_id: el.taskCategory.value || null,
    due_date: el.taskDue.value || null,
    status: el.taskStatus.value,
    priority: el.taskPriority.value,
    notes: el.taskNotes.value.trim() || null,
  };

  if (editingTaskId) {
    const existing = tasks.find((t) => t.id === editingTaskId);
    if (existing && fields.status === 'done' && existing.is_starred) {
      fields.is_starred = false;
    }
  }

  try {
    if (editingTaskId) {
      const updated = await tasksApi.updateTask(editingTaskId, fields);
      const index = tasks.findIndex((t) => t.id === editingTaskId);
      tasks[index] = updated;
    } else {
      const created = await tasksApi.createTask(userId, fields, tasks.length);
      tasks.push(created);
    }
    renderBoard();
    closeTaskModal();
    notifyDataChanged('board');
  } catch (err) {
    showError(err);
  }
}

async function handleTaskDelete() {
  if (!editingTaskId) return;
  const id = editingTaskId;
  try {
    await deleteWithUndo({
      message: 'Task deleted.',
      table: 'tasks',
      id,
      del: () => tasksApi.deleteTask(id),
      relinks: [{ table: 'focus_sessions', column: 'task_id' }],
    });
    tasks = tasks.filter((t) => t.id !== id);
    renderBoard();
    closeTaskModal();
    notifyDataChanged('board');
  } catch (err) {
    showError(err);
  }
}

async function toggleStar(task) {
  const next = !task.is_starred;
  if (next && tasks.filter((t) => t.is_starred).length >= 3) {
    showToast('You can only star up to 3 tasks for Today. Unstar one first.', { type: 'info' });
    return;
  }
  task.is_starred = next;
  renderBoard();
  try {
    await tasksApi.updateTask(task.id, { is_starred: next });
  } catch (err) {
    task.is_starred = !next;
    renderBoard();
    showError(err);
  }
}

// ---------- category modal ----------

function renderColorSwatches() {
  el.colorSwatches.innerHTML = '';
  COLORS.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch-option' + (!isCustomColor && color === selectedColor ? ' selected' : '');
    swatch.style.background = color;
    swatch.addEventListener('click', () => {
      selectedColor = color;
      isCustomColor = false;
      renderColorSwatches();
    });
    el.colorSwatches.appendChild(swatch);
  });

  el.customColorInput.classList.toggle('selected', isCustomColor);
  if (isCustomColor) el.customColorInput.value = selectedColor;
}

function persistCategoryOrderFromDOM() {
  const orderedIds = Array.from(el.categoryList.querySelectorAll('.category-row')).map((r) => r.dataset.id);
  categories.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  renderTaskCategoryOptions();
  renderCategoryFilterOptions();
  categoriesApi.reorderCategories(orderedIds).catch(showError);
}

function renderCategoryManagerList() {
  el.categoryList.innerHTML = '';
  if (categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-categories';
    empty.textContent = 'No categories yet — add one below.';
    el.categoryList.appendChild(empty);
    return;
  }
  categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.draggable = true;
    row.dataset.id = c.id;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    row.appendChild(handle);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = c.color;
    row.appendChild(swatch);

    const name = document.createElement('span');
    name.className = 'category-name';
    name.textContent = c.name;
    name.title = c.name;
    row.appendChild(name);

    const remove = document.createElement('button');
    remove.className = 'remove-category';
    remove.textContent = '×';
    remove.title = 'Remove category';
    remove.addEventListener('click', async () => {
      try {
        await deleteWithUndo({
          message: 'Category deleted.',
          table: 'categories',
          id: c.id,
          del: () => categoriesApi.deleteCategory(c.id),
          relinks: [{ table: 'tasks', column: 'category_id' }],
        });
        categories = categories.filter((x) => x.id !== c.id);
        tasks.forEach((t) => {
          if (t.category_id === c.id) t.category_id = null;
        });
        renderCategoryManagerList();
        renderCategoryFilterOptions();
        renderTaskCategoryOptions();
        renderBoard();
      } catch (err) {
        showError(err);
      }
    });
    row.appendChild(remove);

    row.addEventListener('dragstart', () => {
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistCategoryOrderFromDOM();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = el.categoryList.querySelector('.category-row.dragging');
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      el.categoryList.insertBefore(dragging, before ? row : row.nextSibling);
    });

    el.categoryList.appendChild(row);
  });
}

function openCategoryModal() {
  selectedColor = COLORS[categories.length % COLORS.length];
  isCustomColor = false;
  renderColorSwatches();
  renderCategoryManagerList();
  el.categoryModalOverlay.classList.add('open');
}

function closeCategoryModal() {
  el.categoryModalOverlay.classList.remove('open');
  el.categoryForm.reset();
  renderTaskCategoryOptions();
  renderCategoryFilterOptions();
}

async function handleCategorySubmit(e) {
  e.preventDefault();
  const name = el.categoryName.value.trim();
  if (!name) return;
  try {
    const created = await categoriesApi.createCategory(userId, { name, color: selectedColor }, categories.length);
    categories.push(created);
    el.categoryName.value = '';
    selectedColor = COLORS[categories.length % COLORS.length];
    isCustomColor = false;
    renderColorSwatches();
    renderCategoryManagerList();
    renderCategoryFilterOptions();
  } catch (err) {
    showError(err);
  }
}

// ---------- drag and drop (tasks between columns) ----------

function wireColumnDrop() {
  Object.values(lists).forEach((container) => {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      container.classList.add('drag-over');
    });
    container.addEventListener('dragleave', () => {
      container.classList.remove('drag-over');
    });
    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');
      if (!draggingTaskId) return;
      const task = tasks.find((t) => t.id === draggingTaskId);
      if (!task) return;
      const newStatus = container.dataset.column;
      if (task.status === newStatus) return;
      const wasStarred = task.is_starred;
      task.status = newStatus;
      const updates = { status: newStatus };
      if (newStatus === 'done' && wasStarred) {
        task.is_starred = false;
        updates.is_starred = false;
      }
      renderBoard();
      try {
        await tasksApi.updateTask(task.id, updates);
      } catch (err) {
        if (newStatus === 'done' && wasStarred) task.is_starred = true;
        showError(err);
      }
    });
  });
}

// ---------- init ----------

export async function initBoard(uid) {
  userId = uid;
  cacheElements();
  wireColumnDrop();

  el.taskForm.addEventListener('submit', handleTaskSubmit);
  el.taskDeleteBtn.addEventListener('click', handleTaskDelete);
  el.taskModalClose.addEventListener('click', closeTaskModal);
  el.taskCancelBtn.addEventListener('click', closeTaskModal);
  el.taskModalOverlay.addEventListener('click', (e) => {
    if (e.target === el.taskModalOverlay) closeTaskModal();
  });
  el.newTaskBtn.addEventListener('click', () => openTaskModal(null, 'todo'));

  el.customColorInput.addEventListener('input', (e) => {
    selectedColor = e.target.value;
    isCustomColor = true;
    renderColorSwatches();
  });
  el.manageCategoriesBtn.addEventListener('click', openCategoryModal);
  el.categoryModalClose.addEventListener('click', closeCategoryModal);
  el.categoryModalOverlay.addEventListener('click', (e) => {
    if (e.target === el.categoryModalOverlay) closeCategoryModal();
  });
  el.categoryForm.addEventListener('submit', handleCategorySubmit);

  el.searchInput.addEventListener('input', (e) => {
    filterText = e.target.value;
    renderBoard();
  });
  el.categoryFilter.addEventListener('change', (e) => {
    filterCategoryId = e.target.value;
    renderBoard();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTaskModal();
      closeCategoryModal();
    }
  });

  await refreshBoard();
}

export async function refreshBoard() {
  try {
    [categories, tasks] = await Promise.all([categoriesApi.listCategories(), tasksApi.listTasks()]);
  } catch (err) {
    showError(err);
    return;
  }
  renderCategoryFilterOptions();
  renderTaskCategoryOptions();
  renderBoard();
  if (el.categoryModalOverlay.classList.contains('open')) renderCategoryManagerList();
}
