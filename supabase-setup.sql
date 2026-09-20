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
