import * as projectsApi from '../data/projects.js';
import * as projectTasksApi from '../data/projectTasks.js';
import { hashSegments } from '../hash.js';
import { showError } from '../toast.js';
import { dueStatus, formatDue } from '../taskDisplay.js';
import { deleteWithUndo } from '../undo.js';

const STATUS_LABELS = { not_started: 'Not Started', in_progress: 'In Progress', done: 'Done' };

let userId = null;
let projects = [];
let checklist = [];
let currentProjectId = null;
let taskCounts = new Map();

const el = {};

function cacheElements() {
  Object.assign(el, {
    listPanel: document.getElementById('projects-list-panel'),
    detailPanel: document.getElementById('projects-detail-panel'),
    projectsList: document.getElementById('projects-list'),
    projectCount: document.getElementById('project-count'),
    newProjectBtn: document.getElementById('new-project-btn'),

    name: document.getElementById('project-name'),
    status: document.getElementById('project-status'),
    targetDate: document.getElementById('project-target-date'),
    notes: document.getElementById('project-notes'),
    saveBtn: document.getElementById('save-project-btn'),
    deleteBtn: document.getElementById('delete-project-btn'),

    checklist: document.getElementById('project-checklist'),
    checklistForm: document.getElementById('project-checklist-form'),
  });
}

function renderList() {
  el.projectsList.innerHTML = '';
  el.projectCount.textContent = projects.length
    ? `${projects.length} project${projects.length === 1 ? '' : 's'}`
    : '';

  if (projects.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No projects yet — create one to get started.';
    el.projectsList.appendChild(hint);
    return;
  }

  projects.forEach((project) => {
    const card = document.createElement('div');
    card.className = 'project-card';

    const header = document.createElement('div');
    header.className = 'project-card-header';

    const name = document.createElement('div');
    name.className = 'project-card-name';
    name.textContent = project.name;
    header.appendChild(name);

    const status = document.createElement('span');
    status.className = 'project-row-status ' + project.status;
    status.textContent = STATUS_LABELS[project.status];
    header.appendChild(status);

    card.appendChild(header);

    const counts = taskCounts.get(project.id);
    if (counts && counts.total > 0) {
      const progress = document.createElement('div');
      progress.className = 'project-card-progress';

      const bar = document.createElement('div');
      bar.className = 'project-card-progress-bar';
      const fill = document.createElement('div');
      fill.className = 'project-card-progress-fill';
      fill.style.width = Math.round((counts.done / counts.total) * 100) + '%';
      bar.appendChild(fill);
      progress.appendChild(bar);

      const label = document.createElement('span');
      label.className = 'project-card-progress-label';
      label.textContent = `${counts.done}/${counts.total}`;
      progress.appendChild(label);

      card.appendChild(progress);
    }

    if (project.target_date) {
      const status2 = dueStatus({ due_date: project.target_date, status: project.status });
      const due = document.createElement('span');
      due.className = 'due-badge' + (status2 ? ' ' + status2 : '');
      due.textContent = (status2 === 'overdue' ? 'Overdue · ' : '') + formatDue(project.target_date);
      card.appendChild(due);
    }

    card.addEventListener('click', () => {
      location.hash = '#/projects/' + project.id;
    });

    el.projectsList.appendChild(card);
  });
}

function computeTaskCounts(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const counts = map.get(row.project_id) || { total: 0, done: 0 };
    counts.total += 1;
    if (row.done) counts.done += 1;
    map.set(row.project_id, counts);
  });
  return map;
}

function syncTaskCounts() {
  if (!currentProjectId) return;
  taskCounts.set(currentProjectId, {
    total: checklist.length,
    done: checklist.filter((c) => c.done).length,
  });
}

function renderChecklist() {
  syncTaskCounts();
  el.checklist.innerHTML = '';
  checklist.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'routine-row' + (item.done ? ' completed' : '');
    row.draggable = true;
    row.dataset.id = item.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'routine-check';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', async () => {
      try {
        item.done = checkbox.checked;
        await projectTasksApi.updateProjectTask(item.id, { done: item.done });
        renderChecklist();
      } catch (err) {
        showError(err);
      }
    });
    row.appendChild(checkbox);

    const name = document.createElement('span');
    name.className = 'routine-name';
    name.textContent = item.title;
    row.appendChild(name);

    const remove = document.createElement('button');
    remove.className = 'routine-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      const projectId = currentProjectId;
      try {
        await deleteWithUndo({
          message: 'Checklist item deleted.',
          table: 'project_tasks',
          id: item.id,
          del: () => projectTasksApi.deleteProjectTask(item.id),
          onRestored: async () => {
            if (currentProjectId !== projectId) return;
            checklist = await projectTasksApi.listProjectTasks(projectId);
            renderChecklist();
          },
        });
        checklist = checklist.filter((c) => c.id !== item.id);
        renderChecklist();
      } catch (err) {
        showError(err);
      }
    });
    row.appendChild(remove);

    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistChecklistOrder();
    });

    el.checklist.appendChild(row);
  });
}

