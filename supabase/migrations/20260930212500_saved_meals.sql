-- Personal reusable meal templates. The app still logs each component as an
-- ordinary entry with nutrition copied at log time.
create table if not exists public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  person text not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  items jsonb not null check (
    case when jsonb_typeof(items) = 'array'
      then jsonb_array_length(items) between 1 and 30
      else false end
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists saved_meals_person_name_idx
  on public.saved_meals (person, lower(btrim(name)));

-- Matches the existing household access model: person is an app filter, not
-- authenticated ownership. Do not describe these templates as private data.
alter table public.saved_meals enable row level security;
revoke all on public.saved_meals from anon, authenticated;
grant select, insert, update, delete on public.saved_meals to anon;
drop policy if exists "anon read saved meals" on public.saved_meals;
drop policy if exists "anon insert saved meals" on public.saved_meals;
drop policy if exists "anon update saved meals" on public.saved_meals;
drop policy if exists "anon delete saved meals" on public.saved_meals;
create policy "anon read saved meals" on public.saved_meals for select to anon using (true);
create policy "anon insert saved meals" on public.saved_meals for insert to anon with check (true);
create policy "anon update saved meals" on public.saved_meals for update to anon using (true) with check (true);
create policy "anon delete saved meals" on public.saved_meals for delete to anon using (true);
