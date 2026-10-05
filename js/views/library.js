import * as booksApi from '../data/books.js';
import * as quotesApi from '../data/quotes.js';
import { hashSegments } from '../hash.js';
import { showError, showToast, showConfirmToast, showActionToast } from '../toast.js';
import { stopVoiceInput } from '../voiceInput.js';
import { deleteWithUndo } from '../undo.js';
import { lookupBooks, normalizeIsbn } from '../openLibrary.js';
import { bookStats } from '../stats.js';
import { todayISO } from '../dates.js';
import { statTiles, section, barList } from '../charts.js';
import { addWantToRead, needsDetails, nextWantOrder } from '../bookQuickAdd.js';
import { parseBookText } from '../quickAdd.js';
import { compareQuote, applyDiff } from '../quoteCheck.js';

const BOOK_GROUPS = [
  { key: 'reading', label: 'Currently Reading', collapsible: false },
  { key: 'want_to_read', label: 'Want to Read', collapsible: true },
  { key: 'finished', label: 'Finished', collapsible: true },
  { key: 'dnf', label: 'Did Not Finish', collapsible: true },
];

const COLLAPSED_GROUPS_KEY = 'kanban.library.collapsedGroups';

function loadCollapsedGroups() {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === null) return new Set(['finished', 'dnf']);
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(['finished', 'dnf']);
  }
}

let collapsedGroups = loadCollapsedGroups();

function saveCollapsedGroups() {
  localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
}

function toggleGroup(key) {
  if (collapsedGroups.has(key)) collapsedGroups.delete(key);
  else collapsedGroups.add(key);
  saveCollapsedGroups();
  renderBooksList();
}

let userId = null;
let books = [];
let bookHighlights = [];
let allQuotes = [];
let currentBookId = null;
let editingQuoteId = null;
let quoteContext = 'standalone'; // 'book' | 'standalone'
let quoteLockedBookId = null;
let favoritesOnly = false;

// Want to Read (#/library/want)
const UP_NEXT = 3; // the first few are "Up next", the rest "Later"
let wantFilter = '';
const pendingWant = []; // rapid adds still waiting on the server, so their order holds
let detailReturn = '#/library'; // where the book editor goes back to
let lookupOnOpen = null; // book id: run the Open Library lookup once its editor opens
let lookupFillMissing = false; // this lookup only fills what the book is missing

const el = {};

function cacheElements() {
  Object.assign(el, {
    booksPanel: document.getElementById('library-books-panel'),
    bookDetailPanel: document.getElementById('library-book-detail-panel'),
    quotesPanel: document.getElementById('library-quotes-panel'),
    statsPanel: document.getElementById('library-stats-panel'),
    stats: document.getElementById('library-stats'),

    wantPanel: document.getElementById('library-want-panel'),
    wantCount: document.getElementById('want-count'),
    wantAddForm: document.getElementById('want-add-form'),
    wantAddInput: document.getElementById('want-add-input'),
    wantFilter: document.getElementById('want-filter'),
    wantList: document.getElementById('want-list'),
    backLink: document.getElementById('book-back-link'),

    booksList: document.getElementById('books-list'),
    bookCount: document.getElementById('book-count'),
    newBookBtn: document.getElementById('new-book-btn'),

    cover: document.getElementById('book-detail-cover'),
    title: document.getElementById('book-title'),
    author: document.getElementById('book-author'),
    coverUrl: document.getElementById('book-cover-url'),
    status: document.getElementById('book-status'),
    format: document.getElementById('book-format'),
    started: document.getElementById('book-started'),
    finished: document.getElementById('book-finished'),
    rating: document.getElementById('book-rating'),
    isbn: document.getElementById('book-isbn'),
    notes: document.getElementById('book-notes'),
    lookupBtn: document.getElementById('book-lookup-btn'),
    lookupResults: document.getElementById('book-lookup-results'),
    saveBookBtn: document.getElementById('save-book-btn'),
    startBookBtn: document.getElementById('start-book-btn'),
    deleteBookBtn: document.getElementById('delete-book-btn'),
    addHighlightBtn: document.getElementById('add-highlight-btn'),
    highlightsList: document.getElementById('book-highlights-list'),

    quoteCount: document.getElementById('quote-count'),
    newQuoteBtn: document.getElementById('new-quote-btn'),
    quotesList: document.getElementById('quotes-list'),
    favoritesFilter: document.getElementById('quotes-favorites-filter'),

    tabLinks: document.querySelectorAll('.tab-link'),

    quoteModalOverlay: document.getElementById('quote-modal-overlay'),
    quoteModalTitle: document.getElementById('quote-modal-title'),
    quoteModalClose: document.getElementById('quote-modal-close'),
    quoteForm: document.getElementById('quote-form'),
    quoteBookField: document.getElementById('quote-book-field'),
    quoteBook: document.getElementById('quote-book'),
    quoteText: document.getElementById('quote-text'),
    quoteAttribution: document.getElementById('quote-attribution'),
    quoteAttributionLabel: document.getElementById('quote-attribution-label'),
    quoteFavorite: document.getElementById('quote-favorite'),
    quoteDeleteBtn: document.getElementById('quote-delete-btn'),
    quoteCancelBtn: document.getElementById('quote-cancel-btn'),
    quoteModal: document.querySelector('#quote-modal-overlay .quote-modal'),
    quoteSheetCancel: document.getElementById('quote-sheet-cancel'),
    quoteEditor: document.getElementById('quote-editor'),
    quoteDetails: document.getElementById('quote-details'),
    quoteCheckBtn: document.getElementById('quote-check-btn'),
    quoteCheck: document.getElementById('quote-check'),
    quotePageText: document.getElementById('quote-page-text'),
    quoteCheckResult: document.getElementById('quote-check-result'),
    quoteCheckAll: document.getElementById('quote-check-all'),
    quoteCheckDone: document.getElementById('quote-check-done'),
  });
}

