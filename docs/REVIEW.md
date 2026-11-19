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
- R16 (2026-11-19, X-11 research): a research or review brief must name its only writable output folder and forbid writes elsewhere. Repository edits belong on an assigned worktree branch. Check: run `git --no-optional-locks -C <shared-checkout> status --porcelain` before and after the run. A clean checkout must stay clean. Preserve and compare any pre-existing changes.
- R17 (2026-11-19, N-08): bind each reviewer reply to its reserved packet and the replay to the sealed blind-case digest and candidate. Check: reuse a dispatch after interruption, submit a stale replay, then submit the matching replay with the judge unavailable. Both missing proofs must leave verification on HOLD.
- R18 (2026-11-19, N-08): reconcile a gate receipt before relaunching its command. Check: interrupt between the durable receipt and the run checkpoint, resume with the same ID and count one execution of the completed gate. Replay a failed launch and a neighboring successful launch.
- R19 (2026-11-19, N-08): rehash package bytes when resuming a recorded review and match the judge's digest to the reviewer's. Check: verify the original fixture, replace its bytes at the same path and expect HOLD on the saved digest.

- R20 (2026-11-19, N-08): print a noninteractive Windows PowerShell 5.1 dispatch command with a process-scoped execution policy and use the native exit code after capturing stderr. Check: run the printed command from a path containing spaces, an apostrophe and accented text. Have a fake Codex write progress to stderr and return 0, then 17. Verify the reply and both exit codes.
- R21 (2026-11-19, N-08): every packet consumed as JSON must name its role and request exactly one raw JSON object. Check: inspect all five role briefs and pass raw, singly fenced, malformed and non-object replies through both the card and report readers. Invalid replies must give a specific HOLD reason.
- R22 (2026-11-19, N-08): authorize sequential rule appends on every fix and require them on corrective commits after a failed gate or review. Check: replay a feature and a correction with both kinds of subject, reject altered prior rules and missing checks, and verify that the blind packet contains base rules while the replay and judge receive candidate rules.

- R23 (2026-11-19, N-08): generate and remove CI bundles in a run-owned copy of the candidate. Check: run the actual gate workers with tracked, ignored and absent dictionaries, inspect the ticket checkout after each gate and compare pre-existing bundle bytes.
- R24 (2026-11-19, N-08): require an explicit test-only override for Windows factory volume limits. Check: reject C: and less than 20 GB in production, opt a synthetic run into both and check that children do not inherit the override.
- R25 (2026-11-19, N-08): a gate retry on the same candidate and phase keeps its verified green receipts. Check: fail Vitest, retry and compare the launch order and the first three receipt paths and hashes.
- R26 (2026-11-19, N-08): check the review ledger before replacing a round or starting gates. Mark the candidate failed when a review closes on HOLD. Check: reopen a pass with one and three slots used, resume a pending dispatch and compare verdict, round and gate receipts.
- R27 (2026-11-19, N-08): preserve SystemDrive and COMPUTERNAME when isolating Windows child processes. Check: set both in the parent and read both from the child environment.
- R28 (2026-11-19, N-08): persist the offline pause reason and next poll from trial receipts even if the schedule is missing. Check: replay a duplicate proposal, both trial caps and today's completed trial with missing or stale schedules.
- R29 (2026-11-19, N-08): derive the tour directory in a fresh terminal from the worktree path printed by plan. Check: follow the guide with a worktree containing spaces on another project volume.
- R30 (2026-11-19, N-08): Text sent to an external reviewer can be altered by the provider's privacy filter (for example 127.0.0.1 becomes [IP_ADDRESS]); before acting on a finding that quotes a placeholder, grep the real file. Check: use git grep on the cited revision and compare the literal at each reported location.
