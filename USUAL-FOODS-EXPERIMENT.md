# Usual foods experiment — local review

Implemented on `experiment/usual-foods`, September 19, 2026. Not deployed or pushed.

## Recovery baseline

- Working folder: `/Users/rich/Developer/carb-counter`; Git was already initialized, clean on `main`.
- Baseline commit: `7356f86`; local recovery branch: `baseline/pre-usual-foods-2026-09-19`.
- Dated archive: `backups/20260919-183206-baseline/source-and-bundle.tar.gz`.
  Includes the original source and existing deployment bundle, excludes real configuration.
  The original `config.js` remains in place, ignored by Git. The original Dropbox folder was untouched.
- Public live URL: https://rt-carb-counter.netlify.app. Its index, app, styles, voice, label,
  Log later, and service worker files matched the baseline source byte for byte before editing.
  The saved deployment bundle also matched. Baseline service worker: `ncc-v29`.
  Evidence is in the backup directory's `BASELINE.txt`; the specific Netlify deploy ID was not inspected.
- No GitHub repository, remote push, deployment, database migration, or production-data edit was performed.

## What changed

Settings → **Try Usual foods** is local to each person and device, initially off. Enabling
shows **Most used** (up to nine) and **Favorites** (all saved favorites) in the category
view with an empty search. Existing cards and category controls retain their layouts when off.
Preference changes never write to the database or alter favorites.

Most used counts confirmed positive-quantity entries by food ID for the last 30 local
calendar dates including today. Frequency, latest log date, name, then ID decide membership;
the chosen cards display alphabetically. Its separate, background history query verifies
the complete paginated count, including when the server cap is smaller than a requested
page. Missing, partial, changing, timed-out, or failed history yields an explicit Favorites
fallback. Favorites are never relabeled as usage results.

Membership is frozen through logging, quantity edits, delete/undo, date navigation, and
mode changes. It refreshes on a fresh load or return after at least 15 minutes away.
Catalog names/servings remain current, and deleted foods disappear. Responses for a
previous person/session are ignored. The existing logging write paths are unchanged.

The separate grid uses three columns and wraps names. Narrow containers or enlarged
root text use two columns. Floating pills temporarily hide when they would cover Usual
foods. A small wrapping fix also keeps unusually long unbroken names from pushing log-row
controls offscreen. The viewport permits user zoom. Packaging includes `usual-foods.js`;
the proposed service-worker version is `ncc-v30-usual-foods`.

## Safe local preview

Run `node preview-usual-foods.js` in this folder, then open **http://127.0.0.1:8879/**.
This separate port avoids an older app cached at the ordinary preview address. Look for
**Fixture preview · fictional foods · changes reset on reload** before testing writes.
The server never reads real configuration, replaces the database client with in-memory
fixtures, blocks external network connections, and keeps development assets uncached.
Only layout preferences persist in this preview. Neither preview file is packaged for deployment.

Enable Settings → Try Usual foods to inspect the experiment. Fixture links:

- `/?fixture=six`: six foods, for height comparison.
- `/?fixture=nine`: nine most-used foods and twelve favorites.
- `/?fixture=long`: long names, a long serving, and an unbroken name.
- `/?fixture=long&text=200`: 200% root text.
- `/?fixture=empty`: no qualifying history.
- `/?fixture=failure`: failed history; daily logging still works.
- `/?fixture=slow`: five-second initial history delay.
- Add `&person=gen` to check independent preferences.

For a phone on the same Wi-Fi, replace `127.0.0.1` with this Mac's local network address
and retain port `8879`. A phone starts with the experiment off until enabled locally.
This HTTP fixture preview is for layout/interaction testing, not installed-PWA validation.

## Verification

- `node --test *.test.js`: 19 passing tests/subtests, including all four pre-existing
  test files (voice, label parsing, label save integration, Log later).
- New tests cover local-date boundaries/DST, people, missing/deleted foods, pending/invalid
  entries, quantity versus occasions, ties, nine-item membership, alphabetic display, empty
  results, 1,203 entries across a smaller server cap, partial/changing/duplicate pages,
  unavailable storage, history failure/timeout, late responses, return timing, frozen sets,
  catalog updates, all favorites, off restoring identical legacy markup, search/A–Z,
  tap/hold in all three views, logging/portions, quantity/time edits, deletion/undo, failed saves.
- Browser fixture smoke tests: enabling/disabling/reloading, separate Gen preference,
  all twelve favorites, tap adds exactly one, unchanged card membership, past-day totals,
  labeled failure/empty fallback, quantity edits, delete/undo, time save, search, A–Z,
  My Foods and personal favorite editing.
- Visual checks: 390-pixel phone, 320-pixel narrow phone, 1280-pixel desktop, long names,
  and 200% root text. Cards wrap without clipping; no page overflow after the log-name fix;
  floating controls do not cover the Usual foods grid.
- Measured at 390 pixels, same six fictional foods, from section start to Categories:
  legacy **249.8 px**; experiment **241.6 px** including heading and switch (about 3% shorter).
  Nine usual cards: **336.0 px** (about 86 px taller than the legacy six-card section).
  These are fixture measurements, not a claim about Rich's actual foods or phone.
- Syntax and whitespace checks pass. Packaging was exercised in a temporary folder using
  `config.example.js`; the new module is included and fixture/tests are excluded. The existing
  `netlify-publish` bundle was deliberately left unchanged for recovery.
- Pagination follows the documented inclusive ranges and explicit ordering:
  https://supabase.com/docs/reference/javascript/using-modifiers-range.

## Still awaiting acceptance

- Rich's actual phone, preferred enlarged-text settings, six/nine-card readability, and
  whether the nine-card height is acceptable. Native touch/hold and haptics were not tested
  on an iPhone; gesture behavior is covered by the automated tests.
- Installed-app upgrade/reload with the new service-worker version. The fixture server
  deliberately bypasses production caching while editing; it does not prove an iOS update.
- Live Supabase pagination and real usage membership were not queried for this experiment;
  queries were verified against isolated data. No real writes were used for verification.
- Shortcut end-to-end runs on an iPhone (voice, label, Log later) and a live private Log later
  completion were not performed. Existing automated checks pass; those code paths were not changed.
- The week-long usefulness comparison remains a post-approval trial.

## Rollback

1. Immediate: turn **Try Usual foods** off in Settings. The original Favorites section
   returns; favorites and confirmed logs are unchanged. This preference survives reload.
2. Local source: with a clean working tree, `git switch main` returns to the untouched
   baseline; `git switch experiment/usual-foods` returns to this experiment. The recovery
   branch `baseline/pre-usual-foods-2026-09-19` always identifies the original version if
   `main` later advances. Save any subsequent uncommitted work before switching.
3. If a later approved deployment needs reversal, create a rollback branch from the recovery
   branch, give `service-worker.js` a **new unused cache version** (do not reuse `ncc-v29`),
   then run `node prepare-deploy.js` with the retained local configuration and review the
   resulting bundle before manual deployment. Do not deploy this experiment until accepted.
4. The dated archive is an additional recovery copy. Extract into a separate folder and
   supply the retained local configuration; do not overwrite later work blindly. Code rollback
   never removes foods actually logged during a future live trial.
