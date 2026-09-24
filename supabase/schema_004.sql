-- Run this once in the Supabase SQL Editor, after schema_003.sql.
-- Adds: Lists (groceries, wish list, ...) with checkable items.
-- Purely additive: older versions of the web app and Magnus keep working.

create table lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index on lists (user_id, sort_order);

create table list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  list_id uuid not null references lists(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  url text,                          -- optional link (wish list)
  price numeric check (price is null or price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index on list_items (list_id, sort_order);
create index on list_items (user_id);

alter table lists enable row level security;
alter table list_items enable row level security;

create policy "owner full access" on lists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owner full access" on list_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates between devices.
alter publication supabase_realtime add table lists, list_items;
