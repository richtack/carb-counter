-- ============================================================
--  Net Carb Counter — Multi-user migration (RUN ONCE)
--  Adds a second user: shared foods, but separate logs,
--  settings, and favorites per person.
--
--  How to run:
--    Supabase Dashboard → SQL Editor → New query →
--    paste this whole file → Run.
--  Safe to run more than once (every step is idempotent).
-- ============================================================

-- 1. Tag each logged entry with who it belongs to.
--    Existing rows become Rich's automatically (default 'rich'),
--    so none of your current history is lost or reassigned.
alter table entries add column if not exists person text not null default 'rich';
create index if not exists entries_person_date_idx on entries (person, log_date);

-- 2. Make settings PER-PERSON instead of one shared (id=1) row.
--    Your existing settings row becomes Rich's.
alter table settings add column if not exists person text;
update settings set person = 'rich' where person is null;
alter table settings drop constraint if exists settings_singleton;
create unique index if not exists settings_person_unique on settings (person);

-- 2b. The old table defaulted id to the literal 1. Give it a real sequence so
--     new people (Gen) get a unique id instead of colliding with Rich's id=1.
create sequence if not exists settings_id_seq owned by settings.id;
select setval('settings_id_seq', coalesce((select max(id) from settings), 1));
alter table settings alter column id set default nextval('settings_id_seq');

-- 3. Per-person favorites: a list of food ids, one set per person.
--    (The food list itself stays shared — only the starred set is personal.)
alter table settings add column if not exists favorites jsonb not null default '[]'::jsonb;

-- 4. Seed Rich's favorites from the foods currently starred, so his app
--    doesn't open to an empty Favorites section. Only runs if he has none yet,
--    so it will never clobber favorites he sets later.
update settings
   set favorites = (select coalesce(jsonb_agg(id), '[]'::jsonb) from foods where favorite = true)
 where person = 'rich' and favorites = '[]'::jsonb;

-- Gen's settings row (with her own seeded favorites) is created automatically
-- by the app the first time her copy loads — nothing to do here for her.
