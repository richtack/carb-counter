# “Log food later” Siri Shortcut

This is a third, separate Shortcut. Do not edit the working **Log my food** or **Scan a food** Shortcuts.

It dictates one short reminder, sends it directly to the private `log-later` Supabase Edge Function, and speaks success only after the server returns a durable acknowledgement. It does not open Safari or the Carb Counter.

## Before building it

Complete `LOG-LATER-SETUP.md` through the backend smoke test. Have Rich's **Siri capture key** ready. Do not use the app management key, Supabase publishable key, or service-role key.

The endpoint is exactly:

```text
https://gmxbcdppjxoijuuwanxr.supabase.co/functions/v1/log-later
```

Apple documents **Get Contents of URL** with POST/JSON request bodies, Magic Variables, dictionaries, and If actions. Apple does not publish a stable list of every action label for every iOS release, so the names below must be confirmed on Rich's installed iOS version. The current labels to search for are **Date**, **Dictate Text**, **Count**, **Format Date**, **Get Contents of URL**, **Get Dictionary Value**, **If**, **Speak Text**, and **Stop This Shortcut**.

## Build the Shortcut

Open **Shortcuts**, tap **+**, and name it exactly **Log food later**. Add these actions in order.

### 1. Freeze one capture date/time

Add **Date** and leave it set to **Current Date**. Rename its Magic Variable `Captured Date` if your iOS version offers variable renaming.

Every formatted value below must use this same `Captured Date`. Do not insert a fresh Current Date separately in each action; keeping one value makes the request identity and capture time stable during an in-run retry.

### 2. Dictate and reject an empty result

Add **Dictate Text**:

- Prompt: `What did you eat?`
- Stop Listening: **After Pause** (if shown)

Add **Count**:

- Count: **Characters**
- Input: the blue **Dictated Text** Magic Variable

Add **If**: `Count is 0`.

Inside that If block:

1. Add **Speak Text**: `Nothing was saved.`
2. Add **Stop This Shortcut**.

Leave Otherwise empty, then close with **End If**. Cancelled or empty dictation therefore makes no network request.

### 3. Create the stable request UUID

Add **Format Date**:

- Input: `Captured Date`
- Date Format: **Custom**
- Format String: `yyyyMMdd-HHmm-4ssS-8SSS-yyyyMMddHHmm`
- Time Format: **None**

This produces a UUID-shaped value such as `20260919-1432-4075-8123-202609191432`. It uses one frozen timestamp, satisfies the server's UUID contract, and stays unchanged if the request is retried inside the same run.

### 4. Format the capture fields

Add four more **Format Date** actions, all using `Captured Date`:

1. `yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX` → rename/result meaning: `Captured Timestamp`
2. `yyyy-MM-dd` → `Local Date`
3. `HH:mm:ss` → `Local Time`
4. `XXXXX` → `UTC Offset`

The first result should look like `2026-09-19T14:32:07.123-07:00`; the offset should look like `-07:00`. If the preview does not have those shapes, stop and report what the installed iOS produces before sending a test.

### 5. Send the authenticated JSON request

Add **URL** with:

```text
https://gmxbcdppjxoijuuwanxr.supabase.co/functions/v1/log-later
```

Add **Get Contents of URL**, expand **Show More**, and set:

- Method: **POST**
- Header: `X-Log-Later-Token`
- Header value: paste Rich's **Siri capture key**
- Request Body: **JSON**

Add these seven JSON fields. Use blue Magic Variables; do not type their names in square brackets.

| Key | Type | Value |
|---|---|---|
| `action` | Text | `capture` |
| `request_id` | Text | the UUID-shaped Format Date result from step 3 |
| `note` | Text | Dictated Text |
| `captured_at` | Text | Captured Timestamp |
| `log_date` | Text | Local Date |
| `local_time` | Text | Local Time |
| `timezone` | Text | UTC Offset |

Do not put the key or note in the URL. The key belongs only in the request header. Put **Dictated
Text** directly in the JSON `note` field—do not URL-encode it. Shortcuts performs the JSON escaping;
URL encoding would change ordinary spaces and punctuation into visible encoded text.

The wire request is:

```http
POST /functions/v1/log-later
X-Log-Later-Token: <Rich's capture-only key>
Content-Type: application/json

{
  "action": "capture",
  "request_id": "20260919-1432-4075-8123-202609191432",
  "note": "Lunch salad at Panera",
  "captured_at": "2026-09-19T14:32:07.123-07:00",
  "log_date": "2026-09-19",
  "local_time": "14:32:07",
  "timezone": "-07:00"
}
```

### 6. Speak success only from the acknowledged response

Add **Get Dictionary Value**:

- Key: `ok`
- Dictionary: the output of **Get Contents of URL**

Add **If**: `Dictionary Value is true`.