// ---------- books list ----------

function renderBooksList() {
  el.booksList.innerHTML = '';
  el.bookCount.textContent = books.length ? `${books.length} book${books.length === 1 ? '' : 's'}` : '';

  if (books.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No books yet — add one to get started.';
    el.booksList.appendChild(hint);
    return;
  }

  BOOK_GROUPS.forEach((group) => {
    const groupBooks = books.filter((b) => b.status === group.key);
    if (groupBooks.length === 0) return;

    const header = document.createElement('div');
    header.className = 'checklist-header library-group-header';

    const label = document.createElement('span');
    label.className = 'meta-label';
    label.textContent = `${group.label} (${groupBooks.length})`;
    header.appendChild(label);

    const isCollapsed = group.collapsible && collapsedGroups.has(group.key);

    if (group.collapsible) {
      header.classList.add('collapsible');
      const caret = document.createElement('span');
      caret.className = 'library-group-caret';
      caret.textContent = isCollapsed ? '▸' : '▾';
      header.appendChild(caret);
      header.addEventListener('click', () => toggleGroup(group.key));
    }

    el.booksList.appendChild(header);
    if (isCollapsed) return;

    groupBooks.forEach((book) => {
      const row = document.createElement('div');
      row.className = 'book-row';
      if (group.key === 'reading') row.classList.add('book-row-current');

      const cover = document.createElement('img');
      cover.className = 'book-cover-thumb';
      cover.src = book.cover_image_url || '';
      cover.alt = '';
      row.appendChild(cover);

      const meta = document.createElement('div');
      meta.className = 'book-row-meta';

      const title = document.createElement('div');
      title.className = 'book-row-title';
      title.textContent = book.title;
      meta.appendChild(title);

      if (book.author) {
        const author = document.createElement('div');
        author.className = 'book-row-author';
        author.textContent = book.author;
        meta.appendChild(author);
      }

      row.appendChild(meta);

      row.addEventListener('click', () => {
        location.hash = '#/library/books/' + book.id;
      });

      el.booksList.appendChild(row);
    });
  });
}

export async function handleNewBook() {
  try {
    const created = await booksApi.createBook(userId, { title: 'Untitled Book', status: 'want_to_read' }, nextWantOrder(books));
    books.unshift(created);
    location.hash = '#/library/books/' + created.id;
  } catch (err) {
    showError(err);
  }
}

// ---------- Want to Read ----------

function byWantOrder(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at));
}

function wantBooks() {
  return books.filter((b) => b.status === 'want_to_read').sort(byWantOrder);
}

