// "Check against page" for the quote editor: compares a dictated quote with
// the page text the user scanned (iOS Scan Text) or pasted, and lists the
// differences so each can be fixed with a tap. Pure (no DOM), so it can be
// unit-tested in Node; js/views/library.js draws the result.
//
// Both texts are split into words and punctuation. Curly and straight quotes,
// dashes and hyphens, and runs of whitespace compare as equal, and a word
// broken across lines ("under-\nstanding") is joined first. Case differences
// are differences too, but marked `kind: 'case'` so they can look quieter.
//
// The scan usually holds more than the quote, so the page is first trimmed to
// the passage: the window that best fits the dictation (so a stray "the" or
// "." elsewhere on the page can't stretch it), then from the first to the
// last word-level LCS match, widened at each end by as many page tokens as
// the dictation has unmatched tokens there (so a wrong first or last word
// still gets a suggestion).

const WORD = /[\p{L}\p{N}]+(?:(?:['’ʼ]|-[ \t]*\r?\n\s*(?=\p{Ll}))[\p{L}\p{N}]+)*/uy;
const PUNCT = /\.{3}|…|[-‐‑‒–—―−]+|\S/uy;
const SPACE = /\s+/y;

const OPEN_QUOTES = new Set(['“', '‘', '„', '‚', '«']);
const CLOSE_QUOTES = new Set(['”', '’', '»']);
const CLOSING = new Set([',', '.', ';', ':', '!', '?', ')', ']', '}', '...', '%']);
const OPENING = new Set(['(', '[', '{']);
const SENTENCE_END = new Set(['.', '!', '?', '...']);

function punctKey(s) {
  if (/^[“”„«»″"]$/u.test(s)) return '"';
  if (/^[‘’‚′'`]$/u.test(s)) return "'";
  if (/^[-‐‑‒–—―−]+$/u.test(s)) return '-';
  if (s === '…') return '...';
  return s;
}

// Tokens carry the text as written (`text`), the comparison key (`key`, with
// quotes/dashes normalised), `fold` (key in lower case), their place in the
// source (`start`/`end`), whether whitespace came before them, and for quote
// marks whether they open or close.
export function tokenize(text) {
  const src = String(text ?? '');
  const out = [];
  let i = 0;
  let spaced = true;
  let inQuote = false;
  while (i < src.length) {
    SPACE.lastIndex = i;
    if (SPACE.test(src)) {
      i = SPACE.lastIndex;
      spaced = true;
      continue;
    }
    WORD.lastIndex = i;
    let m = WORD.exec(src);
    let tok;
    if (m) {
      const joined = m[0].replace(/-[ \t]*\r?\n\s*/g, '');
      tok = { text: joined, key: joined.replace(/[’ʼ]/g, "'").normalize('NFC'), kind: 'word' };
    } else {
      PUNCT.lastIndex = i;
      m = PUNCT.exec(src);
      tok = { text: m[0], key: punctKey(m[0]), kind: 'punct' };
      if (tok.key === '"' || tok.key === "'") {
        const after = src[i + m[0].length];
        if (OPEN_QUOTES.has(m[0])) tok.role = 'open';
        else if (CLOSE_QUOTES.has(m[0])) tok.role = 'close';
        else if (tok.key === '"') tok.role = inQuote ? 'close' : 'open'; // straight double quotes pair up
        else {
          const prev = out[out.length - 1];
          const startish = !prev || spaced || OPENING.has(prev.key) || prev.role === 'open';
          tok.role = startish && after && !/\s/.test(after) ? 'open' : 'close';
        }
      }
    }
    if (tok.key === '"') inQuote = tok.role === 'open';
    tok.fold = tok.key.toLowerCase();
    tok.start = i;
    tok.end = i + m[0].length;
    tok.spaceBefore = spaced;
    out.push(tok);
    i = tok.end;
    spaced = false;
  }
  return out;
}

// Whether a space belongs between two tokens when text is rebuilt: none
// before , . ; : ! ? ) or a closing quote, none after ( or an opening quote;
// around hyphens, dashes and slashes, whatever the source had.
export function needSpace(prev, next) {
  if (!prev || !next) return false;
  if (CLOSING.has(next.key) || next.role === 'close') return false;
  if (OPENING.has(prev.key) || prev.role === 'open') return false;
  if (next.key === '-' || next.key === '/' || prev.key === '-' || prev.key === '/') return next.spaceBefore;
  return true;
}

export function joinTokens(tokens) {
  let s = '';
  tokens.forEach((t, n) => {
    if (n && needSpace(tokens[n - 1], t)) s += ' ';
    s += t.text;
  });
  return s;
}

// The page window [start, end) that best fits the whole dictation: a
// semi-global alignment (page text before and after is free; inside it,
// every skipped or wrong token costs a point and every match earns two).
function bestWindow(d, p) {
  const n = d.length;
  const m = p.length;
  const w = m + 1;
  const score = new Int32Array((n + 1) * w);
  const from = new Uint8Array((n + 1) * w); // 0 diagonal, 1 up (skip dictated), 2 left (skip page)
  for (let i = 1; i <= n; i++) {
    score[i * w] = -i;
    from[i * w] = 1;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[(i - 1) * w + j - 1] + (d[i - 1].fold === p[j - 1].fold ? 2 : -1);
      const up = score[(i - 1) * w + j] - 1;
      const left = score[i * w + j - 1] - 1;
      let best = diag;
      let dir = 0;
      if (up > best) (best = up), (dir = 1);
      if (left > best) (best = left), (dir = 2);
      score[i * w + j] = best;
      from[i * w + j] = dir;
    }
  }
  let end = 0;
  for (let j = 1; j <= m; j++) if (score[n * w + j] > score[n * w + end]) end = j;
  let i = n;
  let j = end;
  while (i > 0) {
    const dir = from[i * w + j];
    if (dir === 0) i--, j--;
    else if (dir === 1) i--;
    else j--;
  }
  return [j, end];
}

// Word-level LCS (case-insensitive) as a list of steps: 'same', 'case'
// (equal but for case), 'del' (only in the dictation), 'ins' (only on the
// page). Each step has the dictated index `d` and/or page index `p`.
function lcsSteps(d, p) {
  const n = d.length;
  const m = p.length;
  const w = m + 1;
  const len = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = d[i].fold === p[j].fold ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && d[i].fold === p[j].fold) {
      steps.push({ op: d[i].key === p[j].key ? 'same' : 'case', d: i++, p: j++ });
    } else if (j >= m || (i < n && len[(i + 1) * w + j] >= len[i * w + j + 1])) {
      steps.push({ op: 'del', d: i++ });
    } else {
      steps.push({ op: 'ins', p: j++ });
    }
  }
  return steps;
}

// Compare a dictated quote with scanned page text. Returns:
//   diffs     – one per run of adjacent differences, in order: { kind
//               ('change' | 'case'), dictated (as typed), page (the page's
//               version), from/to (the dictated characters it replaces) … }
//   segments  – the dictated text cut into { text } and { diff } pieces, to
//               draw it with the differences in place
//   passage   – the page passage the quote was matched to, rebuilt as text
//   matched   – how many tokens matched (0: the page doesn't contain it)
export function compareQuote(dictated, page) {
  const text = String(dictated ?? '');
  const d = tokenize(text);
  const p = tokenize(page);
  const none = { diffs: [], segments: text ? [{ text }] : [], passage: '', matched: 0 };
  if (!d.length || !p.length) return none;

  const [ws, we] = bestWindow(d, p);
  const hits = lcsSteps(d, p.slice(ws, we)).filter((s) => s.op === 'same' || s.op === 'case');
  if (!hits.length) return none;
  const first = hits[0];
  const last = hits[hits.length - 1];
  const start = Math.max(0, ws + first.p - first.d);
  let end = Math.min(p.length, ws + last.p + 1 + (d.length - 1 - last.d));
  // Dictation often drops the full stop: take the sentence's end with it.
  while (end < p.length && !p[end].spaceBefore && SENTENCE_END.has(p[end].key)) end++;
  const region = p.slice(start, end);

  const steps = lcsSteps(d, region);
  const diffs = [];
  let matched = 0;
  let run = null;
  const close = () => {
    if (!run) return;
    const { a, b, pageTokens, caseOnly } = run;
    const from = a < b ? d[a].start : a > 0 ? d[a - 1].end : d[0].start;
    const to = a < b ? d[b - 1].end : from;
    diffs.push({
      kind: caseOnly ? 'case' : 'change',
      dictated: text.slice(from, to),
      page: joinTokens(pageTokens),
      from,
      to,
      before: d[a - 1] || null,
      after: d[b] || null,
      pageTokens,
    });
    run = null;
  };
  let di = 0; // next dictated index
  for (const s of steps) {
    if (s.op === 'same') {
      matched++;
      close();
      di = s.d + 1;
      continue;
    }
    if (s.op === 'case') matched++;
    if (!run) run = { a: di, b: di, pageTokens: [], caseOnly: true };
    if (s.d !== undefined) run.b = di = s.d + 1;
    if (s.p !== undefined) run.pageTokens.push(region[s.p]);
    if (s.op !== 'case') run.caseOnly = false;
  }
  close();

  const segments = [];
  let at = 0;
  for (const diff of diffs) {
    if (diff.from > at) segments.push({ text: text.slice(at, diff.from) });
    segments.push({ diff });
    at = diff.to;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });

  return { diffs, segments, passage: joinTokens(region), matched };
}

// The dictated text with one difference replaced by the page's version.
// `text` must be the text the diff was computed from. Only the dictated
// words change; the rest keeps its spacing and line breaks, and the spaces
// either side of the change follow the rules in needSpace.
export function applyDiff(text, diff) {
  const left = text.slice(0, diff.from).replace(/[ \t]+$/, '');
  const right = text.slice(diff.to).replace(/^[ \t]+/, '');
  const mid = joinTokens(diff.pageTokens);
  const gap = (side, prev, next) => (side && !/\s$/.test(side) && needSpace(prev, next) ? ' ' : '');
  if (!mid) return left + (right && !/^\s/.test(right) ? gap(left, diff.before, diff.after) : '') + right;
  const firstTok = diff.pageTokens[0];
  const lastTok = diff.pageTokens[diff.pageTokens.length - 1];
  const before = gap(left, diff.before, firstTok);
  const after = right && !/^\s/.test(right) && needSpace(lastTok, diff.after) ? ' ' : '';
  return left + before + mid + after + right;
}