Inside the If block:

1. Add **Speak Text**: `Saved for later.`
2. Add **Stop This Shortcut**.

Inside Otherwise:

1. Add **Speak Text**: `Saving could not be confirmed. Please try again.`
2. Add **Stop This Shortcut**.

Important: a transport-level failure (no connection, DNS failure, timeout) may cause iOS to stop at **Get Contents of URL** and present its own error instead of reaching Otherwise. That is acceptable for version one because it never speaks “Saved.” If iOS offers **Retry** on that same running action, use it: the frozen request ID and timestamps are reused, so the retry is safe. If the Shortcut has already ended, do **not** blindly run it again; first check the app, because a fresh run creates a fresh ID. This version does not promise offline capture. Duplicate protection for a lost response is verified by the fixed-ID test below.

## First-run permissions versus normal use

The first run may show iOS prompts for:

- microphone/speech recognition for **Dictate Text**;
- allowing the Shortcut to contact `gmxbcdppjxoijuuwanxr.supabase.co`.

Those are one-time OS permission prompts, not part of normal capture. Review the host carefully, then allow it. The Shortcut contains a bearer secret, so do not share an iCloud Shortcut link or screenshots that reveal the header value.

## First phone tests

Do these in order and record the result. Until completed, phone behavior is **pending**, not verified.

1. From the Shortcuts app, run **Log food later** and say `Lunch salad at Panera`.
   - Expected: it speaks `Saved for later.`
   - It must not open Safari or the Carb Counter.
   - Open the Carb Counter afterward. Expected: one amber **Needs logging** row at the original local time, plus the all-dates count.
2. Say `Hey Siri, log food later`, dictate a different note, and confirm the same behavior.
3. Cancel dictation or stay silent.
   - Expected: `Nothing was saved.` and no new reminder.
4. Temporarily disable Wi-Fi and cellular access, then run it.
   - Expected: it never says `Saved for later.` iOS may show its own network error.
5. Temporarily replace one character of the capture key and run it.
   - Expected: it never says success; restore the exact key immediately.
6. Run from the Lock Screen.
   - Record whether Siri permits dictation and the HTTPS request without unlocking. Apple notes that shortcuts which open apps require unlocking; this Shortcut does not open an app, but actual locked-phone behavior still depends on the installed iOS version and permissions.
7. Return to the website after a Siri capture.
   - Expected: pending state refreshes when the site becomes visible without disturbing an already-open modal/editor.

## Fixed-ID lost-response/idempotency test

This deliberately sends the same identity and content twice.

1. Temporarily replace the step-3 Format Date Magic Variable in the JSON `request_id` field with:

   ```text
   11111111-1111-4111-8111-111111111111
   ```

2. Temporarily replace Dictated Text in `note` with fixed text `iPhone retry test` so both requests are byte-for-byte equivalent.
3. Run twice. Both may receive success, but the website must show exactly one pending note.
4. Change only the fixed note and run again with the same ID. Expected: conflict/failure, never success.
5. Restore both Magic Variables immediately, then discard the one test reminder in the app.

## Finish-flow phone check

For one real pending note:

1. Tap it → **Finish logging**.
2. Choose two saved foods and portions.
3. Tap **+ Add missing food**, create one food, and confirm the unfinished resolution returns intact.
4. Cancel once; confirm the reminder remains.
5. Reopen and save. Confirm the pending row disappears only after the real entries appear, the original local date/time are retained, and totals include only the real foods.

Also verify the existing **Log my food** and **Scan a food** Shortcuts still behave exactly as documented in `VOICE-SHORTCUT.md` and `LABEL-SHORTCUT.md`.

## Validation record — September 19, 2026

Confirmed on the deployed backend and Rich's iPhone:

- the backend smoke test passed;
- the Shortcut received `ok = true` from the capture endpoint;
- the new row appeared in `pending_food_items` with the expected owner and pending status;
- the website displayed the reminder after Rich's management key was restored in that browser.

This also confirmed an important operational detail: the Siri capture key and website management
key are independent. A successful Shortcut does not prove that the current browser still has its
management key.

The remaining checklist items above have not been individually reported as completed, so network
failure behavior, invalid-key behavior, Lock Screen behavior, the fixed-ID retry test, and the full
multi-food finish flow remain real-device checks rather than documented passes.

Apple references:

- API requests / JSON request bodies: https://support.apple.com/guide/shortcuts/apd58d46713f/ios
- Magic Variables: https://support.apple.com/guide/shortcuts/apdd2c2780c/ios
- Dictionaries: https://support.apple.com/guide/shortcuts/apd43b69f337/ios
- If actions: https://support.apple.com/guide/shortcuts/apd83dcd1b51/ios
- Run a Shortcut with Siri: https://support.apple.com/guide/shortcuts/apd07c25bb38/ios
