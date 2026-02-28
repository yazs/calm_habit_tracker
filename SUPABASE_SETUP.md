# Supabase + Vercel Setup (No Login)

## 1) Create table and policies
1. Open your Supabase project.
2. Go to SQL Editor.
3. Run `supabase/schema.sql`.

This creates `public_snapshots` with public `anon` read/write access.

## 2) Configure environment variables
Set in local `.env.local`:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
VITE_PUBLIC_SYNC_ID=calm-habit-tracker-public
```

`VITE_PUBLIC_SYNC_ID` is optional but recommended. Use the same value in every environment.

Set the same vars in Vercel project settings (Production, Preview, Development).

## 3) Deploy
1. Push to GitHub.
2. Vercel deploys automatically.
3. Open the public link. No login is required.
