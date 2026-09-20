# Log later — Siri capture and pending food reminders

## Objective and agreed scope

Rich wants to quickly record what he ate while out, then enter accurate foods and portions later. Capture must be easier than normal food logging. Siri is the primary entry point in version one; an in-app button is also required. Reminders can remain entirely in-app.

Build on the existing web app, shared food library, separate personal logs, voice-meal shortcut, and nutrition-label shortcut. Rich reports both existing workflows work well. Do not build a native app or migrate storage/hosting. No AI is needed for capturing a pending note.

This document is a specification only. No implementation, database migration, endpoint, or Shortcut for Log later has been created in this planning task.

## Read before implementation

Read applicable AGENTS.md, ../Working-With-Rich.md, START_HERE.md, current app.js and supporting scripts, VOICE-SHORTCUT.md, LABEL-SHORTCUT.md, schema/migration files, and prepare-deploy.js. Older handoff documents describe earlier versions; current code and current deployment notes take precedence. Use the Supabase skill for database/backend work.

Current project notes describe plain JavaScript/HTML, Netlify hosting, Supabase storage, and household deployments selected by hostname. Deploy only the generated netlify-publish folder, not the whole source directory. Inspect current access controls rather than assuming that hostname or PERSON constitutes authentication.

## Siri capture: primary flow

1. Rich says “Siri, log food later.” This invokes a separately installed Shortcut with that name.
2. Shortcut prompts “What did you eat?” and dictates a short note, for example “Lunch salad at Panera.”
3. Generate one request UUID, capture timestamp, local calendar date, and timezone/offset before the request. Keep that identity and timestamp stable across retries.
4. Send an authenticated HTTPS request to a narrow capture endpoint.
5. After durable server acknowledgement, speak “Saved for later.” No review screen, browser opening, or extra save confirmation is required for successful capture.

Empty/cancelled dictation must not create an entry. On failed or uncertain saves, never say “Saved.” State that saving could not be confirmed and offer a safe retry with the same request ID where practical. Do not promise offline capture unless a durable retry mechanism is actually implemented and tested; the first version can require a connection.

First-run Shortcuts permissions or unlocking may be required by iOS. Verify Siri invocation, dictation, HTTPS action, and spoken response on Rich's actual phone, including the locked-phone case. Do not promise fully locked-screen operation without testing. Give precise setup instructions and accurately distinguish OS permission prompts from normal capture steps.

## In-app capture

Provide a modest, discoverable “Log later” action. Open a short note field with Save and Cancel. Use the selected log date and current time for in-app capture, keeping any non-today date visible. Siri defaults to the captured local date. Do not parse phrases such as “yesterday” into dates automatically in version one.

Capture saves a pending record, not a food in the shared library or a zero-carb meal entry. Notes are personal to the configured/authorized household person.

## Reminders and nutritional meaning

- Render pending notes as amber entries in the appropriate day's chronological log with “Needs logging,” original time, and note text. Use text/icon treatment in addition to color.
- Show a compact persistent pending count near the daily total, including unresolved entries from earlier days. Tapping opens a list grouped by date, oldest first.
- Keep the current day's nutrition status distinct from the all-dates reminder. For example: “18g logged · 1 meal pending” for today, and “3 items need logging” across dates. An older unresolved note must not be implied to belong to today's total.
- Pending notes contribute unknown nutrition, never a measured zero. Known numeric totals can still be shown but are visibly incomplete when the selected date has pending notes. Apply the same principle to optional calorie totals and goal/completion states.
- Preserve visibility in Time and Summary views without combining pending notes into known-food totals.
- Fetch pending state on return to the website so Siri captures appear promptly. Preserve unrelated unsaved edits when refreshing.

## Finish logging

Tapping a pending note offers Finish logging, Edit note, and Discard. Discard should have confirmation or undo and must not create a food entry.

Finish logging opens a focused review with the original note and date/time visible. Allow one or several saved foods and editable portions. Include a way to create a missing food through the existing Add food workflow and return to the unfinished resolution without losing it. Do not force users to create a permanent “salad” food when they want to log several ingredients. Reuse existing one-off nutrition entry if it fits cleanly, but saved-food selection plus new-food creation is the required first-version path.

On explicit Save, create the real food entries using the existing historical snapshot semantics. Preserve the pending note's original log date and time, including across midnight/timezone changes; let the user adjust them deliberately. Mark the pending note resolved and remove it from pending reminders only after the replacement entries are durably saved. Cancel or failure leaves it pending.

Resolution must be atomic or equivalently recoverable and idempotent: a retry cannot duplicate replacement entries, and a partial failure cannot lose the reminder. Concurrent attempts from two devices must not resolve the same note twice. Editing/discarding a pending item during resolution must yield a clear conflict rather than silently overwriting changes. Keeping resolved records internally for retry/audit purposes is acceptable; they are not displayed as pending.

