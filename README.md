# 🥑 Net Carb Counter

A fast, phone-installable web app (PWA) for logging net carbs from **your own** ~30 foods,
backed by a Supabase cloud database so it syncs across all your devices.

- **Log tab** — tap a food to log one serving instantly; **hold** a food for a portion picker
  (0.5×, 2×, custom). See your running daily total against your target, adjust quantities
  with `− / +`, delete with undo, and flip through past days with `‹ ›`.
- **My Foods tab** — add / edit / delete your foods live (name, serving size, net carbs,
  category, favorite). Optional “total carbs − fiber − sugar alcohols” calculator.
- **My Meals tab** — save a combination of foods and usual serving amounts. Choose it from
  **Saved meals** on the Log tab, adjust its components for this occasion, then log them together.
  The meal template is personal to each household member and syncs across their devices.

At a desk, press `/` to search foods on the Log tab, use `↑`/`↓` to select a match, and press
`Enter` to log one serving. The search clears and stays focused so you can type the next food.
`Shift+Enter` opens portions instead. Press `?` outside a text field for the full shortcut list.

Favorites float to the top; the rest group by category so a growing list stays scannable.

The optional **Log my food** Shortcut can dictate several foods and open a review before saving.
Setup instructions are in [`VOICE-SHORTCUT.md`](VOICE-SHORTCUT.md).

The separate **Scan a food** Shortcut can photograph a US Nutrition Facts panel, prefill a
conservative review, and save one shared food without logging a meal. Setup and phone testing are
in [`LABEL-SHORTCUT.md`](LABEL-SHORTCUT.md).

**Log later** can capture a private reminder in the app or through a Siri Shortcut, keep unknown
nutrition distinct from zero, and atomically replace the reminder with one or more saved foods.
Backend/credential rollout is in [`LOG-LATER-SETUP.md`](LOG-LATER-SETUP.md); iPhone setup and
real-device checks are in [`LOG-LATER-SHORTCUT.md`](LOG-LATER-SHORTCUT.md).

---

## One-time setup (~10 minutes)

### 1. Create your free Supabase project
1. Go to **https://supabase.com** → sign up → **New project**. Pick any name; save the
   database password (you won't need it for the app).
2. Wait ~1 minute for it to finish provisioning.

### 2. Create the tables
1. In the project, open **SQL Editor → New query**.
2. Open the file [`supabase-setup.sql`](supabase-setup.sql), copy everything, paste it in, click **Run**.
   You should see “Success”.

### 3. Get your two keys
1. Go to **Project Settings (gear) → API**.
2. Copy the **Project URL** (e.g. `https://abcd1234.supabase.co`).
3. Copy the **anon / public** key (a long string starting with `eyJ…`).

### 4. Plug them into the app
1. Open [`config.js`](config.js) in a text editor.
2. Paste your Project URL and anon key between the quotes. Save.

That's it — the app is wired to your cloud.

---

## Run it locally (to try before deploying)

The app needs to be served over `http://` (not opened as a `file://`), because of the
service worker and Supabase. From this folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

---

## Put it on your phone (deploy)

To use it on the go, the app needs a public `https://` address. Easiest free option —
**Netlify Drop** (no account/build needed):

1. Run `node prepare-deploy.js` in Terminal.
2. Go to the existing site's **Deploys** page in Netlify.
3. Drag the generated **netlify-publish** folder onto the manual deploy area. This intentionally
   excludes tests, SQL, and development notes.
4. You get a URL like `https://your-name.netlify.app`. Open it on your iPhone in Safari.
5. Tap the **Share** button → **Add to Home Screen**. Now it's an app icon. 🎉

(Other equally good free hosts: Cloudflare Pages, Vercel, GitHub Pages. Any static host works —
there's no build step.)

> **Re-deploying after edits:** rebuild and drag `netlify-publish` onto Netlify Drop again (or connect the folder
> to a Git repo for auto-deploys). Your data lives in Supabase, so it's untouched by redeploys.

---

## Notes

- **Privacy:** this is a personal single-user app, so the database is open to anyone holding
  your `anon` key. That key ships inside the app (normal for Supabase), so just don't post your
  app URL/key publicly. You can add real logins later if you ever want per-user privacy.
- **Log later privacy:** pending notes are an exception to the broad legacy access above: their
  tables deny browser-role access and are reached only through scoped, revocable credentials in
  the `log-later` Edge Function. This does not retroactively secure foods, logs, or settings.
- **History & editing past days:** use the `‹ ›` arrows on the Log tab to view or back-log any
  day. Tap the date to jump back to Today.
- **Saved meals:** the migration in [`supabase/migrations/20260930212500_saved_meals.sql`](supabase/migrations/20260930212500_saved_meals.sql)
  was applied to the shared project on September 30, 2026. New installations need this schema
  before deploying the app. Meals use current
  values from their foods when logged; the resulting ordinary entries keep those values even if
  a food or meal is later edited. A deleted food must be replaced in affected meal templates
  before those meals can be logged. Meal templates use the same household access model as foods
  and settings; the person field is a filter, not authentication.
- **Incomplete days:** at the bottom of the day's log, tap **Flag day as incomplete** when a day ended
  with food missing from the log. Tap again to remove the flag. Available for today and past
  dates, separately for each person; adding food later does not clear it automatically.
  Flags sync through `day_log_status` and do not change nutrition totals or Log later reminders.
  Existing installations need `supabase/migrations/20260921151458_day_log_status.sql` before
  deploying the updated app. The table uses the same household access model as entries/settings.
- **Analyzing exports:** the full-log CSV includes `day_log_incomplete` (`true`/`false`) and
  `row_type`. False means *not flagged*, not confirmed complete. Flagged dates with no foods
  get a `day_status` row with blank nutrition fields (unknown, not zero); food rows have
  `row_type=food`. Exclude flagged dates from analyses that need complete daily intake.
  This manual flag is separate from unresolved Log later reminders. Exports load all pages
  and stop with an error if either entries or flags cannot be fetched.
- **Editing a food** never changes past logs — each entry stores the carbs it had when you
  logged it.
- **Regenerating icons:** `node generate-icons.js` (no dependencies needed).

## Files
| File | What it is |
|---|---|
| `index.html` / `styles.css` / `app.js` | the app |
| `voice-logging.js` | conservative saved-food matching and portion conversion for the Shortcut |
| `label-scanning.js` | conservative nutrition-label parsing and retry-safe draft IDs |
| `log-later.js` | pending-note validation, local-date helpers, and private endpoint client |
| `log-later-migration.sql` | private pending/credential tables and atomic database operations |
| `supabase/functions/log-later/` | authenticated capture and management Edge Function |
| `prepare-deploy.js` | creates a clean `netlify-publish` folder for Netlify Drop |
| `config.js` | your Supabase URL + key (you fill in) |
| `supabase-setup.sql` | run once to create your tables |
| `manifest.webmanifest` / `service-worker.js` | makes it an installable, offline-capable PWA |
| `icons/` | app icons (generated by `generate-icons.js`) |
