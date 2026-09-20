# Net Carb Counter: Shortcuts implementation handoff

Prepared September 13, 2026. Planning is complete; no application code, database, deployment, or Shortcut has been changed in this conversation.

## Agreed direction

Keep the existing web app and Supabase database. Do not build a native iOS app or migrate to CloudKit for this phase. Add voice meal logging first, then nutrition-label scanning, using Apple Shortcuts and Apple Intelligence where practical. Rich accepted a workflow that opens the web app for review before saving.

Rich uses an iPhone 16 Pro Max and reported running iOS 27 beta, with an intention to upgrade the following day. Verify the installed version and available Shortcut actions when testing; the reported release timing was not independently verified. Rich is comfortable using Shortcuts but has never integrated an API through them. Supply exact, plain-language setup instructions and handle the code work.

## Read first

- `../Working-With-Rich.md`: collaboration and design preferences.
- `START_HERE.md`: current app overview and deployment notes.
- `app.js`, `index.html`, `styles.css`, `service-worker.js`.
- `supabase-setup.sql`, `migrate-multiuser.sql`, `MULTI-USER-HANDOFF.md`.

README.md contains older single-user descriptions; inspect current code and migration files. Follow applicable AGENTS.md and relevant skills. This is an existing Netlify-hosted plain HTML/JavaScript project, with no build step. Do not migrate hosting or frameworks merely to add these features.

## Existing behavior and data

- Foods are shared between Rich and Gen. Entries, favorites, targets, and category order are personal.
- Deployment configuration supplies PERSON and DISPLAY_NAME. Preserve both deployments and their existing behavior.
- Tables: foods, entries, settings. Credentials/configuration are in config.js; do not copy credentials into this document or user-facing output.
- Food serving is currently free text; net_carbs and optional calories are per serving. Entries store quantity plus a historical snapshot of nutritional values and name. Editing a food must not rewrite past logs.
- Unknown calories are distinct from zero. Preserve this throughout extraction, review, and saving.
- Data loads from Supabase at startup and during specific actions; there is no live subscription in the inspected app.js. Add appropriate refresh behavior so returning to the website displays changes.
- Existing offline support caches app assets, not a durable queue of unsaved food entries. Do not claim offline logging without implementing and testing it.
- Local SQL grants anonymous access broadly. PERSON is an app filter, not authenticated authorization. The live database policies were not inspected. Do not describe the existing setup as authenticated or assume adding an endpoint secures the database. Inspect the actual access model and choose a proportionate integration design; never embed service-role credentials in the website or Shortcut.

## Phase 1: voice logging

Target experience: run “Log my food” → dictate several foods → match saved foods and interpret portions → open a compact web review → correct any uncertain items → explicitly save the meal.

Example: “I had two eggs, half a serving of my yogurt, and one slice of keto bread.” Use saved nutritional values rather than model-generated nutrition estimates. Resolve food references against actual IDs and validate all quantities. “Two eggs” does not necessarily mean two saved servings: account for the food's serving definition and ask for clarification in the review when it cannot be resolved. Unknown foods and ambiguous matches should remain unresolved, not silently guessed.

Choose and implement the simplest dependable Shortcut-to-web handoff after a small feasibility test. An authenticated API connection was proposed, but no endpoint, auth method, payload schema, or deployment has been designed yet. A review-only handoff may reduce the need for direct Shortcut database access. Avoid secrets in URLs and avoid saving on a GET or merely opening a link. Test Safari versus the installed PWA rather than assuming a link opens the desired surface.

Prevent duplicate meal entries on repeated taps/retries. Preserve person, local log date, quantities, and historical nutritional snapshots. Keep the existing tap-to-log experience intact.

## Phase 2: label scanning

Target experience: photograph a nutrition panel → recognize its text → extract serving size, total carbohydrates, fiber, sugar alcohols, and optional calories → open a prefilled web food form → user reviews/adds the product name → save to shared foods.

Keep missing values unknown. Handle per-serving versus per-100g columns explicitly. Product names may not be visible on the nutrition panel. Compute net carbs deterministically using the app's current convention; do not silently change that convention. Treat OCR/model output as untrusted input requiring validation and review. Verify the actual Shortcuts image/OCR/model actions on Rich's iOS version before promising a particular pipeline.

## Validation and delivery

Start with an end-to-end voice prototype before polishing both features. Test multiple foods, fractional portions, ambiguous food names, unmatched foods, cancellation, invalid model output, repeat submissions, connection failures, and the correct person's/date's log. Verify calculations, history preservation, shared foods, and return-to-app refresh. Distinguish local tests from phone tests that need Rich's participation. Do not claim phone verification without it.

Provide precise Shortcut setup steps (or a verified installable Shortcut if tooling allows), app changes, any necessary backend changes, and a clear deployment procedure. Existing notes require bumping the service-worker cache version for app edits and keeping both deployments on the same code version. Never deploy a whole folder containing private development notes or secrets without checking the publish contents.

Rich prefers incremental delivery, clean UI, concise explanations, reasonable defaults, and minimal repeated confirmation. Current request was to save this handoff; implementation has not begun.

## Model recommendation

GPT-5.6 Sol with High reasoning is the suggested implementation model: this is bounded JavaScript/integration work, with care needed around serving interpretation, validation, and retries. GPT-6 Astra is also suitable; switching is optional. This recommendation concerns the coding assistant, not a paid runtime AI dependency in the app. Prefer testing Apple's Shortcut models before introducing a paid external AI service.

## Documentation starting points

- Apple Intelligence in Shortcuts: https://support.apple.com/en-ie/guide/iphone/iph78c41eaf8/ios
- API requests from Shortcuts: https://support.apple.com/en-au/guide/shortcuts/apd58d46713f/ios
- Supabase documentation: https://supabase.com/docs
- Coding model reference: https://developers.openai.com/api/docs/models/gpt-5.6-sol

These establish platform capabilities, not a tested implementation of this app's workflows. Recheck relevant current documentation before implementation.

## Prompt for the next session

Read SHORTCUTS-HANDOFF.md and the project files it references. Implement the agreed web-app-plus-Shortcuts approach, starting with voice meal logging and web review before saving. Keep Supabase, shared foods, separate personal logs, and the current website working. Begin with a small end-to-end prototype and provide precise iPhone Shortcut setup instructions. Continue to label scanning once the voice workflow is validated. Use reasonable defaults and explain only decisions requiring my input.
