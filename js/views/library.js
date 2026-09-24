import * as booksApi from '../data/books.js';
import * as quotesApi from '../data/quotes.js';
import { hashSegments } from '../hash.js';
import { showError, showConfirmToast } from '../toast.js';
import { stopVoiceInput } from '../voiceInput.js';
import { deleteWithUndo } from '../undo.js';

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

const el = {};

function cacheElements() {
  Object.assign(el, {
    booksPanel: document.getElementById('library-books-panel'),
    bookDetailPanel: document.getElementById('library-book-detail-panel'),
    quotesPanel: document.getElementById('library-quotes-panel'),

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
    saveBookBtn: document.getElementById('save-book-btn'),
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

async function handleNewBook() {
  try {
    const created = await booksApi.createBook(userId, { title: 'Untitled Book', status: 'want_to_read' }, books.length);
    books.unshift(created);
    location.hash = '#/library/books/' + created.id;
  } catch (err) {
    showError(err);
  }
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
  el.status.value = book.status;
  el.format.value = book.format;
  el.started.value = book.started_date || '';
  el.finished.value = book.finished_date || '';
  el.rating.value = book.rating != null ? String(book.rating) : '';
  el.isbn.value = book.isbn || '';
  el.notes.value = book.notes || '';
  renderHighlights();
}

async function handleSaveBook() {
  const ratingValue = el.rating.value ? Number(el.rating.value) : null;
  const fields = {
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
  try {
    const updated = await booksApi.updateBook(currentBookId, fields);
    const index = books.findIndex((b) => b.id === currentBookId);
    if (index >= 0) books[index] = updated;
    renderBooksList();
    location.hash = '#/library';
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
      location.hash = '#/library';
    } catch (err) {
      showError(err);
    }
  });
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
  el.quoteModalOverlay.classList.add('open');
  el.quoteText.focus();
}

function closeQuoteModal() {
  el.quoteModalOverlay.classList.remove('open');
  editingQuoteId = null;
  stopVoiceInput();
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
  if (segments[0] !== 'library') return;
  const sub = segments[1];
  const id = segments[2];

  el.booksPanel.hidden = !!sub;
  el.bookDetailPanel.hidden = !(sub === 'books' && id);
  el.quotesPanel.hidden = sub !== 'quotes';

  updateTabActive(sub === 'quotes' ? 'quotes' : 'books');

  if (sub === 'books' && id) {
    openBookDetail(id);
  } else {
    currentBookId = null;
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
  el.deleteBookBtn.addEventListener('click', handleDeleteBook);
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
  renderBooksList();
  const segments = hashSegments();
  if (segments[0] !== 'library') return;
  if (segments[1] === 'books' && segments[2]) openBookDetail(segments[2]);
  if (segments[1] === 'quotes') {
    allQuotes = await quotesApi.listQuotes();
    renderQuotesList();
  }
}
