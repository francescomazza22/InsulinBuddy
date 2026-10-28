-- Two-step sign-in (TOTP) enforced by the database, not only by the app (2.70.0).
--
-- Once the account has a VERIFIED authenticator factor, every table the app reads or writes is visible only to a session that
-- passed the code check (JWT claim aal = 'aal2'). A stolen password alone then gives a session that sees nothing.
-- With no verified factor the rule allows everything, so it changes nothing until two-step sign-in is turned on.
--
-- The rule is a RESTRICTIVE policy: it is ANDed with the existing "own rows" policies, never replaces them.
-- Edge Functions using the service role (health-webhook, health-export) bypass RLS and are unaffected.
-- The check lives in a security-definer function in a schema the API doesn't expose, because the app's role can't read
-- auth.mfa_factors directly. Wrapped in (select ...) in the policies so Postgres evaluates it once per query, not per row.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;
revoke all on function private.mfa_satisfied() from public;
grant execute on function private.mfa_satisfied() to authenticated;

drop policy if exists "Two-step sign-in when enabled" on public.app_state;
create policy "Two-step sign-in when enabled" on public.app_state
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

drop policy if exists "Two-step sign-in when enabled" on public.glucose_readings;
create policy "Two-step sign-in when enabled" on public.glucose_readings
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));

drop policy if exists "Two-step sign-in when enabled" on public.health_inbox;
create policy "Two-step sign-in when enabled" on public.health_inbox
  as restrictive for all to authenticated
  using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));
