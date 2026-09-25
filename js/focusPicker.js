// Port of magnus/src/lib/focusPicker.js without the journal (the web app
// can't see it, so there are no Essay/Note rows): the focus timer's "what
// are you focusing on?" list, used to start a timer and to switch one
// (Switch…). Pure, so it's unit-tested; js/focus.js turns each choice into
// a picker row. A choice's `to` is what the timer takes: a task { id, title },
// a label { label }, or null for nothing.
import { formatDue } from './taskDisplay.js';

// tasks: open tasks · labels: recent focus labels (newest first) · timer: the running one, if any
export function focusChoices({ tasks = [], labels = [], timer = null }) {
  const out = [];
  const now = (to) => !!timer && (to.id ? timer.taskId === to.id : !timer.taskId && timer.label?.toLowerCase() === to.label.toLowerCase());
  if (!timer) out.push({ id: 'none', group: 'Start', label: 'Just start (nothing in particular)', to: null });
  else if (timer.taskId || timer.label) out.push({ id: 'none', group: 'Focus', label: 'Focus on no task', to: null });

  const rank = (t) => `${t.is_starred ? 0 : 1}${t.due_date || '9999'}`;
  const sorted = [...tasks].sort((a, b) => rank(a).localeCompare(rank(b)));
  const task = (t) => ({
    id: `task:${t.id}`,
    group: now(t) ? 'Now' : t.is_starred ? '★' : 'Task',
    label: t.title,
    hint: t.due_date ? `Due ${formatDue(t.due_date)}` : undefined,
    to: { id: t.id, title: t.title },
  });
  out.push(...sorted.filter((t) => t.is_starred).map(task));

  const seen = new Set();
  const labelChoice = (label, group) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const to = { label };
    return [{ id: `label:${key}`, group: now(to) ? 'Now' : group, label, to }];
  };
  out.push(...labels.flatMap((l) => labelChoice(l, 'Recent')));
  out.push(...sorted.filter((t) => !t.is_starred).map(task));
  return out;
}

// The "Focus on “…”" row for whatever's typed, unless a choice already has
// exactly that label.
export function typedChoice(query, choices) {
  const label = String(query || '').trim().slice(0, 120);
  if (!label || choices.some((c) => c.label.toLowerCase() === label.toLowerCase())) return null;
  return { id: 'typed', group: 'New', label: `Focus on “${label}”`, to: { label } };
}
