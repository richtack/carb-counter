# Nutrition-label Shortcut: iPhone setup and testing

This is a separate Shortcut named **Scan a food**. Do not edit or replace the working
**Log my food** voice Shortcut.

The Shortcut photographs or selects a nutrition label, uses Apple's on-device text recognition,
and opens a review in the Carb Counter. Nothing is saved until you type a name and tap **Save
food**. Saving adds one shared food to **My Foods**; it does not log a meal. No Supabase key,
photo, or cloud-AI account goes into the Shortcut.

## Before you build it

1. Deploy the updated app to both household Netlify sites using the deployment steps below.
2. On the iPhone, open Rich's deployed site once in Safari and confirm the header says
   **Rich's Carb Counter**.
3. Copy the exact address from Safari. Use the plain site address, with no text after
   `.netlify.app` and no existing `#` fragment. The expected address in the project notes is
   `https://rt-carb-counter.netlify.app`; confirm it on the phone rather than assuming it.
4. Go to **Settings → General → Language & Region** and confirm **Live Text** is on.

Apple's current guides still document **Choose from Menu**, **Open URLs**, Magic Variables, and
Live Text. Apple does not provide a stable public list of every built-in action label, so the one
item to verify on the actual phone is the text-recognition action. Search first for **Extract Text
from Image**. If the installed iOS calls it **Extract Text from Images**, use that equivalent.
Do not substitute **Get Contents of URL** or an Apple Intelligence/model action.

Apple references:

- Choose from Menu: https://support.apple.com/guide/shortcuts/apdd7bf369da/ios
- Magic Variables: https://support.apple.com/guide/shortcuts/apda36b9018b/ios
- Open URLs: https://support.apple.com/guide/shortcuts/apdaf74d75a5/ios
- Live Text: https://support.apple.com/guide/iphone/iph37fdd714b/ios

## Build “Scan a food”

Open **Shortcuts**, tap **+**, name it **Scan a food**, and add these actions in this order.

1. Add **Choose from Menu**.
   - Prompt: `How do you want to scan the label?`
   - First option: `Take Photo`
   - Second option: `Select Photo`
2. Under the **Take Photo** branch, add **Take Photo**.
   - Camera: **Back**
   - Number of photos: **1**
   - Leave the camera preview on.
3. Under the **Select Photo** branch, add **Select Photos**.
   - Turn **Select Multiple** off.
4. Immediately below **End Menu**, add **Extract Text from Image**.
   - Its input should be the blue **Menu Result** variable. If Shortcuts connected it
     automatically, tap the input once to confirm it says **Menu Result**.
5. Add **Count**.
   - Change the count type to **Characters**.
   - Input: the blue **Text from Image** result from step 4.
6. Add **If** and set it to `Count is 0`.
   - Inside it, add **Show Alert** with: `No text was found. Retake the photo straight-on in good light.`
   - Then add **Stop This Shortcut**.
   - Leave **Otherwise** empty, then close with **End If**.
7. Add another **If** and set it to `Count is greater than 8000`.
   - Inside it, add **Show Alert** with: `This scan contains too much text. Crop or retake the photo around only the Nutrition Facts panel.`
   - Then add **Stop This Shortcut**.
   - Leave **Otherwise** empty, then close with **End If**.
8. Add **URL Encode**.
   - Set it to **Encode** the blue **Text from Image** result—not the character Count.
   - If search shows **Encode URL** instead, use it with the same settings. This is the same
     action already used by the working voice Shortcut.
9. Add **Format Date**.
   - Input: **Current Date**.
   - Date Format: **Custom**.
   - Format String: `yyyyMMdd-HHmmss-SSS`
   - Time Format: **None**.
   - This is the one-time draft ID that makes a retry safe.
10. Add **Text**. Enter one line, replacing `YOUR-APP-URL` with the address copied from Safari:

    ```text
    YOUR-APP-URL/#label=[URL Encoded Text]&draft=[Formatted Date]
    ```

    Do not type the words in square brackets. Insert the two blue Magic Variables: first the
    output from **URL Encode**, then the output from **Format Date**. There must be no spaces around
    `#label=`, `&draft=`, or the variables.