function firstLine(text) {
  return (
    String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

function matchesFilter(book, query) {
  return [book.title, book.author, book.notes].some((v) => String(v || '').toLowerCase().includes(query));
}

function renderWantList() {
  if (el.wantList.querySelector('.dragging')) return; // mid-drag: dragend re-renders
  const all = wantBooks();
  el.wantCount.textContent = all.length ? `${all.length} book${all.length === 1 ? '' : 's'}` : '';
  el.wantList.innerHTML = '';

  const query = wantFilter.trim().toLowerCase();
  const shown = all.map((book, i) => ({ book, pos: i + 1 })).filter(({ book }) => !query || matchesFilter(book, query));
  if (!shown.length) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = all.length ? `No books match “${wantFilter.trim()}”.` : 'Nothing here yet — add a book above.';
    el.wantList.appendChild(hint);
    return;
  }

  [
    ['Up next', shown.filter((x) => x.pos <= UP_NEXT)],
    ['Later', shown.filter((x) => x.pos > UP_NEXT)],
  ].forEach(([label, rows]) => {
    if (!rows.length) return;
    const header = document.createElement('li');
    header.className = 'checklist-header want-group-header';
    const text = document.createElement('span');
    text.className = 'meta-label';
    text.textContent = label;
    header.appendChild(text);
    el.wantList.appendChild(header);
    rows.forEach(({ book, pos }) => el.wantList.appendChild(renderWantRow(book, pos, all.length, !!query)));
  });
}

function smallButton(className, text, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  return btn;
}

// One line: position, title, author and the first line of notes (muted).
// While filtering, the order can't change (drag and arrows are off).
function renderWantRow(book, pos, total, filtering) {
  const row = document.createElement('li');
  row.className = 'routine-row want-row';
  row.dataset.id = book.id;
  row.draggable = !filtering;

  const num = document.createElement('span');
  num.className = 'want-pos';
  num.textContent = String(pos);
  row.appendChild(num);

  const main = document.createElement('span');
  main.className = 'want-main';
  const title = document.createElement('a');
  title.className = 'want-title';
  title.href = '#/library/books/' + book.id;
  title.draggable = false;
  title.textContent = book.title;
  title.addEventListener('click', () => {
    detailReturn = '#/library/want';
  });
  main.appendChild(title);
  if (book.author) {
    const author = document.createElement('span');
    author.className = 'want-author';
    author.textContent = book.author;
    main.appendChild(author);
  }
  const note = firstLine(book.notes);
  if (note) {
    const noteEl = document.createElement('span');
    noteEl.className = 'want-note';
    noteEl.textContent = note;
    main.appendChild(noteEl);
  }
  main.title = [book.title, book.author, note].filter(Boolean).join(' — ');
  row.appendChild(main);

  if (needsDetails(book)) {
    row.appendChild(
      smallButton('want-badge', '?', `Missing ${book.author ? 'a cover' : 'the author'}: look up “${book.title}” on Open Library`, () =>
        openWithLookup(book.id)
      )
    );
  }

  const start = smallButton('btn btn-ghost lists-small-btn want-start', 'Start', `Start reading “${book.title}”`, () =>
    startReading(book.id).catch(showError)
  );
  row.appendChild(start);

  if (!filtering) {
    const up = smallButton('routine-remove want-move want-up', '↑', `Move “${book.title}” up`, () => moveWant(book.id, -1));
    up.disabled = pos === 1;
    const down = smallButton('routine-remove want-move want-down', '↓', `Move “${book.title}” down`, () => moveWant(book.id, 1));
    down.disabled = pos === total;
    row.append(up, down);
  }
  row.appendChild(smallButton('routine-remove want-remove', '×', `Delete “${book.title}”`, () => deleteWantBook(book)));

  if (!filtering) {
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      saveWantOrder(Array.from(el.wantList.querySelectorAll('.want-row')).map((r) => r.dataset.id));
      renderWantList();
    });
  }
  return row;
}

function wantRowAfter(y) {
  const rows = Array.from(el.wantList.querySelectorAll('.want-row:not(.dragging)'));
  return rows.find((row) => {
    const rect = row.getBoundingClientRect();
    return y - rect.top < rect.height / 2;
  });
}

function wireWantDrag() {
  el.wantList.addEventListener('dragover', (e) => {
    const dragging = el.wantList.querySelector('.want-row.dragging');
    if (!dragging) return;
    e.preventDefault();
    const after = wantRowAfter(e.clientY);
    if (after) el.wantList.insertBefore(dragging, after);
    else el.wantList.appendChild(dragging);
  });
}

// Renumbers the Want to Read books 0…n-1 in this order; saves only the ones that moved.
function saveWantOrder(ids) {
  const changes = [];
  ids.forEach((id, index) => {
    const book = books.find((b) => b.id === id);
    if (book && book.sort_order !== index) {
      book.sort_order = index;
      changes.push({ id, sort_order: index });
    }
  });
  if (!changes.length) return;
  booksApi.setSortOrders(changes).catch((err) => {
    showError(err);
    refreshLibrary();
  });
}

// The up/down buttons: drag is unreliable on iPhone.
function moveWant(id, delta) {
  const order = wantBooks().map((b) => b.id);
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  saveWantOrder(order);
  renderWantList();
  // Keep focus on the arrow so it can be tapped again (or its twin, at the end).
  const row = el.wantList.querySelector(`.want-row[data-id="${CSS.escape(id)}"]`);
  const again = row?.querySelector(delta < 0 ? '.want-up' : '.want-down');
  (again && !again.disabled ? again : row?.querySelector(delta < 0 ? '.want-down' : '.want-up'))?.focus();
}

function upsertBook(book) {
  const index = books.findIndex((b) => b.id === book.id);
  if (index >= 0) books[index] = book;
  else books.unshift(book);
}

function renderBookLists() {
  renderBooksList();
  renderWantList();
}

// The add box: "Title by Author" or an ISBN, Enter, and straight on to the next.
async function handleWantAdd(e) {
  e.preventDefault();
  const text = el.wantAddInput.value.trim();
  if (!text) return;
  const fields = parseBookText(text);
  el.wantAddInput.value = '';
  el.wantAddInput.focus();

  const others = [...books, ...pendingWant];
  const placeholder = { status: 'want_to_read', sort_order: nextWantOrder(others) };
  pendingWant.push(placeholder);
  try {
    const { book, enriched } = await addWantToRead(userId, fields, others);
    upsertBook(book);
    renderBookLists();
    showToast(`Added “${book.title}” to Want to Read.`, { type: 'success', duration: 2500 });
    enriched.then((updated) => {
      if (!updated) return;
      upsertBook(updated);
      renderBookLists();
      showToast(`Found details for “${updated.title}”.`, { type: 'success', duration: 2500 });
    });
  } catch (err) {
    showError(err);
    if (!el.wantAddInput.value) el.wantAddInput.value = text; // nothing typed is lost
  } finally {
    pendingWant.splice(pendingWant.indexOf(placeholder), 1);
  }
}

