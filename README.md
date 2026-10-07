# Magnus Web

The web and phone side of [Magnus](https://github.com/cmbaltimore44/magnus): a personal life tracker — tasks, routines, projects, lists, a daily log, and a book/quote library — as a plain HTML/CSS/JS web app (no build step, no framework) that syncs your data across devices via [Supabase](https://supabase.com).

It's a personal tool, published as-is: the author's own instance runs at
<https://magnus-web-hq.vercel.app> (sign-ups are closed). To use it yourself,
set up your own Supabase project and deploy your own copy, as described below.
Magnus, the terminal app, reads and writes the same data. (This app was
previously called Life Tracker.)

## Features

- **Today**: your top 3 starred tasks, today's routines, and a quote widget, all on one dashboard.
- **Board**: three columns (To Do, In Progress, Done) with drag-and-drop on desktop; on mobile the same tasks render as a single stacked, scrollable list (touch devices can't drag-and-drop), and every task has a Status dropdown as a non-drag way to move it between columns. Categories with colors, due dates with overdue/soon-due highlighting, priority levels, notes, search, and filtering.
- **Routines**: daily habits grouped into Morning / Afternoon / Evening checklists, with streak tracking and drag-to-reorder.
- **Projects**: a list of projects with status and target dates, each with its own notes and a checklist of sub-tasks.
- **Lists**: groceries, a wish list, packing… Checkable items with an optional link and price (the list totals what's left to buy); checked items collect in a collapsed group with a one-tap "Clear checked". Quick add `+groceries oat milk` adds straight to a list. Needs [`supabase/schema_004.sql`](supabase/schema_004.sql).
- **Library**: track books you're reading (status, format, dates, rating, cover image, notes) and collect highlights/quotes from them, plus standalone quotes — with a favorites filter. Quick add `book: Piranesi by Susanna Clarke` (or `b: dune`, or an ISBN) puts a book on Want to Read straight away and fills in the author and cover from Open Library when there's one clear match. The **Want to Read** tab is a compact, ordered reading queue: one line per book ("Up next" is the first three), reorder by drag or the ↑/↓ buttons, filter, a rapid add box, and a "?" on books still missing an author or cover that runs the Open Library lookup. "Start" (there, or in the book editor) moves a book to Reading, started today, with Undo.
- **Adding quotes on a phone**: the quote editor is a full-screen sheet (Cancel / Save at the top) with large text that stays above the keyboard. It suggests the 🎤 on the iOS keyboard for dictation instead of the app's own Dictate button. **Check against page** compares the quote with the printed page: tap the Page text box, choose Scan Text (or the keyboard's scan icon), point the camera at the passage and tap Insert. No photo is saved, and on a computer you can paste the text instead. The differences are highlighted in the quote; tap one to take the page's version, or **Use page text for all**. Quotes, dashes, line breaks and words hyphenated across lines don't count as differences; case and punctuation do. The page text is only used for the comparison and is never saved.
- **Global search**: press `Cmd`/`Ctrl`+`K` or tap the floating search button to jump straight to any task, project, book, quote, or routine.
- **Voice-to-text**: a dictation button (Web Speech API) on notes and quote fields (on phones the quote editor points to the keyboard's own dictation instead).
- **Toast notifications**: success/error/info toasts for background actions, plus a non-blocking confirmation toast (instead of the browser's native popup) before anything is deleted.
- Light/dark mode toggle, styled in a warm cream-and-terracotta palette (dark mode: warm charcoal).
- Sign in with a one-time email code (no password). Your data lives in Supabase and follows you between your computer and phone.
- Mobile-aware layout: safe-area padding for notches/home indicators, a compact bottom nav bar, and a board list view (see above).

## One-time setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. In the SQL Editor, run the files in [`supabase/`](supabase/) in order: `schema.sql`, then `schema_002.sql` through `schema_006.sql`. Together they create every table (tasks, categories, routines, projects, books, quotes, lists, the daily log, focus sessions, …), all with Row Level Security so each signed-in user only ever sees their own rows.
3. In Settings → API, copy your **Project URL** and **anon public key**.
4. Replace the values in `js/supabaseClient.js` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) with yours; the repo ships with the author's. The anon key is meant to be public — RLS is what actually protects the data, not the key. Never put the `service_role` key in this app.
5. Create your account under Authentication → Users → **Add user**. The app only signs existing users in with an emailed code and never creates accounts, so also turn off **Allow new users to sign up** (Authentication → Sign In / Providers) to keep strangers from registering against your project.

## Running locally

No install step — it's static files.

```bash
npm run dev
```

Opens the app via `npx serve .`. On first sign-in on a new device, enter your email, then the 6-digit code Supabase emails you.

## Deploying (Vercel)

This is a static site — no serverless functions needed, since the browser talks to Supabase directly.

```bash
npx vercel        # preview deploy
npx vercel --prod # production deploy
```

Visit the deployed URL from your phone's browser and sign in with the same email to see the same data. Consider using "Add to Home Screen" on your phone for an app-like icon (the `manifest.webmanifest` in this repo supports it).

## Project structure

| Path | Purpose |
|---|---|
| `index.html` | Sidebar shell, auth screen, all views (Today, Board, Routines, Projects, Library), global search overlay, and modals |
| `style.css` | Theme variables (light/dark), layout, component styling, and mobile-specific responsive rules |
| `js/app.js` | Entry point: auth gate, hash-based router, focus/visibility refresh, wires up search and voice input |
| `js/focus.js` | Pomodoro focus timer: the pill on every view, chime + notification when a phase ends, focus on a task or on anything typed (a label like "job apps"), switch mid-round, saves focus_sessions (labels need `supabase/schema_005.sql`) |
| `js/focusPicker.js` | What the focus timer's picker offers (starred tasks, recent labels, open tasks, the typed text); a port of Magnus's `src/lib/focusPicker.js` without the journal |
| `js/pomodoro.js` | Pure Pomodoro engine; a copy of Magnus's `src/lib/pomodoro.js` — keep the two identical |
| `js/phoneNav.js` | Phone-width navigation: bottom tab bar (4 sections, chosen in Settings) and the More sheet with live counts |
| `js/supabaseClient.js` | Supabase client init — replace the project URL/anon key with yours |
| `js/auth.js` | Email OTP sign-in/out (existing users only) |
| `js/theme.js` | Light/dark theme toggle |
| `js/migrate.js` | One-time import of old localStorage data into Supabase |
| `js/hash.js` | Small helper for parsing the `#/a/b/c` hash route into segments |
| `js/taskDisplay.js` | Shared pure display helpers (category lookup, due-date status) used by both Board and Today |
| `js/toast.js` | Toast notifications (success/error/info) and the non-blocking delete-confirmation toast |
| `js/search.js` | Global search modal: builds a search index, renders grouped results, keyboard navigation; also the command palette and a list picker (`openPicker`) |
| `js/voiceInput.js` | Wires mic buttons to the Web Speech API for dictating into notes/quote fields |
| `js/data/*.js` | CRUD calls to Supabase for tasks, categories, routines, completions, projects, project tasks, books, quotes, and the global search index |
| `js/data/paging.js` | `fetchAll`: reads a table page by page, since Supabase returns at most 1,000 rows per request (tasks, books, quotes, routine check-offs); a copy of Magnus's `src/lib/data/paging.js` |
| `js/views/today.js` | Today dashboard: starred tasks, routines widget, quote widget |
| `js/views/board.js` | Board rendering (desktop columns / mobile list), task and category modals, drag-and-drop |
| `js/views/routines.js` | Routines checklist rendering, streaks, drag-and-drop |
| `js/views/projects.js` | Projects list and detail panel, checklist items |
| `js/views/lists.js` | Lists: the lists and the open list side by side (one at a time on phones), items, Clear checked |
| `js/views/library.js` | Books list/detail, highlights, the standalone quotes tab, and the quote editor (phone sheet, Check against page) |
| `js/quoteCheck.js` | Check against page: compares a dictated quote with scanned page text word by word and applies the page's version (pure, no DOM) |
| `test/` | Unit tests for the pure modules (`npm test`, Node's built-in test runner; no install needed) |
| `supabase/schema*.sql` | Database schema + Row Level Security policies (run in order) |
| `scripts/generate-icon.py` | Regenerates `build/icon.png` / `build/icon.icns` from a Pillow-drawn design |
| `build/icon.icns`, `build/icon.png` | App icon, reused as the favicon / home-screen icon |

## Changing the app icon

`build/icon.png` and `build/icon.icns` are generated by `scripts/generate-icon.py`, a self-contained Python script (uses only [Pillow](https://pillow.readthedocs.io/) and NumPy — no Electron or browser needed). To tweak the design, edit the drawing code in that script (colors, gradient, or the shapes drawn), then regenerate:

```bash
pip install pillow numpy   # if not already installed
python3 scripts/generate-icon.py
```

This writes `build/icon-source.png` (1024×1024 master), `build/icon.png` (512×512, used as the favicon/manifest icon), and `build/icon.icns` (macOS multi-resolution icon, built via the system `iconutil` if available).

## Themes

Color themes (Hearth — this app's original palette — Heather, Lakeglow, Beacon) are shared with the
[Magnus](https://github.com/cmbaltimore44/magnus) terminal app. `themes.css` and `js/palettes.js` are **generated** in
the Magnus repo (`npm run themes:web`, with this repo checked out next to it); don't edit them by hand.
`js/theme-boot.js` applies the saved theme and light/dark mode (Auto follows
the system setting) before first paint.
It also swaps the app icon to match the theme. `icons/` (one set per theme)
and `build/icon*` are drawn by `scripts/generate-icon.py` from `themes.css`,
which the Magnus `npm run themes:web` runs automatically. The browser-tab
icon updates live. iOS only reads the home-screen icon when you "Add to Home
Screen", so re-add the app to pick up a new theme's icon there. The picker and toggle live in the
sidebar footer.

## License

[MIT](LICENSE).
