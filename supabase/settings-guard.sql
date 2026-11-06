-- Settings guard and settings history (2.88.0). Applied 6 Nov 2026 as migration `settings_guard_and_history` (live).
--
-- Why: on 6 Nov 2026 a device signing in for the first time uploaded factory settings over the account's real ones
-- (ratios, target, max dose, usual basal, Nightscout link). 2.87.0 fixed the app, but an older cached copy of the app on
-- any device could still do it. These triggers protect the cloud copy whatever app version writes to it:
--
-- 1. private.guard_settings (BEFORE UPDATE): if a write replaces non-factory dosing settings with the app's FACTORY
--    dosing settings (Morning 10 / Lunch 8 / Evening 15 / Night 12, target 100, max dose 15, correction factor 50), the
--    row's settings are kept as they were and re-stamped (settingsUpdatedAt = now), so the device that sent them takes the
--    real settings back on its next sync. Everything else in the write (meals, library...) goes through. Logged in
--    private.settings_guard_log.
-- 2. private.keep_settings_history (AFTER UPDATE): every time the settings change, the previous settings are kept in
--    private.settings_history (latest 300 per user), so any change can be undone.
--
-- Encrypted rows (data is a ciphertext, no `settings` object) are left alone. The schema `private` is not exposed by the
-- API and its tables have no grants for anon/authenticated; the functions are security definer with an empty search_path.

create schema if not exists private;

create table if not exists private.settings_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  saved_at timestamptz not null default now(),
  settings_updated_at bigint,
  settings jsonb not null
);
create index if not exists settings_history_user_saved on private.settings_history (user_id, saved_at desc);

create table if not exists private.settings_guard_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  blocked_at timestamptz not null default now(),
  sent_settings_updated_at bigint,
  sent_settings jsonb
);

revoke all on private.settings_history, private.settings_guard_log from public, anon, authenticated;

-- True when `s` carries the app's factory dosing settings.
create or replace function private.is_factory_dosing(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    (s->>'target')::numeric = 100 and (s->>'maxDose')::numeric = 15 and (s->>'isf')::numeric = 50
    and jsonb_typeof(s->'timeRatios') = 'array'
    and (select coalesce(jsonb_object_agg(r->>'id', (r->>'ratio')::numeric), '{}'::jsonb) from jsonb_array_elements(s->'timeRatios') r)
        = '{"tr-morning": 10, "tr-lunch": 8, "tr-evening": 15, "tr-night": 12}'::jsonb,
    false)
$$;

-- The dosing part of the settings, for comparing two versions.
create or replace function private.dosing_part(s jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('target', s->'target', 'maxDose', s->'maxDose', 'isf', s->'isf', 'timeRatios',
    (select coalesce(jsonb_object_agg(r->>'id', r->'ratio'), '{}'::jsonb) from jsonb_array_elements(case when jsonb_typeof(s->'timeRatios') = 'array' then s->'timeRatios' else '[]'::jsonb end) r))
$$;

create or replace function private.guard_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object'
     and jsonb_typeof(old.data->'settings') = 'object' and jsonb_typeof(new.data->'settings') = 'object'
     and private.is_factory_dosing(new.data->'settings')
     and not private.is_factory_dosing(old.data->'settings')
     and private.dosing_part(new.data->'settings') is distinct from private.dosing_part(old.data->'settings') then
    insert into private.settings_guard_log (user_id, sent_settings_updated_at, sent_settings)
      values (new.user_id, nullif(new.data->>'settingsUpdatedAt', '')::bigint, new.data->'settings');
    new.data := jsonb_set(jsonb_set(new.data, '{settings}', old.data->'settings'),
                          '{settingsUpdatedAt}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint));
  end if;
  return new;
end $$;

create or replace function private.keep_settings_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(old.data) = 'object' and jsonb_typeof(old.data->'settings') = 'object'
     and (jsonb_typeof(new.data) <> 'object' or (old.data->'settings') is distinct from (new.data->'settings')) then
    insert into private.settings_history (user_id, settings_updated_at, settings)
      values (old.user_id, nullif(old.data->>'settingsUpdatedAt', '')::bigint, old.data->'settings');
    delete from private.settings_history h
      where h.user_id = old.user_id
        and h.id not in (select id from private.settings_history where user_id = old.user_id order by saved_at desc, id desc limit 300);
  end if;
  return new;
end $$;

revoke all on function private.guard_settings(), private.keep_settings_history(), private.is_factory_dosing(jsonb), private.dosing_part(jsonb) from public, anon, authenticated;

create trigger a_guard_settings before update on public.app_state
  for each row execute function private.guard_settings();

create trigger z_keep_settings_history after update on public.app_state
  for each row execute function private.keep_settings_history();