async function deleteWantBook(book) {
  try {
    await deleteWithUndo({
      message: `Deleted “${book.title}”.`,
      table: 'books',
      id: book.id,
      del: () => booksApi.deleteBook(book.id),
      cascades: [{ table: 'quotes', column: 'book_id' }],
    });
    books = books.filter((b) => b.id !== book.id);
    renderBookLists();
  } catch (err) {
    showError(err);
  }
}

// "Start": status Reading, started today (local date), with an Undo that
// puts back the previous status and started date. `fields` are other edits
// to save along with it (the book editor's form).
async function startReading(id, fields = {}) {
  const book = books.find((b) => b.id === id) || (await booksApi.getBook(id));
  const before = { status: book.status, started_date: book.started_date ?? null };
  const updated = await booksApi.updateBook(id, { ...fields, status: 'reading', started_date: todayISO() });
  upsertBook(updated);
  renderBookLists();
  if (currentBookId === id) showEditorStatus(updated);
  showActionToast(`Started reading “${updated.title}”.`, {
    actionLabel: 'Undo',
    onAction: async () => {
      try {
        const restored = await booksApi.updateBook(id, before);
        upsertBook(restored);
        renderBookLists();
        if (currentBookId === id) showEditorStatus(restored);
        showToast('Restored.', { type: 'success', duration: 2500 });
      } catch (err) {
        showError(err);
      }
    },
  });
  return updated;
}

// The "?" badge: open the book and run the Open Library lookup, which then
// only fills in what's missing.
function openWithLookup(id) {
  detailReturn = '#/library/want';
  lookupOnOpen = id;
  location.hash = '#/library/books/' + id;
}

// ---------- book detail ----------

async function openBookDetail(id) {
  if (id === currentBookId) return; // already showing this book — don't clobber in-progress edits
  currentBookId = id;
  let book = books.find((b) => b.id === id);
  try {
    if (!book) book = await booksApi.getBook(id);
    bookHighlights = await quotesApi.listQuotesForBook(id);
  } catch (err) {
    showError(err);
    location.hash = '#/library';
    return;
  }

  el.cover.src = book.cover_image_url || '';
  el.title.value = book.title;
  el.author.value = book.author || '';
  el.coverUrl.value = book.cover_image_url || '';
  el.format.value = book.format;
  showEditorStatus(book);
  el.finished.value = book.finished_date || '';
  el.rating.value = book.rating != null ? String(book.rating) : '';
  el.isbn.value = book.isbn || '';
  el.notes.value = book.notes || '';
  clearLookup();
  renderHighlights();
  if (lookupOnOpen === id) {
    lookupOnOpen = null;
    handleLookup({ fillMissing: true });
  }
}

// Status + started date in the editor, and "Start reading" while it's Want to Read.
function showEditorStatus(book) {
  el.status.value = book.status;
  el.started.value = book.started_date || '';
  el.startBookBtn.hidden = book.status !== 'want_to_read';
}

// ---------- Open Library lookup ----------

const PLACEHOLDER_TITLE = 'Untitled Book';
let lookupSeq = 0;

// "Untitled Book", or "ISBN …" from an ISBN quick add that Open Library didn't know.
function isPlaceholderTitle(title) {
  return !title || title === PLACEHOLDER_TITLE || /^ISBN [\dX]{10,13}$/.test(title);
}

function clearLookup() {
  lookupSeq++;
  el.lookupResults.hidden = true;
  el.lookupResults.innerHTML = '';
}

function lookupMessage(text) {
  el.lookupResults.hidden = false;
  el.lookupResults.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'book-lookup-message';
  hint.textContent = text;
  el.lookupResults.appendChild(hint);
}

async function handleLookup({ fillMissing = false } = {}) {
  lookupFillMissing = fillMissing;
  const isbn = normalizeIsbn(el.isbn.value);
  const title = isPlaceholderTitle(el.title.value.trim()) ? '' : el.title.value.trim();
  const query = isbn || [title, el.author.value.trim()].filter(Boolean).join(' ');
  if (!query) {
    lookupMessage('Type an ISBN, or a title (and author), first.');
    return;
  }
  const seq = ++lookupSeq;
  lookupMessage('Searching Open Library…');
  let results;
  try {
    results = await lookupBooks(query);
  } catch {
    if (seq === lookupSeq) lookupMessage("Couldn't reach Open Library. Check your connection and try again.");
    return;
  }
  if (seq !== lookupSeq) return;
  if (!results.length) {
    lookupMessage('No matches on Open Library.');
    return;
  }
  el.lookupResults.innerHTML = '';
  results.forEach((r) => el.lookupResults.appendChild(renderLookupResult(r)));
}

