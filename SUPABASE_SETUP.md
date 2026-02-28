# Supabase + Vercel Setup

## 1) Create table and policies
1. Open your Supabase project.
2. Go to SQL Editor.
3. Run `supabase/schema.sql`.

## 2) Enable email magic link auth
1. In Supabase, go to Authentication -> Providers -> Email.
2. Enable Email provider and magic link flow.
3. Add redirect URLs:
   - `http://localhost:5173`
   - `https://calm-habit-tracker.vercel.app`

## 3) Configure environment variables
Set in local `.env.local`:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Set the same in Vercel project settings (Production, Preview, Development).

## 4) Deploy
1. Push to GitHub.
2. Vercel deploys automatically.
3. Open app, press `Sign in`, and complete magic-link login.
