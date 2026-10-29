-- Run once, after schema_007.sql (Magnus runs it with `supabase db query`).
-- Adds repeating tasks: tasks.repeat holds a rule, and when a repeating task
-- moves to Done the database inserts the next one, so both apps (and the
-- phone) get it without any client logic. The next due date always counts
-- from the old due date, so a schedule never drifts. Additive only: older
-- versions of both apps keep working (they just don't show or set repeats).
--
-- Rules (written by quick add's ~tokens; js/repeat.js and Magnus's
-- src/lib/repeat.js mirror next_due):
--   daily · weekdays · weekly:mon,thu · monthly:15 · monthly:last
--   yearly:10-29 · every:3d · every:2w · every:6m

alter table tasks add column repeat text check (
  repeat ~ '^(daily|weekdays|weekly:(sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat))*|monthly:([1-9]|[12][0-9]|3[01]|last)|yearly:(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|every:[1-9][0-9]{0,2}[dwm])$'
);

-- The next due date strictly after p_from. Preview it in the SQL editor:
--   select public.next_due('monthly:last', '2026-01-31');  -- 2026-02-28
create or replace function public.next_due(p_rule text, p_from date)
returns date
language plpgsql immutable set search_path = ''
as $$
declare
  kind text := split_part(p_rule, ':', 1);
  arg text := nullif(split_part(p_rule, ':', 2), '');
  d date;
  wanted int[];
  month_start date;
  last_day date;
  n int;
  i int;
begin
  if kind = 'daily' then
    return p_from + 1;
  elsif kind = 'weekdays' then
    d := p_from + 1;
    while extract(isodow from d) > 5 loop d := d + 1; end loop;
    return d;
  elsif kind = 'weekly' then
    wanted := array(select array_position(array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], x) - 1
                      from unnest(string_to_array(arg, ',')) x);
    for i in 1..7 loop
      if extract(dow from p_from + i)::int = any(wanted) then return p_from + i; end if;
    end loop;
  elsif kind = 'monthly' then
    for i in 0..2 loop
      month_start := (date_trunc('month', p_from) + make_interval(months => i))::date;
      last_day := (month_start + interval '1 month' - interval '1 day')::date;
      d := case when arg = 'last' then last_day else least(month_start + (arg::int - 1), last_day) end;
      if d > p_from then return d; end if;
    end loop;
  elsif kind = 'yearly' then
    for i in 0..1 loop
      month_start := make_date(extract(year from p_from)::int + i, split_part(arg, '-', 1)::int, 1);
      last_day := (month_start + interval '1 month' - interval '1 day')::date;
      d := least(month_start + (split_part(arg, '-', 2)::int - 1), last_day);
      if d > p_from then return d; end if;
    end loop;
  elsif kind = 'every' then
    n := substring(arg from '^[0-9]+')::int;
    case right(arg, 1)
      when 'd' then return p_from + n;
      when 'w' then return p_from + 7 * n;
      when 'm' then return (p_from + make_interval(months => n))::date; -- same day, clamped to the month's end
    end case;
  end if;
  return null;
end;
$$;

-- When a repeating task moves to Done: insert the next one (not starred, To
-- Do, same title/notes/category/priority/rule) and take the rule off the
-- finished one, so toggling Done again can't make a second copy. A task
-- without a due date counts from today (in the notification time zone when
-- schema_007's settings exist).
create or replace function public.spawn_next_repeat()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base date := new.due_date;
  tz text;
begin
  if base is null then
    select timezone into tz from public.assistant_settings where user_id = new.user_id;
    base := (now() at time zone coalesce(tz, 'UTC'))::date;
  end if;
  insert into public.tasks (user_id, category_id, title, notes, status, due_date, priority, sort_order, is_starred, repeat)
  values (new.user_id, new.category_id, new.title, new.notes, 'todo', public.next_due(new.repeat, base),
          new.priority, new.sort_order, false, new.repeat);
  new.repeat := null;
  return new;
end;
$$;

create trigger tasks_repeat
  before update of status on tasks
  for each row
  when (new.status = 'done' and old.status is distinct from 'done' and new.repeat is not null)
  execute function public.spawn_next_repeat();

revoke execute on function public.spawn_next_repeat() from public, anon, authenticated;