function renderLookupResult(result) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'book-lookup-result';

  const cover = document.createElement('img');
  cover.className = 'book-cover-thumb';
  cover.alt = '';
  cover.loading = 'lazy';
  if (result.cover_image_url) cover.src = result.cover_image_url;
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  row.appendChild(cover);

  const meta = document.createElement('span');
  meta.className = 'book-row-meta';
  const title = document.createElement('span');
  title.className = 'book-row-title';
  title.textContent = result.title;
  meta.appendChild(title);
  const sub = document.createElement('span');
  sub.className = 'book-row-author';
  sub.textContent = [result.author, result.year].filter(Boolean).join(' · ');
  meta.appendChild(sub);
  row.appendChild(meta);

  row.addEventListener('click', () => applyLookup(result));
  return row;
}

// Fills the empty fields (a typed title/author wins) plus cover and ISBN —
// or, from the Want to Read "?" badge, only the empty fields.
function applyLookup(result) {
  const title = el.title.value.trim();
  if (isPlaceholderTitle(title) && result.title) el.title.value = result.title;
  if (!el.author.value.trim() && result.author) el.author.value = result.author;
  if (result.isbn && !(lookupFillMissing && el.isbn.value.trim())) el.isbn.value = result.isbn;
  if (result.cover_image_url && !(lookupFillMissing && el.coverUrl.value.trim())) {
    el.coverUrl.value = result.cover_image_url;
    el.cover.src = result.cover_image_url;
  }
  clearLookup();
  showToast('Filled in from Open Library. Save to keep it.', { type: 'success', duration: 3000 });
}

function editorFields() {
  const ratingValue = el.rating.value ? Number(el.rating.value) : null;
  return {
    title: el.title.value.trim() || 'Untitled Book',
    author: el.author.value.trim() || null,
    cover_image_url: el.coverUrl.value.trim() || null,
    status: el.status.value,
    format: el.format.value,
    started_date: el.started.value || null,
    finished_date: el.finished.value || null,
    rating: ratingValue,
    isbn: el.isbn.value.trim() || null,
    notes: el.notes.value.trim() || null,
  };
}

async function handleSaveBook() {
  const fields = editorFields();
  try {
    const updated = await booksApi.updateBook(currentBookId, fields);
    const index = books.findIndex((b) => b.id === currentBookId);
    if (index >= 0) books[index] = updated;
    renderBookLists();
    location.hash = detailReturn;
  } catch (err) {
    showError(err);
  }
}

function handleDeleteBook() {
  if (!currentBookId) return;
  const id = currentBookId;
  showConfirmToast('Delete this book and all its highlights?', async () => {
    try {
      await deleteWithUndo({
        message: 'Book deleted.',
        table: 'books',
        id,
        del: () => booksApi.deleteBook(id),
        cascades: [{ table: 'quotes', column: 'book_id' }],
      });
      books = books.filter((b) => b.id !== id);
      location.hash = detailReturn;
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- reading stats ----------

const FORMAT_LABELS = { physical: 'Physical', ebook: 'Ebook', audiobook: 'Audiobook', unknown: 'Not set' };

function renderStats() {
  const s = bookStats(books, todayISO());
  el.stats.innerHTML = '';
  if (!books.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No books yet — stats show up once you add some.';
    el.stats.appendChild(hint);
    return;
  }
  const rated = s.ratingCounts.reduce((a, b) => a + b, 0);
  el.stats.append(
    statTiles([
      { label: `Finished in ${todayISO().slice(0, 4)}`, value: s.finishedThisYear },
      { label: 'Finished in total', value: s.finished },
      { label: 'Reading', value: s.reading },
      { label: 'Want to read', value: s.wantToRead },
      { label: 'Did not finish', value: s.dnf },
      { label: 'Average rating', value: s.averageRating != null ? `${s.averageRating.toFixed(1)} / 5` : '—' },
      { label: 'Average days to finish', value: s.averageDays ?? '—' },
    ]),
    section(
      'Ratings',
      rated
        ? barList([5, 4, 3, 2, 1].map((n) => ({ label: `${n} ★`, value: s.ratingCounts[n - 1] })))
        : 'No rated books yet.'
    ),
    section(
      'Finished per year',
      s.byYear.length ? barList(s.byYear.map(([year, n]) => ({ label: year, value: n }))) : 'Books with a finished date show up here.'
    ),
    section(
      'Finished by format',
      s.byFormat.length ? barList(s.byFormat.map(([f, n]) => ({ label: FORMAT_LABELS[f] || f, value: n }))) : 'No finished books yet.'
    ),
    section(
      'Authors you keep reading',
      s.topAuthors.length ? barList(s.topAuthors.map(([a, n]) => ({ label: a, value: n }))) : 'No author with more than one finished book yet.'
    )
  );
}

// ---------- quotes (shared between book highlights + standalone browser) ----------

function renderQuoteRow(quote, context) {
  const row = document.createElement('div');
  row.className = 'quote-row';

  const text = document.createElement('div');
  text.className = 'quote-text';
  text.textContent = `“${quote.quote_text}”`;
  row.appendChild(text);

  const footer = document.createElement('div');
  footer.className = 'quote-row-footer';

  const attribution = document.createElement('span');
  attribution.className = 'quote-attribution';
  attribution.textContent = quotesApi.formatAttribution(quote, books);
  footer.appendChild(attribution);

  const actions = document.createElement('div');
  actions.className = 'quote-row-actions';

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'star-btn' + (quote.is_favorite ? ' starred' : '');
  favBtn.title = quote.is_favorite ? 'Unfavorite' : 'Favorite';
  favBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await quotesApi.updateQuote(quote.id, { is_favorite: !quote.is_favorite });
      await afterQuoteMutation();
    } catch (err) {
      showError(err);
    }
  });
  actions.appendChild(favBtn);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'routine-remove';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirmToast('Delete this quote?', async () => {
      try {
        await deleteQuoteWithUndo(quote.id);
        await afterQuoteMutation();
      } catch (err) {
        showError(err);
      }
    });
  });
  actions.appendChild(removeBtn);

  footer.appendChild(actions);
  row.appendChild(footer);

  row.addEventListener('click', () => openQuoteModal({ quote, context }));

  return row;
}

