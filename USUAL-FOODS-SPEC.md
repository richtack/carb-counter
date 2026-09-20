# Usual foods: a reversible phone experiment

Status: proposal for Rich to adapt; not implemented.
Date: September 19, 2026.

## Goal

Make everyday food logging easier on a phone without typing or navigating categories. Test whether actual logging history produces a more useful set of quick choices than manually selected favorites.

The first experiment combines a compact three-column grid with a choice between **Most used** and **Favorites**. It preserves existing favorites and all current logging interactions.

## Recommended version-control setup

The inspected web-app folder is not currently a Git repository. Git records recoverable versions locally; GitHub is an optional remote copy. GitHub is not a prerequisite for this work, and putting source there does not require moving the live website or its data.

Before changing application code:

1. Make a dated backup of the current source and existing deployment bundle. Record the current live deployment so it can be restored. Verify that the baseline source corresponds to the working app rather than assuming it does.
2. Prefer a development copy outside Dropbox, in a new dedicated web-app folder under `~/Developer`. Keep it separate from the existing `carb-counter-ios` project. Leave the original folder intact until the new working location is verified.
3. Initialize Git in that development copy. Add exclusions before the first commit: real configuration, credentials, local tool state, generated deployment output, exports, and backups. Keep `config.example.js` as the configuration template. Review the files being committed.
4. Commit the working baseline on `main`, then create `experiment/usual-foods` for implementation.
5. Optionally push to a private GitHub repository for backup. Retain manual deployment during this experiment so publishing a branch cannot unexpectedly update the live app.

A branch protects source history; it does not isolate live data. Preview testing must use fixtures or an isolated test configuration, especially when testing logging, deletion, or editing. No production data migration is planned.

## Proposed screen

In the existing category view, replace the Favorites heading/section with:

```text
USUAL FOODS
[ Most used ] [ Favorites ]

[ Food A ] [ Food B ] [ Food C ]
[ Food D ] [ Food E ] [ Food F ]
[ Food G ] [ Food H ] [ Food I ]

CATEGORIES
(existing category controls and food lists)
```

- Default to **Most used** when the experiment is first enabled.
- Most used shows at most nine foods; do not add empty placeholder cards.
- Favorites shows every saved favorite, including lists longer than nine. Do not cap or remove existing favorites.
- Remember the selected mode locally, separately for each person. Device-to-device preference syncing is outside this trial.
- Keep the existing search and A–Z view behavior. Usual foods appears only in the category view while search is empty, matching where Favorites appears today.
- No new letter navigator or category redesign in this version.

## Compact cards

- Apply three columns to the Usual foods section only. Existing category tiles, category food cards, and search/A–Z results retain their layout.
- Stack food name, serving description, and net carbs vertically. Reuse existing number formatting and displayed serving values.
- Allow names to wrap and rows to grow. Do not hide distinguishing words, shrink text aggressively, or let the star overlap a name.
- Retain the star for genuine saved favorites; appearing in Most used does not make a food a favorite.
- Preserve tap to log one serving, hold for portion selection, feedback, and protection against a hold also logging a tap.
- Use a separate grid container with narrowly scoped styles; the current `.food-grid` also contains category controls, so changing its global column count would affect more than this experiment.
- Aim for three columns at normal phone text sizes. Permit two columns on narrow screens or with enlarged text when needed for legibility. Verify on Rich's actual phone before accepting the design.

## How Most used is chosen

Use a simple, explainable rule for the first trial:

1. Read this person's confirmed log entries for the last 30 local calendar dates, including today. The window is anchored to today, not whichever historical day is being viewed.
2. Match entries to currently available foods by stable food ID, not food name.
3. Count logging occasions: each saved entry with positive quantity contributes one use. A two-serving entry is one use, not two. Exclude deleted entries, unsaved/failed additions, unresolved Log later notes, entries without a food ID, and foods no longer in the catalog.
4. Rank by number of uses. Break ties by most recent log date, then alphabetical food name, then food ID.
5. Select the first nine, then display those nine alphabetically. Frequency chooses membership; alphabetical order makes positions easier to scan.

