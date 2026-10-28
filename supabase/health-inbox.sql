-- Inbox for Apple Health deliveries from the "Health Webhook" iPhone app (function: health-webhook).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create table if not exists health_inbox (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  received_at timestamptz not null default now(),
  bytes integer,
  payload jsonb not null
);

create index if not exists health_inbox_user_time on health_inbox (user_id, received_at desc);

alter table health_inbox enable row level security;

-- The app (signed in as you) may read and tidy your own deliveries. Only the function
-- (service role, which bypasses these rules) can add them.
drop policy if exists "Users can read their own health inbox" on health_inbox;
create policy "Users can read their own health inbox"
  on health_inbox for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own health inbox" on health_inbox;
create policy "Users can delete their own health inbox"
  on health_inbox for delete using ((select auth.uid()) = user_id);
