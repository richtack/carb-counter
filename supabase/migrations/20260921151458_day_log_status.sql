-- Explicit manual flag; false/absent means not flagged, not verified complete.
-- Matches the existing household app's anon access model. Person is an app
-- filter, not an authenticated identity (the same as entries/settings).
create table if not exists public.day_log_status (
  person text not null,
  log_date date not null,
  incomplete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (person, log_date)
);
comment on column public.day_log_status.incomplete is
  'Manual missing-food flag. False or no row means not flagged, not confirmed complete.';
alter table public.day_log_status enable row level security;
revoke all on public.day_log_status from anon, authenticated;
grant select, insert, update on public.day_log_status to anon;
drop policy if exists "anon read day status" on public.day_log_status;
drop policy if exists "anon insert day status" on public.day_log_status;
drop policy if exists "anon update day status" on public.day_log_status;
create policy "anon read day status" on public.day_log_status for select to anon using (true);
create policy "anon insert day status" on public.day_log_status for insert to anon with check (true);
create policy "anon update day status" on public.day_log_status for update to anon using (true) with check (true);