Confirmed entries from voice logging or completed Log later items count like other entries when they reference a saved food. This rule measures recorded logging occasions, so someone who splits one meal into several entries can influence the ranking; do not introduce speculative deduplication in the first version.

Do not mix unused favorites into Most used merely to fill nine slots. With no qualifying history, show “Your usual foods will appear as you log meals,” with a button to show Favorites. With fewer than nine foods, show the available foods.

## Loading, stability, and failure behavior

- Keep usage history separate from the selected day's entries. The app currently loads only one day's entries; ranking that array would incorrectly produce “Most used today.”
- Load history without blocking logging, navigation, or the normal daily total. Retrieve the complete 30-day result, handling any result limits; never silently rank a truncated response.
- Use existing person scoping for history and scope any new local preference/cache by person. Ignore late responses belonging to a previously selected person.
- Freeze the chosen set during an active logging session so tapping a food cannot immediately replace or move nearby cards. Refresh membership on a fresh app load or a return to the app after at least 15 minutes away. A manual refresh control is unnecessary for the first trial.
- Food edits must still update visible names/servings, and deleted foods must disappear. These catalog changes are exceptions to the frozen set.
- If history cannot load, show “Most used is unavailable right now” and an explicit Favorites fallback. Never present favorite foods as if they were usage results. Other app functions remain usable.
- No new database tables, schema changes, stored rankings, tracking service, or changes to logging writes are required by this proposal.

## Reversibility and rollout

Add a local, person-specific setting named **Try Usual foods**, initially off. Off uses the existing Favorites section and layout; on enables the new section. Changing this setting must not change favorites or log data.

1. Build and verify in the experiment branch using isolated data.
2. Preview six and nine cards on Rich's phone. Six in two rows should occupy less height than the current six-card section; nine in three rows should offer more choices without an unacceptable height increase. Measure the rendered result, since wrapping and the mode switch consume space too.
3. Deploy only after the preview is accepted, using the existing deployment packaging and service-worker update process. Enable the trial for Rich; other users remain on the existing experience unless they opt in.
4. Try Most used for about a week, switching to Favorites for comparison whenever useful.
5. If the experiment is unhelpful, turn it off immediately. If code rollback is needed, restore the baseline code with a fresh service-worker cache version so installed phones receive it. Code rollback does not undo any real foods logged during the trial.

## Acceptance checks

- Existing favorites are identical before enabling, after switching modes, and after disabling the experiment.
- Turning the experiment off restores the previous section and phone layout.
- Ranking checks cover window boundaries, separate people, ties, deleted/missing foods, zero or fewer-than-nine results, quantity versus frequency, and complete results across retrieval limits.
- Most-used history never changes the selected day's entries, totals, exports, or history display.
- A failed history request leaves normal logging usable and offers the labeled Favorites fallback.
- Tap logs exactly once; hold opens portions without logging prematurely; both work in either mode and in the legacy view.
- Adding, deleting, undoing, editing quantity/time, and viewing a past day continue to work. Switching modes does not reset the selected category or date.
- Search, A–Z, My Foods, personal favorite editing, voice review, label scanning, and Log later retain their existing behavior. Run the existing relevant automated checks and a focused manual smoke test.
- On phone and desktop, long names, enlarged text, stars, and serving/carbs lines remain readable, with no horizontal overflow or interference from floating controls.
- Installed-app refresh loads the intended version; disabling the trial remains available after reload.

## How to judge the experiment

After a week, ask: Are most meals reachable from the first nine foods? Is Most used more useful than Favorites? Are three-column cards comfortable to read and tap? Is there noticeably less scrolling?

No new analytics are necessary. If membership is poor, revisit the time window or ranking rule before adding more controls. If the grid is cramped, keep the behavior-based selection and return to two columns. The two ideas can succeed independently.
