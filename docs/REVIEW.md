# Filow review rules (grows after every bug)

Every reviewer reads this file first. When a review or a test finds a bug or a mistake and it is fixed, add one rule here in the same commit: `R<n> (<date>, <ticket or commit>): <rule>. Check: <how to check>.` Never delete a rule; mark it `superseded by R<m>` instead.

Limit: at most 3 rounds of review, critic, devil's advocate, council or arena per change. After round 3, keep the last version that passed the gate, list the open findings, and ask the owner.

## Rules learned so far

- R1 (2026-11-17, audit C6/C12/C23/C27/C28): a speech heuristic fix (regex, word lists, number words) is judged on a labelled EN/IT sentence set, never on single examples. Check: the set exists and the score did not drop.
- R2 (2026-11-17, review-2 R5/R6): a fix that adds an exclusion must keep the old true cases. Check: test both the new case and 2 ordinary sentences that used to work (including a normal count statement).
- R3 (2026-11-17, R1 guard): a negation check works on the clause of the point's subject, not the whole sentence. Check: "Costs fell while sales did not drop" and "Costs, despite weak demand, did not drop".
- R4 (2026-11-18, O2 rounds 1-5): never hold a window interactive with renderer-held state. Bound every interactive area by geometry the main process can check. Check: lost pointerup, renderer crash, reload, two windows.
- R5 (2026-11-18, O2 hit area): any cap or clip must keep the item's controls clickable. Check: an oversized item and its move handle and close button.
- R6 (2026-11-18, gallery): a layout that changes row count must recompute its height. Check: close items in a moved multi-row gallery.
- R7 (2026-11-18, TK-14): a cleanup applied to shared parsers must not change other callers. Check: differential test against main's parser on 30+ inputs; the whiteboard path unchanged.
- R8 (2026-11-18, integration review 3): a merged change must be checked against the other branches merged in the same candidate (same files, same assumptions). Check: list files touched by two branches and test each.
- R9 (2026-11-18, docs pruning): when you remove duplicated docs, unique facts move behind a pointer, never disappear. Check: grep the removed text for numbers, decisions, commands and paths; each still exists somewhere tracked.
- R10 (2026-11-18, release script): a release step pushes only a recorded, verified full SHA, from a clean local main, and stops on every non-zero exit. Check: offline tests for a moved tag, a rejected push, missing evidence and a non-main checkout.
- R11 (2026-11-18, qa.test.ts): a test that passes on CI but fails locally can be a missing generated file, not a bug. Check: generate the CI bundles first (as the workflow does), then judge.
- R12 (2026-11-18, mic opening): a "ready" signal (cue, listening state) fires only after the device is really capturing, and a release during opening cancels it. Check: a short hold while the audio graph is still loading.
- R13 (2026-11-18, live C26 check): a single-device test must distinguish application faults from OS-level shortcut conflicts. Check: probe the OS registration before blaming the code.
- R14 (2026-11-18, model routing): the builder never reviews its own work; consequential reviews use a fresh context and a different vendor. Check: the review names its model and context.
- R15 (2026-11-19, N-08): a clean-clone factory walkthrough uses a tracked synthetic practice ticket and checks credential readiness without exposing secrets. Check: replay the preflight with missing and configured providers, then confirm all three verbs use the documented practice ID.
