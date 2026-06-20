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

-- Audit log of UPDATEs and DELETEs on sessions. Append-only via trigger;
-- no client can insert/update/delete rows here.
create table if not exists public.sessions_history (
  id bigserial primary key,
  session_id uuid not null,
  user_id uuid not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  changed_at timestamptz not null default now(),
  changed_by uuid,
  old_started_at timestamptz,
  old_ended_at timestamptz,
  new_started_at timestamptz,
  new_ended_at timestamptz
);

create index if not exists sessions_history_session_idx
  on public.sessions_history (session_id, changed_at desc);
create index if not exists sessions_history_user_idx
  on public.sessions_history (user_id, changed_at desc);

alter table public.sessions_history enable row level security;

create policy "users read own session history"
  on public.sessions_history for select
  using (auth.uid() = user_id);

create policy "admins read all session history"
  on public.sessions_history for select
  using (public.is_admin());

-- Trigger function runs as SECURITY DEFINER (table owner), so it can
-- always write to sessions_history regardless of who triggered it.
create or replace function public.log_session_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE') then
    -- Skip if nothing relevant changed.
    if old.started_at is distinct from new.started_at
       or old.ended_at is distinct from new.ended_at then
      insert into public.sessions_history
        (session_id, user_id, operation, changed_by,
         old_started_at, old_ended_at, new_started_at, new_ended_at)
      values
        (old.id, old.user_id, 'UPDATE', auth.uid(),
         old.started_at, old.ended_at, new.started_at, new.ended_at);
    end if;
  elsif (tg_op = 'DELETE') then
    insert into public.sessions_history
      (session_id, user_id, operation, changed_by,
       old_started_at, old_ended_at, new_started_at, new_ended_at)
    values
      (old.id, old.user_id, 'DELETE', auth.uid(),
       old.started_at, old.ended_at, null, null);
  end if;
  return null;
end;
$$;

drop trigger if exists sessions_audit on public.sessions;
create trigger sessions_audit
  after update or delete on public.sessions
  for each row execute function public.log_session_change();

-- Key dates / milestones. Admins add target dates (deadlines, launches, etc.);
-- every signed-in user sees a countdown of how long until each one.
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
create policy "authenticated read milestones"
  on public.milestones for select
  to authenticated
  using (true);

-- Only admins can add / change / remove dates.
create policy "admins insert milestones"
  on public.milestones for insert
  to authenticated
  with check (public.is_admin());

create policy "admins update milestones"
  on public.milestones for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete milestones"
  on public.milestones for delete
  to authenticated
  using (public.is_admin());

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