function renderHighlights() {
  el.highlightsList.innerHTML = '';
  if (bookHighlights.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No highlights yet.';
    el.highlightsList.appendChild(hint);
    return;
  }
  bookHighlights.forEach((q) => el.highlightsList.appendChild(renderQuoteRow(q, 'book')));
}

function renderQuotesList() {
  el.quotesList.innerHTML = '';
  el.quoteCount.textContent = allQuotes.length ? `${allQuotes.length} quote${allQuotes.length === 1 ? '' : 's'}` : '';

  const visible = favoritesOnly ? allQuotes.filter((q) => q.is_favorite) : allQuotes;

  if (visible.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = favoritesOnly
      ? 'No favorite quotes yet — star one to see it here.'
      : 'No quotes yet — add one from a book or from anywhere else.';
    el.quotesList.appendChild(hint);
    return;
  }
  visible.forEach((q) => el.quotesList.appendChild(renderQuoteRow(q, 'standalone')));
}

export async function openQuoteResult(quoteId, bookId) {
  if (bookId) {
    location.hash = '#/library/books/' + bookId;
    bookHighlights = await quotesApi.listQuotesForBook(bookId);
    renderHighlights();
    openQuoteModal({ quote: bookHighlights.find((q) => q.id === quoteId), context: 'book' });
  } else {
    location.hash = '#/library/quotes';
    allQuotes = await quotesApi.listQuotes();
    renderQuotesList();
    openQuoteModal({ quote: allQuotes.find((q) => q.id === quoteId), context: 'standalone' });
  }
}

function deleteQuoteWithUndo(id) {
  return deleteWithUndo({
    message: 'Quote deleted.',
    table: 'quotes',
    id,
    del: () => quotesApi.deleteQuote(id),
    onRestored: afterQuoteMutation,
  });
}

async function afterQuoteMutation() {
  if (currentBookId && !el.bookDetailPanel.hidden) {
    bookHighlights = await quotesApi.listQuotesForBook(currentBookId);
    renderHighlights();
  }
  if (!el.quotesPanel.hidden) {
    allQuotes = await quotesApi.listQuotes();
    renderQuotesList();
  }
}

function populateBookSelect(selectedId) {
  el.quoteBook.innerHTML = '<option value="">(standalone quote, no book)</option>';
  books.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.title;
    el.quoteBook.appendChild(opt);
  });
  el.quoteBook.value = selectedId || '';
}

function openQuoteModal({ quote = null, context, bookId = null } = {}) {
  editingQuoteId = quote ? quote.id : null;
  quoteContext = context;
  quoteLockedBookId = bookId ?? (quote ? quote.book_id : currentBookId);

  el.quoteModalTitle.textContent = quote ? 'Edit Quote' : 'New Quote';
  el.quoteBookField.hidden = context === 'book';
  if (context !== 'book') populateBookSelect(quote ? quote.book_id : null);

  el.quoteText.value = quote ? quote.quote_text : '';

  if (context === 'book') {
    el.quoteAttributionLabel.textContent = 'Page / location';
    el.quoteAttribution.placeholder = 'e.g. 177';
  } else {
    el.quoteAttributionLabel.textContent = 'Attribution / location';
    el.quoteAttribution.placeholder = 'e.g. Location 177, or — Author Name';
  }
  el.quoteAttribution.value = quote ? quote.attribution || '' : '';

  el.quoteFavorite.checked = quote ? !!quote.is_favorite : false;
  el.quoteDeleteBtn.hidden = !quote;
  resetQuoteCheck();
  el.quoteModalOverlay.classList.add('open');
  fitQuoteSheet();
  el.quoteText.focus();
}

function closeQuoteModal() {
  el.quoteModalOverlay.classList.remove('open');
  el.quoteModal.classList.remove('typing');
  editingQuoteId = null;
  resetQuoteCheck();
  stopVoiceInput();
}

