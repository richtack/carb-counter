-- ============================================================
--  Net Carb Counter — Supabase schema
--  Run this once in your Supabase project:
--    Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---- Your personal food database -------------------------------------------
create table if not exists foods (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null,
  serving    text    not null default '',          -- free text: "1 cup", "100 g", "2 tbsp"
  net_carbs  numeric not null default 0,            -- net carbs PER serving (grams)
  category   text    not null default '',           -- optional grouping: Dairy, Veg, Snack...
  favorite   boolean not null default false,        -- pinned to the top for one-tap logging
  created_at timestamptz not null default now()
);

-- ---- Logged entries (one row per thing you ate) ----------------------------
-- name + net_carbs are denormalized (copied at log time) so editing a food
-- later never rewrites your history.
create table if not exists entries (
  id         uuid primary key default gen_random_uuid(),
  food_id    uuid references foods(id) on delete set null,
  name       text    not null,
  net_carbs  numeric not null default 0,            -- per-serving value at time of logging
  qty        numeric not null default 1,            -- portion multiplier (1, 2, 0.5 ...)
  log_date   date    not null,                      -- which day this counts toward
  person     text    not null default 'rich',       -- whose log this entry belongs to
  created_at timestamptz not null default now()
);
create index if not exists entries_log_date_idx on entries (log_date);
create index if not exists entries_person_date_idx on entries (person, log_date);

-- ---- Per-person app settings -----------------------------------------------
-- One row per person (e.g. 'rich', 'gen'). Foods are shared; logs, target,
-- category order, and favorites are personal. The app creates a person's row
-- automatically the first time their deployment loads.
create table if not exists settings (
  id             int       generated always as identity primary key,
  person         text      not null unique,
  daily_target   numeric   not null default 20,
  category_order jsonb     not null default '[]'::jsonb,   -- user-defined category order
  favorites      jsonb     not null default '[]'::jsonb    -- this person's favorite food ids
);
insert into settings (person, daily_target) values ('rich', 20)
  on conflict (person) do nothing;

-- ---- Calorie support (optional 2nd metric). NULL calories means "unknown"
--      (deliberately different from a real 0). -----------------------------
alter table foods    add column if not exists calories numeric;            -- null = unknown
alter table entries  add column if not exists calories numeric;            -- null = unknown
alter table settings add column if not exists calorie_target numeric not null default 2000;
alter table settings add column if not exists track_calories boolean not null default true;

-- ============================================================
--  Row Level Security
--  This is a personal, single-user app, so we allow the public
--  "anon" key full access. The anon key is safe to ship in the
--  client, but anyone who has it could read/write your data —
--  so don't post the key publicly. (You can add real logins
--  later if you ever want per-user privacy.)
-- ============================================================
alter table foods    enable row level security;
alter table entries  enable row level security;
alter table settings enable row level security;

drop policy if exists "anon all foods"    on foods;
drop policy if exists "anon all entries"  on entries;
drop policy if exists "anon all settings" on settings;

create policy "anon all foods"    on foods    for all to anon using (true) with check (true);
create policy "anon all entries"  on entries  for all to anon using (true) with check (true);
create policy "anon all settings" on settings for all to anon using (true) with check (true);
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

-- Personal reusable meal templates; each component is logged as a normal
-- entry when the meal is used. Existing installations should run the matching
-- migration in supabase/migrations before deploying the new app.
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
