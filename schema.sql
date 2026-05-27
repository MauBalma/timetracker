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