// ---------- quote editor on phones ----------
// A full-screen sheet (style.css). The iOS keyboard covers the page rather
// than resizing it, so the sheet follows window.visualViewport, and while
// the keyboard is up for the quote itself the other fields step aside.

const phoneWidth = window.matchMedia('(max-width: 720px)');

function fitQuoteSheet() {
  const vv = window.visualViewport;
  if (!vv || !el.quoteModalOverlay.classList.contains('open')) return;
  el.quoteModal.style.setProperty('--vv-top', `${vv.offsetTop}px`);
  el.quoteModal.style.setProperty('--vv-height', `${vv.height}px`);
  const keyboardUp = window.innerHeight - vv.height > 120;
  el.quoteModal.classList.toggle('typing', phoneWidth.matches && keyboardUp && document.activeElement === el.quoteText);
}

// ---------- check against page ----------
// The user scans the printed page into "Page text" (iOS Scan Text, or paste)
// and taps each difference to take the page's version (js/quoteCheck.js).
// The page text lives only in that box: it's never saved, and it's cleared
// when the quote editor closes.

let quoteCheckResult = null;

function syncQuoteCheckBtn() {
  el.quoteCheckBtn.hidden = !el.quoteText.value.trim();
}

function openQuoteCheck() {
  el.quoteEditor.hidden = true;
  el.quoteDetails.hidden = true;
  el.quoteCheck.hidden = false;
  renderQuoteCheck();
}

function closeQuoteCheck() {
  el.quoteCheck.hidden = true;
  el.quoteEditor.hidden = false;
  el.quoteDetails.hidden = false;
  syncQuoteCheckBtn();
}

function resetQuoteCheck() {
  closeQuoteCheck();
  el.quotePageText.value = '';
  el.quoteCheckResult.replaceChildren();
  quoteCheckResult = null;
}

function quoteCheckNote(text, className = '') {
  const p = document.createElement('p');
  p.className = `quote-check-status ${className}`.trim();
  p.textContent = text;
  return p;
}

function quoteDiffButton(diff, quote) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = diff.kind === 'case' ? 'qc-diff qc-diff-case' : 'qc-diff';
  if (diff.dictated) {
    const del = document.createElement('del');
    del.textContent = diff.dictated;
    btn.appendChild(del);
  }
  if (diff.page) {
    const ins = document.createElement('ins');
    ins.textContent = diff.page;
    btn.appendChild(ins);
  }
  const label = !diff.dictated ? `Add “${diff.page}”` : !diff.page ? `Remove “${diff.dictated}”` : `Replace “${diff.dictated}” with “${diff.page}”`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', () => {
    const at = [...el.quoteCheckResult.querySelectorAll('.qc-diff')].indexOf(btn);
    el.quoteText.value = applyDiff(quote, diff);
    renderQuoteCheck();
    // Keep the place: focus the next difference, if there is one.
    const next = el.quoteCheckResult.querySelectorAll('.qc-diff')[at];
    (next || el.quoteCheckDone).focus({ preventScroll: true });
  });
  return btn;
}

function renderQuoteCheck() {
  const box = el.quoteCheckResult;
  box.replaceChildren();
  el.quoteCheckAll.hidden = true;
  quoteCheckResult = null;
  if (!el.quotePageText.value.trim()) return;

  const quote = el.quoteText.value;
  const result = compareQuote(quote, el.quotePageText.value);
  if (!result.matched) {
    box.appendChild(quoteCheckNote('The page text doesn’t match the quote. Check that the scan has the right passage.'));
    return;
  }
  quoteCheckResult = result;
  if (!result.diffs.length) {
    box.appendChild(quoteCheckNote('Matches the page ✓', 'matches'));
    return;
  }
  const n = result.diffs.length;
  box.appendChild(quoteCheckNote(`${n} difference${n === 1 ? '' : 's'}. Tap one to use the page’s version.`));
  const text = document.createElement('p');
  text.className = 'quote-check-text';
  for (const seg of result.segments) {
    if (seg.diff) text.appendChild(quoteDiffButton(seg.diff, quote));
    else text.append(seg.text);
  }
  box.appendChild(text);
  el.quoteCheckAll.hidden = false;
}

function useAllPageText() {
  if (!quoteCheckResult) return;
  el.quoteText.value = quoteCheckResult.passage;
  renderQuoteCheck();
  el.quoteCheckDone.focus({ preventScroll: true });
}

async function handleQuoteSubmit(e) {
  e.preventDefault();
  const text = el.quoteText.value.trim();
  if (!text) return;

  const book_id = quoteContext === 'book' ? quoteLockedBookId : el.quoteBook.value || null;
  const attribution = el.quoteAttribution.value.trim() || null;

  const fields = {
    book_id,
    quote_text: text,
    attribution,
    is_favorite: el.quoteFavorite.checked,
  };

  try {
    if (editingQuoteId) {
      await quotesApi.updateQuote(editingQuoteId, fields);
    } else {
      await quotesApi.createQuote(userId, fields, 0);
    }
    await afterQuoteMutation();
    closeQuoteModal();
  } catch (err) {
    showError(err);
  }
}

