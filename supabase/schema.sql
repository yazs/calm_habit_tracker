create table if not exists public.user_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

alter table public.user_snapshots enable row level security;

drop policy if exists "Users can select own snapshots" on public.user_snapshots;
create policy "Users can select own snapshots"
on public.user_snapshots
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own snapshots" on public.user_snapshots;
create policy "Users can insert own snapshots"
on public.user_snapshots
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own snapshots" on public.user_snapshots;
create policy "Users can update own snapshots"
on public.user_snapshots
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