11. Add **URL** and set its input to the blue **Text** result from step 10.
12. Add **Open URLs** and set its input to the blue **URL** result from step 11.

The final handoff contract is:

```text
https://YOUR-SITE.netlify.app/#label=<URL-encoded OCR text>&draft=<unique 1–100 character ID>
```

The app accepts at most 8,000 recognized characters, clears the fragment from browser history,
and renders the recognized text as plain text. It never puts credentials or image bytes in the URL.

## First-phone test checklist

Use three to five real foods you actually eat. For the first photo, fill most of the camera frame
with a straight, well-lit, single-column US **Nutrition Facts** panel.

1. Run **Scan a food → Take Photo**.
2. Confirm the Carb Counter opens to **Review scanned label**.
3. Confirm **Name** is blank. The app must not invent the product name.
4. Compare serving size, calories, total carbohydrate, dietary fiber, and sugar alcohols with the
   physical label. Open **Recognized text from the photo** if anything looks wrong.
5. Confirm net carbs equal `total carbohydrate − fiber − sugar alcohols` for the same serving.
6. Change fiber by 1 gram and confirm net carbs immediately change by 1 gram; then restore it.
7. Type a temporary name, then tap **Cancel**. Confirm the food is absent from **My Foods** and
   nothing was added to today's log.
8. Run it again, review carefully, type the real name, optionally choose category/favorite, and tap
   **Save food** once. Confirm it appears once in the shared **My Foods** list and not in today's log.
9. Run **Select Photo** with a label already in Photos and confirm the same review opens.
10. Test one label with no sugar-alcohol line. That field should stay blank and be flagged. Enter
    `0` only if the physical label supports zero, or type the label's own net-carb value manually.
11. Test a label containing `less than 1 g`. The app should leave that nutrient blank for your
    decision, not silently use 0 or 1.
12. If you have a per-serving/per-container or as-packaged/as-prepared panel, confirm the app warns
    about multiple bases and leaves uncertain nutrition values blank.
13. Run once from the Shortcuts app, once from the Home Screen or Siri, and once while the installed
    Carb Counter PWA is already open. Note whether **Open URLs** returns to Safari or the installed
    PWA; iOS decides that routing and it must be observed on this phone.

### Optional retry test

To prove duplicate protection on the phone, temporarily replace the blue **Formatted Date** token
in step 10 with the fixed text `iphone-retry-test-1`. Save a test food once, then run the Shortcut
again without changing that fixed ID. The app should say the scanned food was already saved and
must not add a second copy. Restore the blue **Formatted Date** token immediately afterward, then
delete the one test food from **My Foods**.

## Deploy to both household sites

The current `config.js` uses the website hostname: a hostname containing `gen` opens Gen's data;
any other hostname opens Rich's data. Both sites use the same shared food list.

1. In Terminal, open the project folder and run:

   ```bash
   node voice-logging.test.js
   node label-scanning.test.js
   node label-integration.test.js
   node prepare-deploy.js
   ```

2. A folder named **netlify-publish** appears inside the project. It contains only the 12 runtime
   files needed by the app. Do not drag the whole source project to Netlify; that would also publish
   planning notes and tests.
3. In Netlify, open the existing Rich site, go to **Deploys**, and drag **netlify-publish** into the
   manual deploy area.
4. Open the existing Gen site and drag that same **netlify-publish** folder into its manual deploy
   area. Manual drag-and-drop deploys do not use build minutes.
5. Open each site once in Safari. Verify the two headers say **Rich's Carb Counter** and **Gen's Carb
   Counter** respectively. The service-worker cache is now `ncc-v28`; closing and reopening should
   load it. If an old version persists, close every app/Safari tab for that site and reopen it.
6. Build Rich's Shortcut with Rich's exact site URL. Build a separate copy for Gen only if she wants
   scanning, using Gen's exact site URL.

Local parser/browser tests cannot establish real camera OCR quality or Safari-versus-PWA routing.
Those two items remain pending until this checklist is performed on the iPhone with real labels.
