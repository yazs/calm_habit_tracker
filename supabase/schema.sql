create table if not exists public.public_snapshots (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

alter table public.public_snapshots enable row level security;

drop policy if exists "Public snapshots are readable" on public.public_snapshots;
create policy "Public snapshots are readable"
on public.public_snapshots
for select
to anon, authenticated
using (true);

drop policy if exists "Public snapshots are insertable" on public.public_snapshots;
create policy "Public snapshots are insertable"
on public.public_snapshots
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public snapshots are updateable" on public.public_snapshots;
create policy "Public snapshots are updateable"
on public.public_snapshots
for update
to anon, authenticated
using (true)
with check (true);
