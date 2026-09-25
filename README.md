# Life Tracker

A personal life tracker — tasks, routines, projects, and a book/quote library — a plain HTML/CSS/JS web app (no build step, no framework) that syncs your data across devices via [Supabase](https://supabase.com).

Live at <https://life-tracker-hq.vercel.app>.

## Features

- **Today**: your top 3 starred tasks, today's routines, and a quote widget, all on one dashboard.
- **Board**: three columns (To Do, In Progress, Done) with drag-and-drop on desktop; on mobile the same tasks render as a single stacked, scrollable list (touch devices can't drag-and-drop), and every task has a Status dropdown as a non-drag way to move it between columns. Categories with colors, due dates with overdue/soon-due highlighting, priority levels, notes, search, and filtering.
- **Routines**: daily habits grouped into Morning / Afternoon / Evening checklists, with streak tracking and drag-to-reorder.
- **Projects**: a list of projects with status and target dates, each with its own notes and a checklist of sub-tasks.
- **Lists**: groceries, a wish list, packing… Checkable items with an optional link and price (the list totals what's left to buy); checked items collect in a collapsed group with a one-tap "Clear checked". Quick add `+groceries oat milk` adds straight to a list. Needs [`supabase/schema_004.sql`](supabase/schema_004.sql).
- **Library**: track books you're reading (status, format, dates, rating, cover image, notes) and collect highlights/quotes from them, plus standalone quotes — with a favorites filter. Quick add `book: Piranesi by Susanna Clarke` (or `b: dune`, or an ISBN) puts a book on Want to Read straight away and fills in the author and cover from Open Library when there's one clear match. The **Want to Read** tab is a compact, ordered reading queue: one line per book ("Up next" is the first three), reorder by drag or the ↑/↓ buttons, filter, a rapid add box, and a "?" on books still missing an author or cover that runs the Open Library lookup. "Start" (there, or in the book editor) moves a book to Reading, started today, with Undo.
- **Global search**: press `Cmd`/`Ctrl`+`K` or tap the floating search button to jump straight to any task, project, book, quote, or routine.
- **Voice-to-text**: a dictation button (Web Speech API) on notes and quote fields, handy on mobile.
- **Toast notifications**: success/error/info toasts for background actions, plus a non-blocking confirmation toast (instead of the browser's native popup) before anything is deleted.
- Light/dark mode toggle, styled in a warm cream-and-terracotta palette (dark mode: warm charcoal).
- Sign in with a one-time email code (no password). Your data lives in Supabase and follows you between your computer and phone.
- Mobile-aware layout: safe-area padding for notches/home indicators, a compact bottom nav bar, and a board list view (see above).

## One-time setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. In the SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql), then [`supabase/schema_002.sql`](supabase/schema_002.sql). Together they create the `categories`, `tasks`, `routines`, `routine_completions`, `projects`, `project_tasks`, `books`, and `quotes` tables, all with Row Level Security so each signed-in user only ever sees their own rows.
   - `supabase/import_electron_data.sql` is a one-off migration script for importing data from the original Electron/localStorage version of this app — most people can ignore it.
3. In Settings → API, copy your **Project URL** and **anon public key**.
4. Paste them into `js/supabaseClient.js` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`). The anon key is meant to be public — RLS is what actually protects the data, not the key.
5. Email auth (with OTP codes) is on by default — nothing else to configure.

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
| `js/supabaseClient.js` | Supabase client init — put your project URL/anon key here |
| `js/auth.js` | Email OTP sign-in/out |
| `js/theme.js` | Light/dark theme toggle |
| `js/migrate.js` | One-time import of old localStorage data into Supabase |
| `js/hash.js` | Small helper for parsing the `#/a/b/c` hash route into segments |
| `js/taskDisplay.js` | Shared pure display helpers (category lookup, due-date status) used by both Board and Today |
| `js/toast.js` | Toast notifications (success/error/info) and the non-blocking delete-confirmation toast |
| `js/search.js` | Global search modal: builds a search index, renders grouped results, keyboard navigation; also the command palette and a list picker (`openPicker`) |
| `js/voiceInput.js` | Wires mic buttons to the Web Speech API for dictating into notes/quote fields |
| `js/data/*.js` | CRUD calls to Supabase for tasks, categories, routines, completions, projects, project tasks, books, quotes, and the global search index |
| `js/views/today.js` | Today dashboard: starred tasks, routines widget, quote widget |
| `js/views/board.js` | Board rendering (desktop columns / mobile list), task and category modals, drag-and-drop |
| `js/views/routines.js` | Routines checklist rendering, streaks, drag-and-drop |
| `js/views/projects.js` | Projects list and detail panel, checklist items |
| `js/views/lists.js` | Lists: the lists and the open list side by side (one at a time on phones), items, Clear checked |
| `js/views/library.js` | Books list/detail, highlights, and the standalone quotes tab |
| `supabase/schema.sql`, `supabase/schema_002.sql` | Database schema + Row Level Security policies |
| `supabase/import_electron_data.sql` | Optional one-off migration from the original Electron app's local data |
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

Color themes (Hearth — the original Life Tracker palette — Heather, Lakeglow, Beacon) are shared with the
Magnus terminal app. `themes.css` and `js/palettes.js` are **generated** in
the Magnus repo (`npm run themes:web`); don't edit them by hand.
`js/theme-boot.js` applies the saved theme and light/dark mode (Auto follows
the system setting) before first paint.
It also swaps the app icon to match the theme. `icons/` (one set per theme)
and `build/icon*` are drawn by `scripts/generate-icon.py` from `themes.css`,
which the Magnus `npm run themes:web` runs automatically. The browser-tab
icon updates live. iOS only reads the home-screen icon when you "Add to Home
Screen", so re-add the app to pick up a new theme's icon there. The picker and toggle live in the
sidebar footer.
