const ICONS = { error: '✕', success: '✓', info: 'i' };

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  document.body.appendChild(container);
  return container;
}

export function showToast(message, { type = 'info', duration = 4500 } = {}) {
  const host = ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = ICONS[type] || ICONS.info;
  toast.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  toast.appendChild(close);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200);
  };
  close.addEventListener('click', dismiss);

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  const timer = setTimeout(dismiss, duration);

  return dismiss;
}

export function showConfirmToast(message, onConfirm, { confirmLabel = 'Delete', cancelLabel = 'Cancel', duration = 8000 } = {}) {
  const host = ensureContainer();

  const toast = document.createElement('div');
  toast.className = 'toast toast-confirm';

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'toast-confirm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'toast-confirm-btn';
  cancelBtn.textContent = cancelLabel;
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'toast-confirm-btn toast-confirm-danger';
  confirmBtn.textContent = confirmLabel;
  actions.appendChild(confirmBtn);

  toast.appendChild(actions);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200);
  };
  cancelBtn.addEventListener('click', dismiss);
  confirmBtn.addEventListener('click', () => {
    dismiss();
    onConfirm();
  });

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  const timer = setTimeout(dismiss, duration);
}

// A toast with one action button, e.g. "Task deleted. [Undo]".
export function showActionToast(message, { actionLabel, onAction, type = 'success', duration = 8000 }) {
  const host = ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type} toast-action`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = ICONS[type] || ICONS.info;
  toast.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'toast-confirm-btn toast-action-btn';
  actionBtn.textContent = actionLabel;
  toast.appendChild(actionBtn);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  toast.appendChild(close);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200);
  };
  close.addEventListener('click', dismiss);
  actionBtn.addEventListener('click', () => {
    dismiss();
    onAction();
  });

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  const timer = setTimeout(dismiss, duration);

  return dismiss;
}

export function showError(err) {
  if (err?.code === 'OFFLINE') {
    // A write while offline (js/offline.js): expected, not an error.
    showToast("You're offline — changes are disabled until you reconnect.", { type: 'info', duration: 4000 });
    return;
  }
  console.error(err);
  showToast(err?.message || 'Something went wrong talking to the server.', {
    type: 'error',
    duration: 6000,
  });
}
