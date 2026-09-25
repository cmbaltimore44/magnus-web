-- Run this once in the Supabase SQL Editor, after schema_004.sql.
-- Adds: a label on focus sessions, for focus time that isn't a task
-- ("job apps", "Essay: On Attention"). A session has a task, a label, or
-- neither. Purely additive: older versions of the web app and Magnus keep
-- working (they just don't send or show a label).

alter table focus_sessions
  add column label text check (label is null or char_length(label) between 1 and 120);
