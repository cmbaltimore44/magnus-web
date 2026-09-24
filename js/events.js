// Tiny app-wide signal: "data changed, refresh what you're showing".
// Fired after writes made outside the current view (quick add, the task
// editor opened from Upcoming, undo, live updates…); app.js listens and
// refreshes the current view unless it was the one that made the change.

const EVENT = 'lt:data-changed';

export function notifyDataChanged(source = '') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { source } }));
}

export function onDataChanged(callback) {
  window.addEventListener(EVENT, (e) => callback(e.detail?.source || ''));
}

// True when a keypress is going into a text field rather than being a shortcut.
export function isTyping(target) {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

export function anyModalOpen() {
  return !!document.querySelector('.modal-overlay.open');
}
