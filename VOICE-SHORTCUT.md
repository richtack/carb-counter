# Voice logging prototype: iPhone setup

This first version keeps the Shortcut simple: it dictates a sentence, opens the Carb Counter,
matches the words against foods already in **My Foods**, and asks you to review everything before
anything is saved. It does not invent nutrition values and it does not put a Supabase key in the
Shortcut.

## Before building the Shortcut

1. Deploy this updated app to Rich's Netlify site (and Gen's site when she is ready to use it).
2. Open the deployed site once in Safari so the new app version is loaded.
3. Copy the exact site address from Safari. `START_HERE.md` currently shows
   `https://rt-carb-counter.netlify.app`, but confirm that this is the address you actually use.

## Build “Log my food”

Open **Shortcuts**, tap **+**, name the shortcut **Log my food**, then add these actions in order:

1. **Dictate Text**
   - Prompt: `What did you eat?`
   - If shown, leave **Stop Listening** set to **After Pause**.
2. **URL Encode**
   - Set it to **Encode** the **Dictated Text** from step 1.
   - On some beta releases, search for `Encode URL` if `URL Encode` is not listed.
3. **Format Date**
   - Input: **Current Date**.
   - Date Format: **Custom**.
   - Format String: `yyyy-MM-dd`
   - Time Format: **None**.
4. Add a second **Format Date** action.
   - Input: **Current Date**.
   - Date Format: **Custom**.
   - Format String: `yyyyMMdd-HHmmss-SSS`
   - Time Format: **None**.
   - This value is the one-time draft ID that prevents a retry from logging a meal twice.
5. Add a **Text** action. Enter this as one line, replacing `YOUR-APP-URL` with the address copied
   from Safari:

   ```text
   YOUR-APP-URL/#voice=[URL Encoded Text]&date=[First Formatted Date]&draft=[Second Formatted Date]
   ```

   Do not type the words in square brackets. Insert each result as a blue **Magic Variable**:
   the output of URL Encode, then the first Format Date, then the second Format Date.
6. Add a **URL** action and give it the **Text** from step 5.
7. Add **Open URLs** and give it the **URL** from step 6.

Apple changes some action labels between beta releases. If one of these names differs on the
installed iOS version, stop there and note the closest actions shown; do not add **Get Contents of
URL** and do not paste a Supabase key into the Shortcut.

## First phone test

Run **Log my food** and say:

> I had two eggs, half a serving of my yogurt, and one slice of keto bread.

Expected behavior:

- The Carb Counter opens to **Review voice meal**.
- The yogurt and bread match only if the saved names make them unambiguous.
- “Two eggs” may ask for help when more than one egg food is saved. Pick the intended food; the
  serving count should update from that food's saved serving definition.
- **Save meal** stays disabled until every kept item has a saved food and a valid serving count.
- **Skip** removes an unknown item from this meal; **Cancel** writes nothing.
- Tapping **Save meal** once adds the whole meal. Retrying the same draft cannot add a second copy.

Also test one unknown food, a fractional amount, and Cancel. Then run the Shortcut once from the
Home Screen and once while the installed PWA is already open. Record whether **Open URLs** returns
to Safari or the home-screen app; that routing behavior needs to be verified on the actual phone.

The app shell can still open offline, but voice saving requires a connection to Supabase.