## Storage and API design

Prefer a dedicated pending-items table or equivalent separate records rather than fake foods or zero-carb entries. Suggested fields: UUID, owner/person binding, note, captured timestamp, local log date, timezone/offset, status, updated timestamp/version, resolved timestamp. Exact schema is an implementation decision. Retain enough identity/linkage to support retry-safe resolution and discard.

Use a stable client request UUID and server uniqueness constraints for capture idempotency. A duplicate request with the same owner and content returns the existing successful acknowledgement; conflicting content for a reused ID is rejected. The server validates note length, timestamp/date formats, and payload size. Reasonable note limit: 500 characters, with a clear error rather than silent truncation.

Provide a narrow HTTPS POST endpoint through infrastructure compatible with the existing deployment. Do not assume manual Netlify static deployment automatically deploys backend functions. Supabase Edge Functions are an option; inspect available tooling and document backend deployment separately.

Authenticate Shortcut requests using a revocable, scoped per-person capture credential or an appropriate existing authenticated session design. Bind the credential to its owner server-side; do not trust caller-supplied PERSON to choose another user's records. For a scoped credential, allow capture only, store a verifier/hash server-side, keep it out of URLs, public web config, source control, publish folders, and logs, and provide setup/revocation instructions. A credential entered into Shortcuts remains a bearer secret; do not describe it as a hardware-secured credential store.

Never put service-role credentials in Shortcuts or browser code. Inspect actual database policies: existing project history includes broadly permissive anonymous access, so a protected capture endpoint alone must not be described as securing all app data. New pending records must have a deliberate access model for web read/edit/resolve and Shortcut capture. Do not use a public hostname or a person string as authorization. If secure web access requires additional household authentication, surface that concrete user-experience implication early, while completing independent work. Avoid an unrelated whole-app auth rewrite without explaining why it is necessary.

Keep endpoints limited, validate inputs, avoid logging credentials/full personal notes, and include proportionate abuse protection. Return a clear durable acknowledgement with the request/record ID. Browser rendering must treat notes as plain text.

## Acceptance tests

1. Siri capture creates one pending note for the correct person and original date/time; the website is not opened.
2. Successful acknowledgement speaks success; rejected credentials, network failures, and uncertain responses never falsely announce a save.
3. Retrying capture, including after a lost response, creates no duplicate.
4. Blank/cancelled capture creates nothing. Long/malformed payloads and HTML-like note text are handled safely.
5. Notes appear after returning to the app, in daily log views and the all-dates pending list. Yesterday's unfinished note remains discoverable today.
6. Nutrition totals include only actual foods and visibly indicate incomplete days. Zero and unknown remain distinct.
7. Finish logging supports multiple foods/portions and creating a missing food without losing the pending context.
8. Replacement entries retain historical snapshots and original date/time. Cancel/failure retains the pending note.
9. Duplicate/concurrent resolution produces exactly one replacement batch. Partial failure is recoverable without losing the reminder or duplicating entries.
10. Editing/discarding behaves correctly and refreshes counts; person boundaries and revoked credentials are enforced.
11. Existing manual food logging, voice review, label scanning, favorites, household separation, and calorie preferences still work.
12. Siri and Shortcuts behavior is verified on the actual iPhone, including permission/lock behavior. Report phone tests as pending until Rich performs them.

Use meaningful automated tests for parsing/validation, idempotency, ownership, resolution, and totals, plus focused UI checks. Test database mutations in an appropriate test context and clean up test records. Distinguish mocked tests from deployed endpoint verification.

## Deliverables and rollout

- App UI and reminder/resolution behavior.
- Reviewed database migration, capture endpoint, and secure credential provisioning/revocation process.
- LOG-LATER-SHORTCUT.md with exact Shortcut actions, request body/headers, response handling, retry identity, and first-phone-test steps. Verify available Apple actions; do not invent a signed Shortcut artifact.
- Backend deployment instructions plus existing static publish instructions, service-worker cache update, and START_HERE.md update.
- A concise completion report identifying what was tested, any remaining deployment/setup, and phone checks.

Implement in stages: data/access model and endpoint contract; retry-safe capture; pending UI; atomic resolution; Shortcut instructions and real-phone validation. Use reasonable defaults and continue independent work when input is pending. No production migration or deployment has been performed by this specification task.

## Model and next-task prompt

Recommended implementation model: GPT-5.6 Sol with High reasoning. This task requires careful backend and UI integration but does not require an AI runtime or subagents.

“Read LOG-LATER-SPEC.md and the current project instructions. Implement Siri-first Log later capture, pending reminders, and replacement with actual foods. Preserve the working voice and nutrition-label workflows. Pay particular attention to scoped authentication, retries, household ownership, unknown totals, and atomic resolution. Complete local verification and provide exact backend, website, and iPhone Shortcut setup instructions. Clearly distinguish completed tests from deployment and phone checks still pending.”
