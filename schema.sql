-- Time Tracker schema. Run once in the Supabase SQL editor.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint ended_after_started check (ended_at is null or ended_at >= started_at)
);

create index sessions_user_started_idx
  on public.sessions (user_id, started_at desc);

-- A user can never have two open sessions at once.
create unique index one_open_session_per_user
  on public.sessions (user_id)
  where ended_at is null;

alter table public.sessions enable row level security;

create policy "read own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

create policy "delete own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- Admin allowlist. Anyone in this table can read every user's sessions.
-- To bootstrap your first admin, find your user id in Supabase
-- → Authentication → Users, then:
--   insert into public.admins (user_id) values ('<your-uuid>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.admins enable row level security;

-- Admins can see who else is an admin; non-admins see nothing.
create policy "admins read admins"
  on public.admins for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

grant execute on function public.is_admin() to authenticated;

-- Admins can read every user's sessions (in addition to the existing
-- "read own sessions" policy). Policies are OR-ed.
create policy "admins read all sessions"
  on public.sessions for select
  using (public.is_admin());

-- Admins-only directory of users (id + email). Returns empty for non-admins
-- so the client can call it unconditionally.
create or replace function public.list_users()
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_admin()
  order by u.email
$$;

grant execute on function public.list_users() to authenticated;

-- Team rollup. Only counts closed sessions so a forgotten Start
-- running for days doesn't pollute the totals.
create or replace function public.get_team_hours(start_date timestamptz, end_date timestamptz)
returns table (user_email text, total_hours numeric)
language sql
security definer
set search_path = public
as $$
  select u.email::text,
         round(extract(epoch from sum(s.ended_at - s.started_at)) / 3600, 2)
  from public.sessions s
  join auth.users u on u.id = s.user_id
  where s.ended_at is not null
    and s.started_at >= start_date
    and s.started_at <  end_date
  group by u.email
  order by 2 desc;
$$;
