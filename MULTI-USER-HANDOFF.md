# Handoff: Add a Second User (shared foods, separate logs)

**Goal:** Rich and his wife both use the carb counter. They **share one food database**, but each
has their **own logs** and their **own settings** (carb target, calorie goal, etc.).

## Read these first (in order)
1. `../Working-With-Rich.md` — how Rich likes to collaborate (plain language, clean design, honest
   recommendations, verify-then-claim). Follow it.
2. `START_HERE.md` and `README.md` — what the app is, how to run locally, how to deploy, where data lives.
3. This file.

The new session should open **this same project folder** (`Net Carb Counter`) — the work is changes
to the *existing* app, not a new project.

---

## The key architectural decision: ONE codebase, TWO deployments (not two copies)
Do **not** fork the code into a second copy. Instead:
- Add a **`PERSON`** identifier to `config.js` (e.g. `"rich"` / `"kim"`).
- **Tag each log entry and each settings row with `person`.**
- Keep the **`foods` table shared** (no person tag).
- Deploy the **same folder twice** to two Netlify sites — each with its own `config.js` `PERSON`
  value — both pointing at the **same Supabase project** (same URL + anon key).

Result: shared foods, separate logs + settings, **one codebase to maintain**. A future feature is
built once and both deployments get it on their next redeploy.

---

## Decisions
1. **Favorites — personal.** ✅ DECIDED (Rich, this session): each person has their **own**
   favorites. Implementation: move favorites out of the shared `foods` table into per-person storage
   — a `favorites` list (array of food ids) in each person's `settings` row. The food list stays
   shared; only the *starred* set is per-person. (See schema + code changes below — the favorites
   pieces are now **required**, not optional.)

## Other decisions to confirm at the start (recommendations included)
2. **Category order — personal or shared?** *Recommend **personal***. It already lives in `settings`,
   which becomes per-person, so this is essentially free.
3. **The food list itself** — shared add/edit/delete (either person can modify). *Recommend **yes,
   shared*** (that's the whole point). Note: if one deletes a food it's gone for both, but past logs
   are preserved (entries store name/carbs/calories denormalized).
4. **Wife's name** — needed for her app header ("___'s Carb Counter") and her `person` id. Ask Rich.
   Placeholder below: `WIFE_NAME` / `WIFE_ID`.
5. **Privacy** — both apps use the same anon key, and `person` is not access-controlled, so each
   *could* read the other's logs if they had the key. Fine for a household; just don't post the
   keys publicly. (Real per-user auth is possible later if ever wanted — out of scope now.)

---

## Implementation plan

### 1. Schema migration (Supabase → SQL Editor → run once)
```sql
-- tag each log with who it belongs to (existing rows become Rich's)
alter table entries add column if not exists person text not null default 'rich';
create index if not exists entries_person_date_idx on entries (person, log_date);

-- make settings PER-PERSON instead of a single (id=1) row
alter table settings add column if not exists person text;
update settings set person = 'rich' where person is null;       -- existing row = Rich
alter table settings drop constraint if exists settings_singleton;
create unique index if not exists settings_person_unique on settings (person);

-- per-person favorites (decision #1 = personal): list of food ids, one set per person
alter table settings add column if not exists favorites jsonb not null default '[]'::jsonb;
```

### 2. Config
- Add to `config.js`: `PERSON: "rich"` and `DISPLAY_NAME: "Rich"`. (Wife's copy uses
  `PERSON: "<WIFE_ID>"`, `DISPLAY_NAME: "<WIFE_NAME>"`.)
- App reads `state.person = window.NCC_CONFIG.PERSON`.

### 3. Code changes (`app.js`)
- **loadEntries / loadSettings:** filter by person — `.eq("person", state.person)`.
- **Settings load:** key on `person`, not `id = 1`. If no row exists for this person, **create one**
  with defaults (target 20, calorie_target 2000, track_calories true, empty category_order/favorites).
- **logFood + one-off insert:** include `person: state.person` in the inserted row.
- **Header title:** derive from `DISPLAY_NAME` → e.g. "Rich's Carb Counter" (currently hard-coded in
  `index.html`; make it set from config on boot).
- **Favorites (personal — required):** read/write the person's `settings.favorites` (array of food
  ids); update `foodCardHTML`, `renderFoodGrid` (favorites grid + category counts), and the
  food-editor favorite toggle to use that per-person set instead of `foods.favorite`. (Optional:
  seed each person's initial favorites from the current `foods.favorite` flags so neither starts empty.)
- **Foods load/save:** unchanged (shared) — except the favorite toggle if favorites went personal.
- Everything else (categories, A–Z, calories, time/carb/cal editors, exports) stays as-is but now
  reads the per-person entries/settings automatically.

### 4. Deploy two instances
- **Rich:** existing Netlify site, `config.js` PERSON=rich. Just redeploy after the changes.
- **Wife:** copy the folder, set `config.js` PERSON=`<WIFE_ID>` + DISPLAY_NAME, deploy to a **new**
  Netlify Drop site (same Supabase URL + anon key). She adds her site to her home screen.
- Bump the service-worker `CACHE` version on deploy (as always).

### 5. Verify (do this end-to-end against the real DB, then clean up test data)
- Log as Rich → entry has person='rich', shows only in Rich's app.
- Log as wife → person=`<WIFE_ID>`, shows only in her app.
- Both apps show the **same foods**.
- Each app has its **own** target / calorie goal / category order (and favorites if personal).
- Editing/adding a food in one app appears in the other.

---

## Gotchas
- The migration's `default 'rich'` correctly assigns all existing logs + the existing settings row to
  Rich. Double-check before assuming.
- Keep both deployments on the **same code version** (redeploy both after changes).
- This is the existing app made person-aware — resist the urge to duplicate files.
