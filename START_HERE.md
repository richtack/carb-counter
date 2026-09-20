# 👋 Start Here — Rich's Carb Counter

A quick orientation so you (or an AI assistant) can pick this project back up at any time,
even if the original chat is gone. For deeper setup/deploy details, see `README.md`.

---

## What this is
A phone-installable web app (PWA) for logging net carbs from your own ~37 foods, backed by a
Supabase cloud database so it syncs across all your devices.

- **Project folder:** `~/Library/CloudStorage/Dropbox/Claude Code/Net Carb Counter`
- **Live app URL (fill in):** `https://rt-carb-counter.netlify.app`  ← paste your Netlify link here
- **The app files:** `index.html`, `styles.css`, `app.js` (no build step — plain HTML/JS)

---

## Everyday things you can do IN THE APP (no code needed)
- **Add / edit / delete a food:** *My Foods* tab → "+ Add a food" (or tap a food to edit).
- **Log food:** *Log* tab → tap a food (one serving) or **hold** it for a portion (0.25×–4×).
- **Save a reminder:** *Log* tab → **Log later** → type a short note. Amber reminders stay unknown until replaced with real foods.
- **Change your daily target:** ⚙ gear (top-right) → Daily net-carb target.
- **Reorder categories:** ⚙ gear → Reorder categories.
- **Export your data:** ⚙ gear → Export foods / Export log (CSV).
- **Edit a logged time:** in the *Log* tab's **Time** view, tap the time on an entry.
- **See a consolidated day:** tap the big total number, or use the **Time | Summary** toggle.
- **Look at past days:** the ◀ ▶ arrows next to the date.

---

## When you want to CHANGE the app (with an assistant)
1. Open this project folder in your AI coding tool.
2. Say: **"Read START_HERE.md and README.md, then [what you want]."**
3. Describe the change. The assistant can preview it locally before you deploy.

### Run it locally to preview
```bash
node serve.js        # then open http://localhost:8765
```

### Deploy a change to your phone
1. Edit is done → in `service-worker.js`, bump the `CACHE` version (e.g. `ncc-v27` → `ncc-v28`).
   *(This is what makes your phone pull the new version instead of the cached old one.)*
2. Run `node prepare-deploy.js`.
3. In each household Netlify site's **Deploys** page, drag the generated **netlify-publish** folder
   into the manual deploy area. Do not deploy the whole source folder; it contains private notes and tests.
4. Reopen the app on your phone. Your data is in Supabase, so nothing is lost on redeploy.

---

## Your cloud database (Supabase)
- **Dashboard:** https://supabase.com/dashboard → project `gmxbcdppjxoijuuwanxr`
- **Your keys** live in `config.js` (already filled in). The schema (tables) is in `supabase-setup.sql`.
- Tables: `foods` (your food list), `entries` (each logged item), `settings` (target + category order).
- Log later adds private `pending_food_items` and `log_later_credentials` tables plus a separately deployed Supabase Edge Function. A Netlify drag-and-drop does not deploy that backend.
- You can even view/edit your data by hand in the dashboard → **Table Editor**.

---

## What's already built
Logging with tap-feedback (pulse + "✓ +Xg" + haptic) · favorites · portions 0.25×–4× ·
daily target + progress bar · day history · reorderable categories (synced) · CSV export ·
floating jump-to-log button · timestamped chronological log with tap-to-edit times ·
Time/Summary views (Summary by category or merged) · tap-total-to-Summary ·
"Rich's Carb Counter" app header · Shortcut voice-meal review (setup in `VOICE-SHORTCUT.md`) ·
nutrition-label scan review (setup in `LABEL-SHORTCUT.md`) · Siri-first **Log food later** capture +
private pending reminders + multi-food atomic finish flow (backend rollout in `LOG-LATER-SETUP.md`,
phone setup in `LOG-LATER-SHORTCUT.md`).

## Multi-user (Rich + Gen)
Built. One codebase, deployed twice — shared foods, but separate logs/settings/favorites.
- `config.js` chooses the person from the website address (`gen` in the hostname selects Gen;
  anything else selects Rich). Local testing can use `?person=gen`.
- DB migration is `migrate-multiuser.sql` (already run once). `MULTI-USER-HANDOFF.md` has the full plan.
- Gen's app = this same publish folder deployed to her `gen` Netlify site (same Supabase). Keep
  both deployments on the same code version.

## Ideas we discussed but haven't built (backlog)
- [ ] Calorie tracking — built; needs the migration in `supabase-setup.sql` run + redeploy.
- [ ] Weekly average / multi-day history overview
- [ ] "Copy yesterday's log" button
- [ ] Running cumulative total per entry in the Time view
- [ ] Rename the iPhone **home-screen label** (currently generic) to e.g. "Rich's Carbs"
- [ ] Optional subtle hint that the timestamp is tappable

---

## If something breaks
- App stuck on the "Almost there" setup screen → check `config.js` has your real Supabase URL + key.
- Changes not showing on your phone → you forgot to bump the `CACHE` version before redeploying
  (see Deploy above), or remove & re-add the app to the home screen.
- **Log food later** says it saved, but no reminder appears → open ⚙ **Settings → Log later** and
  reconnect that person's management key. The key is stored separately in each browser/home-screen
  installation and can disappear when its local website data is cleared.
- Data looks wrong → open the Supabase **Table Editor** to inspect `foods` / `entries` directly.
