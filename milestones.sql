-- Migration: admin-managed key dates + countdown.
-- Safe to paste into the Supabase SQL editor on an EXISTING project
-- (re-runnable: drops policies before recreating them).
-- Requires public.is_admin() from schema.sql to already exist.

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  target_date date not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists milestones_target_date_idx
  on public.milestones (target_date);

alter table public.milestones enable row level security;

-- Anyone signed in can read the dates (team-wide countdown).
drop policy if exists "authenticated read milestones" on public.milestones;
create policy "authenticated read milestones"
  on public.milestones for select
  to authenticated
  using (true);

-- Only admins can add / change / remove dates.
drop policy if exists "admins insert milestones" on public.milestones;
create policy "admins insert milestones"
  on public.milestones for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update milestones" on public.milestones;
create policy "admins update milestones"
  on public.milestones for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete milestones" on public.milestones;
create policy "admins delete milestones"
  on public.milestones for delete
  to authenticated
  using (public.is_admin());
