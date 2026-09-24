-- Run this once in the Supabase SQL Editor, after schema_002.sql.
-- Adds: task completion times, focus sessions, the daily Log, and Realtime.
-- Everything here is additive: older versions of the web app and Magnus keep
-- working before and after it runs.

-- 1. tasks.completed_at — set by the database whenever a task moves to Done
--    (and cleared when it leaves Done), so neither app has to remember to.
--    Used by Insights and the weekly review. Tasks already done keep null
--    (their real completion time is unknown).
alter table tasks add column completed_at timestamptz;
create index on tasks (user_id, completed_at);

create or replace function set_task_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_completed_at
  before insert or update of status on tasks
  for each row execute function set_task_completed_at();

-- 2. focus_sessions — one row per focus-timer run.
create table focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  task_id uuid references tasks(id) on delete set null,
  started_at timestamptz not null,
  minutes integer not null check (minutes > 0),
  created_at timestamptz not null default now()
);
create index on focus_sessions (user_id, started_at);
create index on focus_sessions (task_id);

-- 3. log_entries — the daily Log (sleep hours, weight, workouts, mood 1-5,
--    energy 1-5). mood/energy/sleep/weight are one per day (the apps update
--    the existing row); workouts can repeat (value = minutes, note = type).
create table log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  entry_date date not null,
  metric text not null check (metric in ('sleep', 'weight', 'workout', 'mood', 'energy')),
  value numeric not null,
  note text,
  created_at timestamptz not null default now(),
  check (metric not in ('mood', 'energy') or value between 1 and 5)
);
create index on log_entries (user_id, entry_date);

alter table focus_sessions enable row level security;
alter table log_entries enable row level security;

create policy "owner full access" on focus_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owner full access" on log_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Realtime — lets both apps update live when the other one changes data.
--    Row-level security still applies to what each client receives.
alter publication supabase_realtime add table
  categories, tasks, routines, routine_completions,
  projects, project_tasks, books, quotes,
  focus_sessions, log_entries;
