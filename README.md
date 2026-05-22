# Time Tracker

Tiny Start/Stop time tracker. Static HTML + Supabase (Postgres + Auth) + Google sign-in. Hosted on GitHub Pages.

## One-time setup

### 1. Supabase project

1. Create a free project at https://supabase.com.
2. SQL Editor → paste & run `schema.sql`.
3. Settings → API → copy **Project URL** and **anon public key**.

### 2. Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized redirect URI: the value Supabase shows in Auth → Providers → Google (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
3. In Supabase: Auth → Providers → Google → paste Client ID + Secret, enable.

### 3. Fill in `app.js`

Replace `PUT_YOUR_SUPABASE_URL_HERE` and `PUT_YOUR_SUPABASE_ANON_KEY_HERE` with the values from step 1.

### 4. GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/timetracker.git
git push -u origin main
```

GitHub → repo Settings → Pages → Source = `main` / `/ (root)`. Your URL will be `https://<you>.github.io/timetracker/`.

### 5. Wire the Pages URL back into Supabase

Supabase → Auth → URL Configuration:

- **Site URL:** `https://<you>.github.io/timetracker/`
- **Redirect URLs:** same value (add `http://localhost:5500/` and similar if you test locally).

Without this, the Google OAuth callback will land on a 404.

## How to query hours

In the Supabase SQL editor:

```sql
select * from get_team_hours(
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '1 week'
);
```

Only **closed** sessions count — an open session (Start with no Stop) is excluded so a forgotten Start doesn't pollute totals.

## Edge cases the design handles

- Double-clicking Start, or clicking Start in two tabs → blocked by the `one_open_session_per_user` partial unique index. The UI treats the 23505 error as "already running" and re-syncs.
- Double-clicking Stop → the update is scoped to `ended_at is null`, so the second click is a 0-row no-op.
- Forgotten Start → the UI shows a "Running for Xh — did you forget to stop?" warning after 12h. The session is excluded from `get_team_hours` until it's closed.
- Sign-out in another tab → `onAuthStateChange` re-renders this tab automatically.
- One user trying to read or modify another user's rows → blocked by Row Level Security at the database, not just the client.
