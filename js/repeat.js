// Copy of Magnus's src/lib/repeat.js — keep the two in sync.
// Repeating tasks (schema_008 `tasks.repeat`). Quick add writes a ~token,
// stored as a rule; when the task is marked done, the database inserts the
// next one (trigger `tasks_repeat`, using public.next_due, which mirrors
// nextDue here). The next due date always counts from the old due date, so
// a schedule never drifts.
//
//   ~daily            daily
//   ~weekdays         weekdays (Mon–Fri)
//   ~weekly           weekly:<the due date's weekday>
//   ~mon  ~mon,thu    weekly:mon,thu
//   ~monthly          monthly:<the due date's day>
//   ~1st ~15th ~last  monthly:1 / monthly:15 / monthly:last (clamped to short months)
//   ~yearly           yearly:<MM-DD of the due date>
//   ~3d ~2w ~6m       every:3d / every:2w / every:6m
//
// (Magnus has the original: src/lib/repeat.js.)

// Local date arithmetic (no imports: the demo client uses this file too).
function addDays(dateISO, delta) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const RULE_PATTERN =
  /^(daily|weekdays|weekly:(sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat))*|monthly:([1-9]|[12][0-9]|3[01]|last)|yearly:(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|every:[1-9][0-9]{0,2}[dwm])$/;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = (dateISO) => dateISO.split('-').map(Number);
const dow = (dateISO) => new Date(dateISO + 'T00:00:00').getDay();
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

function dayWord(w) {
  const d = DAYS.find((x) => w === x || (w.length >= 3 && DAY_NAMES[x].toLowerCase().startsWith(w)));
  return d || null;
}

/**
 * A quick-add ~token → a rule, or null when it isn't one. `anchorISO` (the
 * task's due date, or today) fills in ~weekly / ~monthly / ~yearly.
 */
export function parseRepeatToken(word, anchorISO) {
  const m = /^~(.+)$/.exec(String(word || '').trim().toLowerCase());
  if (!m) return null;
  const t = m[1];
  if (t === 'daily' || t === 'day') return 'daily';
  if (t === 'weekdays' || t === 'weekday') return 'weekdays';
  const [y, mo, d] = parts(anchorISO);
  if (t === 'weekly' || t === 'week') return `weekly:${DAYS[dow(anchorISO)]}`;
  if (t === 'monthly' || t === 'month') return `monthly:${d}`;
  if (t === 'yearly' || t === 'year' || t === 'annually') return `yearly:${iso(y, mo, d).slice(5)}`;
  if (t === 'last') return 'monthly:last';
  const nth = /^([1-9]|[12][0-9]|3[01])(st|nd|rd|th)$/.exec(t);
  if (nth) return `monthly:${Number(nth[1])}`;
  const every = /^([1-9][0-9]{0,2})([dwm])$/.exec(t);
  if (every) return `every:${every[1]}${every[2]}`;
  const days = t.split(',').map(dayWord);
  if (days.length && days.every(Boolean)) {
    const unique = DAYS.filter((x) => days.includes(x));
    return `weekly:${unique.join(',')}`;
  }
  return null;
}

/** The next due date strictly after fromISO. Mirrors public.next_due (schema_008). */
export function nextDue(rule, fromISO) {
  const [kind, arg] = rule.split(':');
  if (kind === 'daily') return addDays(fromISO, 1);
  if (kind === 'weekdays') {
    let d = addDays(fromISO, 1);
    while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
    return d;
  }
  if (kind === 'weekly') {
    const want = arg.split(',').map((x) => DAYS.indexOf(x));
    for (let i = 1; i <= 7; i++) if (want.includes(dow(addDays(fromISO, i)))) return addDays(fromISO, i);
    return null;
  }
  if (kind === 'monthly') {
    const [y, m] = parts(fromISO);
    for (let i = 0; i < 3; i++) {
      const yy = y + Math.floor((m - 1 + i) / 12);
      const mm = ((m - 1 + i) % 12) + 1;
      const last = lastDay(yy, mm);
      const d = iso(yy, mm, arg === 'last' ? last : Math.min(Number(arg), last));
      if (d > fromISO) return d;
    }
    return null;
  }
  if (kind === 'yearly') {
    const [mm, dd] = arg.split('-').map(Number);
    const [y] = parts(fromISO);
    for (let i = 0; i < 2; i++) {
      const d = iso(y + i, mm, Math.min(dd, lastDay(y + i, mm)));
      if (d > fromISO) return d;
    }
    return null;
  }
  if (kind === 'every') {
    const n = parseInt(arg, 10);
    const unit = arg.slice(-1);
    if (unit === 'd') return addDays(fromISO, n);
    if (unit === 'w') return addDays(fromISO, 7 * n);
    const [y, m, d] = parts(fromISO); // months: same day, clamped to the month's end
    const yy = y + Math.floor((m - 1 + n) / 12);
    const mm = ((m - 1 + n) % 12) + 1;
    return iso(yy, mm, Math.min(d, lastDay(yy, mm)));
  }
  return null;
}

/**
 * The first due date for a new repeating task typed without a date: the
 * first matching day from today on for calendar rules, today otherwise.
 */
export function firstDue(rule, todayISO) {
  if (rule.startsWith('every:')) return todayISO;
  return nextDue(rule, addDays(todayISO, -1));
}

/** "every Monday and Thursday", "monthly on the 1st", … */
export function describeRepeat(rule) {
  if (!rule) return '';
  const [kind, arg] = rule.split(':');
  if (kind === 'daily') return 'every day';
  if (kind === 'weekdays') return 'every weekday';
  if (kind === 'weekly') {
    const names = arg.split(',').map((d) => DAY_NAMES[d]);
    return `every ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}`;
  }
  if (kind === 'monthly') return arg === 'last' ? 'monthly on the last day' : `monthly on the ${ordinal(Number(arg))}`;
  if (kind === 'yearly') {
    const [mm, dd] = arg.split('-').map(Number);
    return `yearly on ${MONTHS[mm - 1]} ${dd}`;
  }
  if (kind === 'every') {
    const n = parseInt(arg, 10);
    const unit = { d: 'day', w: 'week', m: 'month' }[arg.slice(-1)];
    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  }
  return rule;
}

/** A rule back to the ~token you'd type (for editing): "monthly:1" → "~1st". */
export function ruleToToken(rule) {
  if (!rule) return '';
  const [kind, arg] = rule.split(':');
  if (kind === 'weekly') return `~${arg}`;
  if (kind === 'monthly') return arg === 'last' ? '~last' : `~${ordinal(Number(arg))}`;
  if (kind === 'yearly') return '~yearly';
  if (kind === 'every') return `~${arg}`;
  return `~${kind}`;
}
