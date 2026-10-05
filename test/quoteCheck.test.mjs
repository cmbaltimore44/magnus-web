// Unit tests for js/quoteCheck.js ("Check against page"). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareQuote, applyDiff, tokenize, joinTokens } from '../js/quoteCheck.js';

const summary = (r) => r.diffs.map((d) => [d.kind, d.dictated, d.page]);
// Apply every difference one at a time, re-comparing after each (as the UI does).
function applyAll(text, page) {
  for (let n = 0; n < 50; n++) {
    const r = compareQuote(text, page);
    if (!r.diffs.length) return text;
    text = applyDiff(text, r.diffs[0]);
  }
  throw new Error('did not converge');
}

test('exact match', () => {
  const r = compareQuote('It was a bright cold day in April.', 'It was a bright cold day in April.');
  assert.deepEqual(r.diffs, []);
  assert.equal(r.matched, 9);
  assert.equal(r.passage, 'It was a bright cold day in April.');
});

test('one-word error', () => {
  const r = compareQuote('It was a bright cold day in May.', 'It was a bright cold day in April.');
  assert.deepEqual(summary(r), [['change', 'May', 'April']]);
  assert.equal(applyDiff('It was a bright cold day in May.', r.diffs[0]), 'It was a bright cold day in April.');
});

test('homophone run is one difference', () => {
  const q = 'I think their going to the store';
  const r = compareQuote(q, 'I think they’re going to the store');
  assert.deepEqual(summary(r), [['change', 'their', 'they’re']]);
  const r2 = compareQuote('I think they are going to the store', 'I think they’re going to the store');
  assert.deepEqual(summary(r2), [['change', 'they are', 'they’re']]);
  assert.equal(applyDiff('I think they are going to the store', r2.diffs[0]), 'I think they’re going to the store');
  const r3 = compareQuote('there going two the store', 'they’re going to the store');
  assert.deepEqual(summary(r3), [['change', 'there', 'they’re'], ['change', 'two', 'to']]);
});

test('missing word and extra word', () => {
  const page = 'The only way out is through.';
  const miss = compareQuote('The only way is through.', page);
  assert.deepEqual(summary(miss), [['change', '', 'out']]);
  assert.equal(applyDiff('The only way is through.', miss.diffs[0]), page);
  const extra = compareQuote('The only real way out is through.', page);
  assert.deepEqual(summary(extra), [['change', 'real', '']]);
  assert.equal(applyDiff('The only real way out is through.', extra.diffs[0]), page);
});

test('punctuation-only differences', () => {
  const page = 'Yes, I said, yes I will; Yes.';
  const q = 'Yes I said yes I will. Yes!';
  const r = compareQuote(q, page);
  assert.deepEqual(summary(r), [['change', '', ','], ['change', '', ','], ['change', '.', ';'], ['change', '!', '.']]);
  assert.equal(applyDiff(q, r.diffs[0]), 'Yes, I said yes I will. Yes!');
  assert.equal(applyAll(q, page), page);
});

test('curly vs straight quotes and dashes count as equal', () => {
  const r = compareQuote('"Don\'t," she said -- "not yet."', '“Don’t,” she said — “not yet.”');
  assert.deepEqual(r.diffs, []);
  assert.ok(r.matched > 0);
  assert.deepEqual(compareQuote('a well-known fact', 'a well–known fact').diffs, []);
});

test('scanned text with extra sentences before and after is trimmed', () => {
  const page = 'He closed the door. The cat sat by the fire.\nThe house is a world, said the old man; and the tide came in. Then the lamps went out and the dog barked.';
  const q = 'The house is a world said the old man and the tide came in.';
  const r = compareQuote(q, page);
  assert.equal(r.passage, 'The house is a world, said the old man; and the tide came in.');
  assert.deepEqual(summary(r), [['change', '', ','], ['change', '', ';']]);
});

test('wrong first word and wrong last word still get suggestions', () => {
  const page = 'Earlier text here. Beauty is truth, truth beauty, that is all ye know on earth. More text after.';
  const q = 'Duty is truth, truth beauty, that is all ye know on birth.';
  const r = compareQuote(q, page);
  assert.deepEqual(summary(r), [['change', 'Duty', 'Beauty'], ['change', 'birth', 'earth']]);
  assert.equal(r.passage, 'Beauty is truth, truth beauty, that is all ye know on earth.');
  assert.equal(applyAll(q, page), r.passage);
});

test('line-break hyphenation joins the word', () => {
  const page = 'a deep under-\nstanding of the\nworld';
  assert.deepEqual(compareQuote('a deep understanding of the world', page).diffs, []);
  const r = compareQuote('a deep under standing of the world', page);
  assert.deepEqual(summary(r), [['change', 'under standing', 'understanding']]);
  assert.equal(tokenize(page).map((t) => t.text).join('|'), 'a|deep|understanding|of|the|world');
});

test('empty inputs', () => {
  for (const [a, b] of [['', ''], ['', 'page'], ['quote', ''], ['   ', '\n'], [null, undefined]]) {
    const r = compareQuote(a, b);
    assert.deepEqual(r.diffs, []);
    assert.equal(r.matched, 0);
    assert.equal(r.passage, '');
  }
  assert.equal(compareQuote('completely different', 'nothing alike here').matched, 0);
});

test('case differences are their own, quieter kind', () => {
  const r = compareQuote('the Sea is calm tonight.', 'The sea is calm tonight.');
  assert.deepEqual(summary(r), [['case', 'the Sea', 'The sea']]);
});

test('"use page text for all" gives the page passage', () => {
  const page = 'Chapter 3\n\n“It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.”\n\nHowever little known';
  const q = 'It is a truth universally acknowledge that a single man in position of a good fortune must be in want of a wife';
  const r = compareQuote(q, page);
  assert.equal(r.passage, 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.');
  assert.equal(applyAll(q, page), r.passage);
  // With the quote marks dictated too, the passage includes them.
  const r2 = compareQuote('"It is a truth universally acknowledged that a single man in possession of a good fortune must be in want of a wife"', page);
  assert.equal(r2.passage, '“It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.”');
});

test('rebuilt text: no space before closing punctuation, none inside quotes', () => {
  assert.equal(joinTokens(tokenize('He said , " hello " ( quietly ) ; then left !')), 'He said, "hello" (quietly); then left!');
  const q = 'She said hello and left';
  const r = compareQuote(q, 'She said, “Hello,” and left.');
  let t = q;
  for (const d of [...r.diffs].reverse()) t = applyDiff(t, d); // later ones first keeps offsets valid
  assert.equal(t, 'She said, “Hello,” and left.');
});

test('line breaks in the dictation survive a fix elsewhere', () => {
  const q = 'Roses are red\nviolets are blew';
  const r = compareQuote(q, 'Roses are red\nViolets are blue');
  assert.deepEqual(summary(r), [['case', 'violets', 'Violets'], ['change', 'blew', 'blue']]);
  assert.equal(applyDiff(q, r.diffs[1]), 'Roses are red\nviolets are blue');
});
