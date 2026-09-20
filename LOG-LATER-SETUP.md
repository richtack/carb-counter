# Log later: backend and website rollout

Log later has two deployments that must both be completed:

1. a private Supabase table plus the `log-later` Edge Function;
2. the normal static website deployment from `netlify-publish`.

Dragging the website folder to Netlify does **not** deploy the database migration or Edge Function.

## Access model in plain language

- Siri gets one **capture-only** bearer key for one person. It can create reminders, but cannot read, edit, discard, or finish them.
- The web app gets a different **management** bearer key for the same person. It is entered once on each browser/device that should manage reminders.
- The database stores SHA-256 verifiers, not the original keys. Either credential can be revoked independently.
- The new pending tables grant no access to Supabase's `anon` or `authenticated` browser roles. Only the Edge Function reaches them.
- The existing `foods`, `entries`, and `settings` tables still have the project's intentionally broad anonymous policies. This feature secures pending notes; it does **not** turn the rest of the app into an authenticated/private app. A future whole-app login would be a separate product change.
- Keys in Shortcuts and browser local storage are bearer secrets. They are not hardware-secured credentials. Do not put them in a URL, `config.js`, source control, Netlify files, screenshots, or support logs.

## Part 1 — database migration

1. Open [Supabase](https://supabase.com/dashboard) and select project `gmxbcdppjxoijuuwanxr`.
2. Open **SQL Editor → New query**.
3. Open `log-later-migration.sql` from this project, copy the entire file, paste it into the query, and click **Run**.
4. Expect **Success. No rows returned**. Do not run a generated credential statement yet; that comes after the function is deployed.

The migration is safe to run again. It creates private credential/pending tables, adds audit/linkage fields to `entries`, and installs server-only functions for idempotent capture, edit, discard, and atomic resolution.

## Part 2 — deploy the Supabase Edge Function

The project already contains:

- `supabase/config.toml` with JWT gateway verification disabled for this one function;
- `supabase/functions/log-later/index.ts` with its own scoped bearer-key verification.

JWT verification is disabled at the gateway because the Shortcut does not have a Supabase user session. The endpoint is not anonymous in practice: its handler rejects every request without a valid, unrevoked Log later key.

### Set the browser-origin allowlist

In Supabase, open **Edge Functions → Secrets** and add:

- Name: `LOG_LATER_ALLOWED_ORIGINS`
- Value: the exact two website origins, comma-separated, with no paths or trailing slashes. Example:

  ```text
  https://rt-carb-counter.netlify.app,https://YOUR-GEN-SITE.netlify.app
  ```

Use the real Gen address, not the placeholder. For temporary local browser testing only, append `,http://localhost:8765`, then remove it afterward. The Shortcut does not send a browser Origin header, so it is unaffected by this allowlist.

### Deploy from Terminal

Open Terminal, change to this project folder, then run:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref gmxbcdppjxoijuuwanxr
npx supabase@latest functions deploy log-later --no-verify-jwt
```

- `login` opens a Supabase authorization flow the first time.
- `link` may ask for the database password saved when the project was created.
- The final command must report that `log-later` was deployed.
- `--no-verify-jwt` is intentional and matches `supabase/config.toml`; the function performs its own narrow authentication.

The live endpoint is:

```text
https://gmxbcdppjxoijuuwanxr.supabase.co/functions/v1/log-later
```

## Part 3 — create Rich's two credentials

In Terminal, from the project folder, run:

```bash
node provision-log-later.js rich
```

The command writes nothing to disk. It prints:

1. a Siri capture key;
2. an app management key;
3. one SQL `insert` statement containing only their hashes.

Then:

1. Temporarily save the two original keys in a password manager.
2. Copy only the printed SQL statement into **Supabase → SQL Editor → New query**, and click **Run**.
3. Keep the capture key for `LOG-LATER-SHORTCUT.md`.
4. After the website is deployed, open Rich's app → ⚙ **Settings → Log later → Connect pending reminders** and paste the management key.

If Gen will use Log later, repeat with:

```bash
node provision-log-later.js gen
```

Never give Rich's management key to Gen's site, or vice versa. Ownership comes from the server-side credential row, not from the hostname or a caller-supplied person name.

## Part 4 — deploy the static website

Run all local checks and create the clean upload folder:

```bash
node voice-logging.test.js
node label-scanning.test.js
node label-integration.test.js
node log-later.test.js
node prepare-deploy.js
```

Then drag the generated `netlify-publish` folder to the manual deploy area for both household Netlify sites. Do not deploy the whole source folder. The service-worker cache is `ncc-v29`.

Open each site once in Safari after deployment. Confirm the correct household name, then enter that person's management key through ⚙ **Settings → Log later**. Existing voice and nutrition-label Shortcuts require no changes.

The management key is saved only in that browser's local storage. It is not part of the Netlify
deployment and does not sync through Supabase or iCloud. Enter it again after clearing Safari
website data, changing browsers/devices, removing and reinstalling the home-screen app, or any
other event that removes local site storage.

## Part 5 — backend smoke test before building the Shortcut

After Rich's management key is connected:

1. In the app, tap **Log later**.
2. Enter `Backend smoke test` and tap **Save**.
3. Confirm an amber **Needs logging** row appears and the all-dates count becomes 1.
4. Tap the row → **Discard** → confirm. Verify the count returns to its previous value and no food entry was created.

This proves the deployed website, credential, Edge Function, and database migration can communicate without exposing the key in a URL.

## Troubleshooting: the Shortcut says “Saved,” but nothing appears

An `ok` value of `true` proves that the capture credential, Edge Function, and database accepted
the reminder. The website is a separate management client: it reads reminders when it loads or
returns to the foreground; the backend does not push a new row directly into an already-open page.

Check these items in order:

1. Confirm the deployed website includes the **Log later** controls. If it does not, deploy the
   current `netlify-publish` folder.
2. Open ⚙ **Settings → Log later**. If it is disconnected, paste the management key for that
   site's person again. A missing management key is the expected cause when capture succeeds but
   the website cannot list reminders.
3. Close any open editor/modal and reload or bring the app back to the foreground.
4. Confirm the Shortcut's `request_id` and `note` fields were restored to their Magic Variables
   after the fixed-ID test. Reusing the test ID can acknowledge an existing resolved or discarded
   record without creating a second pending item.

If needed, verify the server record without exposing any keys:

```sql
select owner, request_id, note, log_date, local_time, status, created_at
  from public.pending_food_items
 order by created_at desc
 limit 5;
```

The newest normal capture should have the expected `owner` and `status = 'pending'`. Never paste
credential hashes or original keys into troubleshooting notes.

## Revocation and rotation

To revoke Rich's Siri key immediately, run this in Supabase SQL Editor:

```sql
update public.log_later_credentials
   set revoked_at = now()
 where owner = 'rich' and scope = 'capture' and revoked_at is null;
```

To revoke Rich's web-management keys:

```sql
update public.log_later_credentials
   set revoked_at = now()
 where owner = 'rich' and scope = 'manage' and revoked_at is null;
```

Create only the replacement needed:

```bash
node provision-log-later.js rich capture
node provision-log-later.js rich manage
```

Run the newly printed SQL, then replace the old key in the Shortcut or app. Revocation does not delete pending notes.

## What remains a real-device check

Local tests cannot prove Siri dictation behavior, iOS permission prompts, cellular connectivity, spoken responses, or locked-phone behavior. Complete the phone checklist in `LOG-LATER-SHORTCUT.md` before calling those verified.