function handleQuoteDelete() {
  if (!editingQuoteId) return;
  const id = editingQuoteId;
  showConfirmToast('Delete this quote?', async () => {
    try {
      await deleteQuoteWithUndo(id);
      await afterQuoteMutation();
      closeQuoteModal();
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- routing ----------

function updateTabActive(tab) {
  el.tabLinks.forEach((link) => link.classList.toggle('active', link.dataset.tab === tab));
}

function renderRoute() {
  const segments = hashSegments(); // ['library', ...]
  if (segments[0] !== 'library') {
    detailReturn = '#/library';
    return;
  }
  const sub = segments[1];
  const id = segments[2];

  el.booksPanel.hidden = !!sub;
  el.wantPanel.hidden = sub !== 'want';
  el.bookDetailPanel.hidden = !(sub === 'books' && id);
  el.quotesPanel.hidden = sub !== 'quotes';
  el.statsPanel.hidden = sub !== 'stats';

  updateTabActive(['want', 'quotes', 'stats'].includes(sub) ? sub : 'books');
  if (sub === 'stats') renderStats();
  if (sub === 'want') renderWantList();

  if (sub === 'books' && id) {
    el.backLink.href = detailReturn;
    el.backLink.textContent = detailReturn === '#/library/want' ? '← Back to Want to Read' : '← Back to Library';
    openBookDetail(id);
  } else {
    currentBookId = null;
    detailReturn = sub === 'want' ? '#/library/want' : '#/library';
    if (!sub) renderBooksList();
  }
  if (sub === 'quotes') {
    quotesApi
      .listQuotes()
      .then((rows) => {
        allQuotes = rows;
        renderQuotesList();
      })
      .catch(showError);
  }
}

// ---------- init ----------

export async function initLibrary(uid) {
  userId = uid;
  cacheElements();

  el.newBookBtn.addEventListener('click', handleNewBook);
  el.saveBookBtn.addEventListener('click', handleSaveBook);
  el.startBookBtn.addEventListener('click', () => {
    if (currentBookId) startReading(currentBookId, editorFields()).catch(showError);
  });
  el.deleteBookBtn.addEventListener('click', handleDeleteBook);
  el.lookupBtn.addEventListener('click', () => handleLookup());
  el.wantAddForm.addEventListener('submit', handleWantAdd);
  el.wantFilter.addEventListener('input', () => {
    wantFilter = el.wantFilter.value;
    renderWantList();
  });
  el.wantFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.wantFilter.value) {
      e.stopPropagation();
      el.wantFilter.value = wantFilter = '';
      renderWantList();
    }
  });
  wireWantDrag();
  el.coverUrl.addEventListener('input', () => {
    el.cover.src = el.coverUrl.value.trim();
  });

  el.favoritesFilter.addEventListener('change', () => {
    favoritesOnly = el.favoritesFilter.checked;
    renderQuotesList();
  });

  el.addHighlightBtn.addEventListener('click', () => {
    openQuoteModal({ context: 'book', bookId: currentBookId });
  });
  el.newQuoteBtn.addEventListener('click', () => {
    openQuoteModal({ context: 'standalone' });
  });

  el.quoteForm.addEventListener('submit', handleQuoteSubmit);
  el.quoteDeleteBtn.addEventListener('click', handleQuoteDelete);
  el.quoteModalClose.addEventListener('click', closeQuoteModal);
  el.quoteCancelBtn.addEventListener('click', closeQuoteModal);
  el.quoteSheetCancel.addEventListener('click', closeQuoteModal);
  el.quoteText.addEventListener('input', syncQuoteCheckBtn);
  el.quoteCheckBtn.addEventListener('click', openQuoteCheck);
  el.quotePageText.addEventListener('input', renderQuoteCheck);
  el.quoteCheckAll.addEventListener('click', useAllPageText);
  el.quoteCheckDone.addEventListener('click', () => {
    closeQuoteCheck();
    el.quoteCheckBtn.focus({ preventScroll: true });
  });
  window.visualViewport?.addEventListener('resize', fitQuoteSheet);
  window.visualViewport?.addEventListener('scroll', fitQuoteSheet);
  el.quoteModal.addEventListener('focusin', fitQuoteSheet);
  el.quoteModal.addEventListener('focusout', () => requestAnimationFrame(fitQuoteSheet));
  el.quoteModalOverlay.addEventListener('click', (e) => {
    if (e.target === el.quoteModalOverlay) closeQuoteModal();
  });

  window.addEventListener('hashchange', renderRoute);

  await refreshLibrary();
  renderRoute();
}

export async function refreshLibrary() {
  try {
    books = await booksApi.listBooks();
  } catch (err) {
    showError(err);
    return;
  }
  renderBookLists();
  const segments = hashSegments();
  if (segments[0] !== 'library') return;
  if (segments[1] === 'stats') renderStats();
  if (segments[1] === 'books' && segments[2]) openBookDetail(segments[2]);
  if (segments[1] === 'quotes') {
    allQuotes = await quotesApi.listQuotes();
    renderQuotesList();
  }
}