function getChecklistRowAfter(y) {
  const rows = Array.from(el.checklist.querySelectorAll('.routine-row:not(.dragging)'));
  return rows.find((row) => {
    const rect = row.getBoundingClientRect();
    return y - rect.top < rect.height / 2;
  });
}

function persistChecklistOrder() {
  const orderedIds = Array.from(el.checklist.querySelectorAll('.routine-row')).map((r) => r.dataset.id);
  checklist.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  projectTasksApi.reorderProjectTasks(orderedIds).catch(showError);
}

async function openDetail(id) {
  if (id === currentProjectId) return; // already showing this project — don't clobber in-progress edits
  currentProjectId = id;
  let project = projects.find((p) => p.id === id);
  try {
    if (!project) project = await projectsApi.getProject(id);
    checklist = await projectTasksApi.listProjectTasks(id);
  } catch (err) {
    showError(err);
    location.hash = '#/projects';
    return;
  }

  el.name.value = project.name;
  el.status.value = project.status;
  el.targetDate.value = project.target_date || '';
  el.notes.value = project.notes || '';
  renderChecklist();
}

async function handleSave() {
  const fields = {
    name: el.name.value.trim() || 'Untitled Project',
    status: el.status.value,
    target_date: el.targetDate.value || null,
    notes: el.notes.value.trim() || null,
  };
  try {
    const updated = await projectsApi.updateProject(currentProjectId, fields);
    const index = projects.findIndex((p) => p.id === currentProjectId);
    if (index >= 0) projects[index] = updated;
    location.hash = '#/projects';
  } catch (err) {
    showError(err);
  }
}

async function handleDelete() {
  if (!currentProjectId) return;
  const id = currentProjectId;
  try {
    await deleteWithUndo({
      message: 'Project deleted.',
      table: 'projects',
      id,
      del: () => projectsApi.deleteProject(id),
      cascades: [{ table: 'project_tasks', column: 'project_id' }],
    });
    projects = projects.filter((p) => p.id !== id);
    location.hash = '#/projects';
  } catch (err) {
    showError(err);
  }
}

export async function handleNewProject() {
  try {
    const created = await projectsApi.createProject(
      userId,
      { name: 'Untitled Project', status: 'not_started' },
      projects.length
    );
    projects.unshift(created);
    location.hash = '#/projects/' + created.id;
  } catch (err) {
    showError(err);
  }
}

async function handleAddChecklistItem(e) {
  e.preventDefault();
  const input = el.checklistForm.querySelector('input');
  const title = input.value.trim();
  if (!title) return;
  try {
    const created = await projectTasksApi.createProjectTask(userId, currentProjectId, title, checklist.length);
    checklist.push(created);
    input.value = '';
    renderChecklist();
  } catch (err) {
    showError(err);
  }
}

function renderRoute() {
  const segments = hashSegments();
  if (segments[0] !== 'projects') return;
  const id = segments[1];
  el.listPanel.hidden = !!id;
  el.detailPanel.hidden = !id;
  if (id) {
    openDetail(id);
  } else {
    currentProjectId = null;
    renderList();
  }
}

export async function initProjects(uid) {
  userId = uid;
  cacheElements();

  el.newProjectBtn.addEventListener('click', handleNewProject);
  el.saveBtn.addEventListener('click', handleSave);
  el.deleteBtn.addEventListener('click', handleDelete);
  el.checklistForm.addEventListener('submit', handleAddChecklistItem);
  window.addEventListener('hashchange', renderRoute);

  el.checklist.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = el.checklist.querySelector('.routine-row.dragging');
    if (!dragging) return;
    const afterElement = getChecklistRowAfter(e.clientY);
    if (afterElement) el.checklist.insertBefore(dragging, afterElement);
    else el.checklist.appendChild(dragging);
  });

  await refreshProjects();
  renderRoute();
}

export async function refreshProjects() {
  try {
    const [projectRows, taskRows] = await Promise.all([projectsApi.listProjects(), projectTasksApi.listTaskCounts()]);
    projects = projectRows;
    taskCounts = computeTaskCounts(taskRows);
  } catch (err) {
    showError(err);
    return;
  }
  renderList();
  const segments = hashSegments();
  if (segments[0] === 'projects' && segments[1]) openDetail(segments[1]);
}
