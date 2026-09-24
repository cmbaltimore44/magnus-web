import { getSession, requestCode, verifyCode, signOut, currentUserId } from './auth.js';
import { initTheme } from './theme.js';
import { maybeImportLocalData } from './migrate.js';
import { initToday, refreshToday } from './views/today.js';
import { initBoard, refreshBoard } from './views/board.js';
import { initRoutines, refreshRoutines } from './views/routines.js';
import { initProjects, refreshProjects } from './views/projects.js';
import { initLibrary, refreshLibrary } from './views/library.js';
import { initSearch } from './search.js';
import { initVoiceInput } from './voiceInput.js';
import { initQuickAdd } from './quickAddBar.js';
import { onDataChanged } from './events.js';

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');

const emailStep = document.getElementById('auth-step-email');
const codeStep = document.getElementById('auth-step-code');
const emailForm = document.getElementById('auth-email-form');
const codeForm = document.getElementById('auth-code-form');
const emailInput = document.getElementById('auth-email');
const codeInput = document.getElementById('auth-code');
const emailError = document.getElementById('auth-email-error');
const codeError = document.getElementById('auth-code-error');
const codeSubtitle = document.getElementById('auth-code-subtitle');
const backBtn = document.getElementById('auth-back-btn');

let pendingEmail = '';

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  emailError.textContent = '';
  const email = emailInput.value.trim();
  try {
    await requestCode(email);
    pendingEmail = email;
    codeSubtitle.textContent = `Check ${email} for the code.`;
    emailStep.hidden = true;
    codeStep.hidden = false;
    codeInput.focus();
  } catch (err) {
    emailError.textContent = err.message;
  }
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  codeError.textContent = '';
  const code = codeInput.value.trim();
  try {
    const session = await verifyCode(pendingEmail, code);
    await enterApp(session);
  } catch (err) {
    codeError.textContent = err.message;
  }
});

backBtn.addEventListener('click', () => {
  codeStep.hidden = true;
  emailStep.hidden = false;
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await signOut();
  location.reload();
});

// ---------- routing ----------

const VIEW_IDS = ['today', 'board', 'routines', 'projects', 'library'];

const REFRESH = {
  today: refreshToday,
  board: refreshBoard,
  routines: refreshRoutines,
  projects: refreshProjects,
  library: refreshLibrary,
};

function currentView() {
  const top = location.hash.replace(/^#\//, '').split('/')[0];
  return VIEW_IDS.includes(top) ? top : 'today';
}

function setActiveView(view) {
  VIEW_IDS.forEach((v) => {
    document.getElementById('view-' + v).hidden = v !== view;
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

function initRouter() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = '#/' + btn.dataset.view;
    });
  });
  window.addEventListener('hashchange', () => {
    setActiveView(currentView());
    REFRESH[currentView()]?.();
  });
  if (!location.hash) location.hash = '#/today';
  setActiveView(currentView());
}

// ---------- cross-device sync (refetch on focus, not realtime) ----------

function wireRefreshOnFocus() {
  const refresh = () => REFRESH[currentView()]?.();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('focus', refresh);
}

// Writes made from outside the current view (quick add, undo, …) refresh it.
function wireDataChanged() {
  onDataChanged((source) => {
    const view = currentView();
    if (source !== view) REFRESH[view]?.();
  });
}

// ---------- boot ----------

async function enterApp(session) {
  const uid = currentUserId(session);
  authScreen.hidden = true;
  appShell.hidden = false;

  initTheme(document.getElementById('theme-toggle-btn'), document.getElementById('palette-select'));
  initRouter();

  try {
    await maybeImportLocalData(uid);
  } catch (err) {
    console.error('Local data import failed', err);
  }

  await Promise.all([
    initToday(uid),
    initBoard(uid),
    initRoutines(uid),
    initProjects(uid),
    initLibrary(uid),
  ]);
  initSearch();
  initVoiceInput();
  initQuickAdd(uid);
  wireRefreshOnFocus();
  wireDataChanged();
}

(async function boot() {
  const session = await getSession();
  if (session) await enterApp(session);
})();
