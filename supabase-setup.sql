-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query).
-- It creates one table that stores each signed-in user's entire app data as a
-- single JSON blob, and locks it down so a user can only ever read or write
-- their own row. This is intentionally simple: no separate tables per food/
-- recipe/history-entry, no migrations to manage — just one row per account.

create table if not exists app_state (
  user_id uuid references auth.users on delete cascade not null primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

create policy "Users can read their own data"
  on app_state for select
  using (auth.uid() = user_id);

create policy "Users can insert their own data"
  on app_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own data"
  on app_state for update
  using (auth.uid() = user_id);

create policy "Users can delete their own data"
  on app_state for delete
  using (auth.uid() = user_id);
