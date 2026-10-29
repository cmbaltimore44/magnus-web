// Shared pure display helpers for rendering tasks, used by both the Board
// view and the Today view so due-date/category logic can't drift between them.

export function getCategory(categories, categoryId) {
  return categories.find((c) => c.id === categoryId) || null;
}

export function dueStatus(task) {
  if (!task.due_date || task.status === 'done') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date + 'T00:00:00');
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 1) return 'soon';
  return null;
}

export function formatDue(dateStr) {
  const due = new Date(dateStr + 'T00:00:00');
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "↻" after a repeating task's due date (schema_008), with the rule in words
// for screen readers and as a tooltip.
export function repeatBadge(task, describe) {
  if (!task.repeat) return null;
  const span = document.createElement('span');
  span.className = 'repeat-badge';
  span.textContent = '↻';
  span.title = `Repeats ${describe(task.repeat)}`;
  span.setAttribute('aria-label', span.title);
  return span;
}
