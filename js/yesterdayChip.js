// "Yesterday" chip on a routine row: tap it to check off (or uncheck) a
// routine you forgot yesterday, so its streak survives. Magnus does the same
// with the y key.
import { addDays, todayISO } from './dates.js';

export function yesterdayISO() {
  return addDays(todayISO(), -1);
}

// onToggle(checked) is called with the state yesterday should change to.
export function renderYesterdayChip(dates, onToggle) {
  const done = dates.has(yesterdayISO());
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'routine-yesterday' + (done ? ' done' : '');
  chip.textContent = done ? '✓ yest' : 'yest';
  chip.title = done ? 'Done yesterday (tap to uncheck)' : 'Check off for yesterday';
  chip.setAttribute('aria-pressed', String(done));
  chip.addEventListener('click', () => onToggle(!done));
  return chip;
}
