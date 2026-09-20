# Nutrition label scanner — implementation spec

Date: September 19, 2026
Status: Approved direction; scanner implementation has not begun in this planning task.

## Objective

Let Rich photograph a nutrition label with an iPhone Shortcut, then review a prefilled new-food form in the existing website. He supplies the food name and saves explicitly. Preserve the working voice workflow, shared food library, and personal logs/settings.

Rich reports the voice feature works well enough. He uses an iPhone 16 Pro Max; last reported OS was iOS 27 beta with an upgrade planned. Verify current OS/action names during phone setup, not by assuming the upgrade happened.

## Read before editing

Read applicable AGENTS.md, ../Working-With-Rich.md, START_HERE.md, VOICE-SHORTCUT.md, app.js, voice-logging.js, voice-logging.test.js, index.html, styles.css, and service-worker.js. Inspect current files rather than assuming they still match this snapshot. SHORTCUTS-HANDOFF.md supplies historical context but predates the working voice implementation.

Current inspected architecture: plain HTML/JavaScript, Netlify deployment, Supabase storage. Voice uses URL-encoded text in a URL fragment, parses in the browser, and reviews before saving. It does not require API credentials in Shortcuts. Reuse that pattern. No native iOS app, hosting migration, paid AI dependency, or database migration is planned.

## User flow

1. Run “Scan a food.” Choose Take Photo or Select Photo.
2. Shortcut runs Apple's Extract Text from Image action.
3. Shortcut URL-encodes the recognized text and opens the website with a label draft in the fragment.
4. The app parses the text and opens an editable new-food review.
5. Rich types the name, reviews/corrects values, optionally selects category/favorite, and saves once.
6. The food is available in the existing shared food list. Do not also log a meal.

Start with OCR plus deterministic JavaScript parsing. If representative labels expose substantial limitations, report them and evaluate Apple's Use Model action; do not silently introduce a cloud AI service. Model output would still require validation.

## Review fields and behavior

- Name: required and initially blank; do not guess from nutrition-panel text.
- Serving size: editable text, retaining household measure and gram/milliliter amount when present.
- Calories: per serving, editable, blank means unknown rather than zero. Capture scanned calories even if the normal calorie display preference is off; decide the least intrusive way to expose this during review without losing data.
- Total carbohydrate, dietary fiber, sugar alcohols: editable grams for the same serving basis.
- Net carbs: computed in code using the app's existing convention, with transparent inputs. Do not change nutritional policy as part of scanning.
- Missing/unreadable nutrients stay blank and are flagged. Do not silently turn missing deductions into measured zero. Allow the user to explicitly use zero for an absent deduction or supply net carbs manually, without forcing unnecessary entry when the label is incomplete.
- Show recognized source text in a collapsed detail area so values can be checked. The photo is not transferred to the website in this version; do not promise an in-app photo preview.
- Cancel writes nothing. Saving requires a name and valid net carbs; unknown calories remain allowed. Preserve current food semantics and historical logs.

## Parsing boundaries

Target common English-language US Nutrition Facts panels first. Recognize typical capitalization, whitespace, line breaks, decimals, and separated labels/values when unambiguous.

Do not confuse grams with daily-value percentages, servings per container with serving size, total sugars with sugar alcohols, or calories with calories from fat. Never derive fiber or carbohydrates from percentages.

For per-serving/per-container/per-100g or as-packaged/as-prepared columns, only prefill a set when the column association is unambiguous. Otherwise flag the basis for manual review and leave uncertain values blank; never silently take the first number. OCR can destroy column layout, so broad reliable multi-column extraction is not a first-version promise.

Treat “less than 1 g” as an inequality needing review rather than exactly 1 or 0. Reject or flag impossible deductions/negative results rather than hiding them through clamping. Non-US conventions or unsupported formats should fall back to manual review rather than automatic subtraction.

## Integration and resilience

Use a distinct fragment route (for example #label=...&draft=...), following current voice conventions. Document the final contract. Include a unique draft ID and prevent repeated saves/reopened links from creating duplicate foods, including retries after uncertain network responses. Inspect existing voice idempotency for reuse; do not rely only on disabling a button.

Validate and bound incoming text; handle empty OCR, malformed encoding, long payloads, and HTML-like content safely. Clear consumed fragments as the voice implementation does. Do not include credentials or photo bytes in links. Check practical link lengths on the phone; never silently truncate nutrition data.

Retain manual Add food, food editing, and voice import behavior. Avoid replacing an active unsaved review without an explicit user choice. Saving still requires the existing network connection; do not claim offline save support.

Keep parsing separate and testable. Prefer the existing food-save path and a draft-prefill extension rather than duplicating database logic. No backend changes are expected, but verify current code before deciding.

## Acceptance checks

- A straightforward single-column label prepopulates serving, calories, and gram values correctly.
- Daily-value percentages and unrelated sugar values are never substituted for nutrients.
- Missing calories remain unknown; explicit zero remains zero.
- Missing fiber/sugar alcohols are visible as missing and can be resolved explicitly.
- Multi-column ambiguity and less-than values require review.
- Edited values recalculate net carbs correctly; invalid values cannot be saved unnoticed.
- Cancel has no persistence; Save creates one shared food, no log entry, and reopening/retrying the same draft does not duplicate it.
- Existing voice tests and appropriate manual-food regression checks pass.
- Verify safe rendering, malformed/oversized input, failed saves, and retry behavior.
- Test actual Shortcut routing in Safari and the installed PWA, with three to five real labels Rich uses. Real phone/OCR validation remains pending until performed; synthetic parser fixtures do not establish OCR accuracy.

## Deliverables

1. Working app changes and meaningful parser/integration tests.
2. LABEL-SHORTCUT.md with exact action order, variables, final URL format, and a first-phone-test checklist. Verify current Apple action documentation; don't invent an installable Shortcut file if tooling cannot generate/sign one.
3. Updated orientation notes and service-worker cache version as appropriate.
4. Clear deployment instructions for the existing Netlify workflow and both household deployments. Check publish contents so development notes/private files are not unintentionally included.
5. A concise report distinguishing implemented/tested behavior from pending phone validation.

Start implementation and local verification autonomously. Ask Rich only for missing information that blocks progress. Request representative labels when useful while continuing work on independent code. Do not claim production deployment or phone tests that have not happened.

## Execution recommendation and starter prompt

Suggested coding model: GPT-5.6 Sol, High reasoning. This is the coding assistant setting, not the scanner's runtime model. No subagents are required.

Starter prompt:

“Read NUTRITION-LABEL-SPEC.md and implement the nutrition-label scanner in this project. Preserve the working voice shortcut and existing app behavior. Start with Apple Shortcuts text recognition and browser parsing, then a prefilled review before saving. Complete local tests and provide precise Shortcut setup and deployment instructions. Clearly identify anything requiring my iPhone or real label photos to validate.”
