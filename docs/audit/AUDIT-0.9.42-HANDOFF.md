# Handoff: Filow 0.9.42 audit (2026-11-16)

For the next agent (or for the owner) picking up this work. Read this first, then `bug-report.md`, then `plan-review.md`.

**In breve (IT):**
- **Diciassette bug dimostrati da prover indipendenti** in quattro passate (C1-C12, C15-C19), ognuno con test che fallisce prima e passa dopo, e con patch testata.
  - I più gravi: C3, i nomi sbagliati dopo l'anonimizzazione; C2, il dettato che può invertire il senso; C12, il matcher che si blocca su "later" o "alla fine"; C8, le chiamate di decisione a pagamento che continuano dopo il timeout.
  - C13 (seed S2) è stato respinto: è il comportamento voluto e testato, quindi diventa la richiesta di modifica TK-14.
  - C14 (la causa sospetta del seed S1) è inconcludente: serve Windows.
- **Albero con le patch:** 3808 test passati, gli stessi 23 fallimenti d'ambiente del baseline, typecheck e lint puliti.
- **Fatto:** le correzioni sono sul branch locale `claude/audit-fixes-0.9.42`, un commit per difetto, scaricabile come bundle o serie di patch (cartella `git/`).
- **Prossimi passi:** i controlli su Windows con `WINDOWS-CHECKS.md`; poi le prove rimaste (TK-13) e la decisione su TK-14.
- **Note per l'agente di autoresearch:** nella sezione 6.

## 1. Where things are

| What | Path |
|---|---|
| Original source (read-only, never edit) | `filow-70cc3f6.zip`, sha256 `380ff0ab4063be81ac80beb85c127f598cb85a9851c4ae2ffe12a08bdb6f33ae`; extracted at `/workspace/src/filow` in the audit sandbox |
| Patched tree (the "new zip") | `filow-0.9.42-audit.zip` = original + 12 fixes in 13 files + 13 new test files + `docs/audit/AUDIT-0.9.42-HANDOFF.md` (this file) |
| The same changes as one patch | `evidence/patches/filow-0.9.42-audit.patch`. Apply from the repo root with `git apply`. It was checked on a fresh extraction of the zip, which has CRLF line endings. On a git checkout with `core.autocrlf=true` on Windows, run `git apply --check` first. If it complains about whitespace, try `git apply --ignore-whitespace`. |
| Git branch with the fixes | local branch `claude/audit-fixes-0.9.42` in the sandbox repo, not pushed. It holds one commit per defect (C3, C2, C8, C1, C5, C4, C9, C6, C7, C10, C11, C12), the behaviour tests, this handoff, the C2 extension, then C15, C16, C17, C18, C19: 20 commits. Downloadable as `git/filow-audit-fixes.bundle` (`git fetch <bundle> claude/audit-fixes-0.9.42:claude/audit-fixes-0.9.42`) or as `git/patch-series/*.patch` (`git am`). `git/commit_fixes.sh` made the first 13 commits; the later ones were made by the lead directly. The bundle and the series are the source of truth. Checked on the branch: vitest 3807 passed, 24 failed, where the 24th is `apps/desktop/s1-setup.test.ts`, which fails identically on 70cc3f6 with an LF checkout because it expects CRLF in `installer.nsh`; typecheck and lint clean |
| Windows check guide | `WINDOWS-CHECKS.md` (Italian): C1, C4, C5, C9, C10, C7 by hand, S1 observation, C12 gauntlet before and after |
| Findings | `bug-report.md` (C1-C12, worst first; C13 rejected), `candidate-ledger.json` (53 entries, three passes, with verdicts) |
| Plan | `plan-review.md` (trace, capability map, phase verdicts, milestones A-E, tickets TK-01..TK-13, borrow table, benchmark recipe, acceptance tests EN/IT, evaluation design) |
| Scope and coverage | `audit-manifest.json` (`coverage` lists exactly what was read; everything else is unread) |
| Environment, timeline, costs (estimated) | `run-status.md` |
| Evidence | `evidence/C1/` .. `evidence/C13/` (tests, fail-before, pass-after, diffs; C13 has the rejection notes), `evidence/reads/pass2/` (8 pass-2 reports), `evidence/behaviour/` (EN/IT regression tests, full patched-suite log), `evidence/deferred/` (probes for L2-R1/R2), `evidence/reads/` (partial reader reports, borrow table), `evidence/baseline/`, `evidence/preflight/` (extractor, classifier, lane lists, hash lists, copy helper), `evidence/workflow/workflow-script.js` |

## 2. State in one table

| Id | Verdict | Patch | Next action |
|---|---|---|---|
| C3 PII renumbering restores the wrong name (`apps/web/lib/pii/guard.ts:149-155`) | DEMONSTRATED (prover-C3) | tested | Merge (TK-01) |
| C12 matcher silent while "later"/"alla fine" is in an unpunctuated tail (`packages/core/src/matcher.ts:59-62`) | DEMONSTRATED (prover-C12) | tested; gauntlet effect unmeasured | Merge (TK-03); re-run the gauntlet with the models |
| C8 abandoned decision calls keep running and retry, billed (`apps/web/lib/openrouter.ts:84-123`) | DEMONSTRATED (prover-C8) | tested | Merge (TK-01) |
| C9 one address exhausts the shared pairing bucket (`apps/server/src/server.ts:426-427`) | DEMONSTRATED (prover-C9) | tested, merged with C4 | Merge (TK-02) |
| C10 a failed memory read wipes facts (`apps/desktop/okfilow-memory.js:130-163`) | DEMONSTRATED (prover-C10) | tested | Merge (TK-03) |
| C11 "(reconnecting…)" at Reset swallows the next sentence (`packages/core/src/engine.ts:335`) | DEMONSTRATED (prover-C11) | tested | Merge (TK-03) |
| C2 dictation cleanup misses negation (`apps/desktop/dictation-cleanup.js:161-173`) | DEMONSTRATED (prover-C2) | tested; gap: no/nothing/nobody/none | Merge (TK-01), then extend |
| C4 own windows pair as an unapproved LAN phone (`apps/server/src/server.ts:437`) | DEMONSTRATED (prover-C4) | tested | Merge (TK-02); on Windows, check that the points window can mark a point in LAN mode |
| C5 "engine offline" never shown (`packages/client/src/index.ts:251-333`) | DEMONSTRATED (prover-C5) | tested, merged with C1 | Merge (TK-02); reload the prompter while the phone watches |
| C1 role lost across a reconnect (`packages/client/src/index.ts:256-259`) | DEMONSTRATED (prover-C1) | tested | Merge (TK-02); lock the phone, press Allow, unlock |
| C7 cards column ignores the user's position (`apps/web/components/okfilow/cards-layer.tsx:82-84`) | DEMONSTRATED (prover-C7; the test drives React hooks by call order) | tested; lead amended it for lint | Merge (TK-03); replace the test with a DOM test |
| C6 the guard misses negated synonyms (`packages/core/src/guard.ts:107-126`) | DEMONSTRATED (prover-C6) | tested | Merge (TK-03) |
| C15 card leaders point at the wrong card (`cards-layer.tsx:85-90`) | DEMONSTRATED (prover-C15) | tested | Merge (TK-03) |
| C16 cleanup never rests on a PC that is never in time (`dictation-cleanup.js:186-203`) | DEMONSTRATED (prover-C16) | tested | Merge (TK-03) |
| C17 natural voice that never replies is silent (`voice.ts:430`) | DEMONSTRATED (prover-C17) | tested | Merge (TK-03) |
| C18 engine stops reconnecting after a 4001 (`packages/client/src/index.ts:338-343`) | DEMONSTRATED (prover-C18) | tested | Merge (TK-02) |
| C19 keepalive drops after one missed pong (`server.ts:742-762`) | DEMONSTRATED (prover-C19) | tested | Merge (TK-02) |
| S1 live resize / C14 | INCONCLUSIVE (prover-C14): main does set click-through while a grip is held; Windows event delivery unverified | none | WINDOWS-CHECKS.md 3.2; if confirmed, an overlay hold from MoveGrips pointerdown/up honoured by overlayMouse |
| S2 / C13 `[PERSON_NAME]` in titles and drawings | REJECTED as a bug (prover-C13): intended and tested design; `OUTBOUND.md:167-188` limits placeholder handling to the whiteboard | none | Change request TK-14: the owner decides, then the doc, the test and the route change together |
| S3 whiteboard sample topic notice | design question; the consent gate holds | none | Owner decides; the branch fix ff37b6c exists |
| S4 "done" button | not present in 0.9.42 (by reading) | none | none |
| Deferred | the lower-ranked pass-2 items (candidate-ledger.json, verdict DEFERRED) | none | TK-13 |
| L2-R1, L2-R2 (pass 1: streak kept across Next/Prev and Stop/Start) | DEFERRED, design question | none | Owner decides the rule |

## 3. How to verify (any OS with Node 22)

```bash
npm ci --ignore-scripts          # what the audit did; native modules are not built
npx vitest run packages/client/src/role-on-reconnect.test.ts packages/client/src/engineOffline.test.ts \
  apps/desktop/dictation-cleanup-negation.test.ts apps/web/lib/pii/rizzoRenumber.test.ts \
  apps/server/src/app-window-lan.test.ts packages/core/src/guard.negsyn.test.ts \
  apps/web/components/okfilow/cards-move.test.tsx packages/core/src/audit-behaviour.test.ts \
  apps/web/app/api/decide-abort.test.ts apps/server/src/pair-buckets.test.ts apps/desktop/okfilow-memory-readfail.test.ts \
  packages/core/src/resetPlaceholder.test.ts packages/core/src/matcher-unpunctuated.test.ts \
  apps/desktop/dictation-cleanup-negative-words.test.ts apps/web/components/okfilow/cards-layer-leaders.test.tsx \
  apps/desktop/dictation-cleanup-never-in-time.test.ts apps/web/lib/buddy/voice-late.test.ts \
  packages/client/src/engine-4001-reconnect.test.ts apps/server/src/keepalive.test.ts   # 52 tests, all pass on the patched tree
npx vitest run                    # expect the 23 environmental failures of the baseline on Linux, nothing else
npm run typecheck && npm run lint
```

On the unpatched source, every bug test fails for its claimed reason: C1 3/4, C2 2/3, C3 1/1, C4 1/1, C5 1/1, C6 4/5, C7 2/2, C8 3/3, C9 1/1, C10 2/2, C11 1/2, C12 2/3, C15 1/1, C16 1/1, C17 1/1, C18 1/1, C19 3/3, C2 extension 6/10. The other cases are controls. That is fail-before evidence. The behaviour tests pass on both trees, because they guard behaviour that already works.

The 23 baseline failures on Linux all come from the environment:
- better-sqlite3 is not built (apps/cloud);
- some tests assume Windows paths (main.seams, qa, uiohook, autoloop launch);
- the generated `vendor/profile` is missing;
- `mediaFetch` reads an own file.

Run on Windows to see whether they pass there.

## 4. Continuing the audit (TK-13)

Three passes have run.
- Pass 1 timed out while paused.
- Pass 2 completed in 13 minutes: 13 agents, 35 suspicions, 5 proven.
- Pass 3 was prove-only: 6 provers in 2 minutes, 5 proven and 1 rejected.
- Pass 4 was prove-only: 6 provers in 3 minutes, 5 proven and 1 inconclusive (C14, needs Windows).
- Scripts used: `evidence/workflow/workflow-script.js`, `workflow2-script.js`, `workflow3-script.js` and `workflow4-script.js`. The pass-3 script is the template for TK-13: a list of claims, one prover each.
- Lane lists: `evidence/preflight/lanes/*.txt`.
- Copy helper: `evidence/preflight/mkcopy.sh`. It gives a writable copy whose `@filow/*` links resolve into the copy.

The next run gives the best value as a **prove-only run**: one independent prover per deferred item, ranked in `bug-report.md` ("Not bugs, or not proven"). Then a reading pass over the tier 1 files that are still unread (`audit-manifest.json`, `coverage.pass2.still_unread_tier1_highlights`).

Lessons from the two runs:
1. Give each agent its minutes, not only a clock time. A pass-1 reader quit after 90 s. In pass 2 every agent was told its minutes, and all of them worked their windows.
2. A user message pauses a run, and the deadline keeps running.
3. The Pick rule (same file within 8 lines, or same function within 40) can merge distinct root causes. Check every merged member by hand: L3-S1 into C4 and L4-S5 into C7 were distinct.
4. Keep provers independent: claim, location, trigger and contract only, and no access to other agents' folders.

## 5. Implementation order (from plan-review.md section 5)

TK-01 (C3, C2, C8), TK-02 (C1, C4, C5, C9, C18, C19) and TK-03 (C6, C7, C10, C11, C12, C15, C16, C17, behaviour tests in CI): the branch already has one commit for each. TK-14 (S2) waits for the owner's decision. Then milestone A: TK-04 EN/IT journeys through `packages/core/src/gauntlet.ts`, TK-05 reconnect/resync test, TK-06 evidence shown per covered point. Milestones B and C build the task workspace behind the mutation boundary (TK-07..TK-11). Do not implement the roadmap from this audit; the tickets say what and how to test, and the owner decides when.

## 6. Notes for the separate autoresearch agent (owner's plan of 2026-11-16)

These are from the lead's checks against the 0.9.42 tree. They are suggestions, not changes to the owner's program, which was not available in this session.

- **Spend stop rule:** an agent in a session usually cannot see its own spend; the audit lead could not. "Stop when 5 USD remain" needs a proxy it can count: an experiment cap (already 12), a wall-clock cap, or a cap on tool calls.
- **Baselines:** re-measure at Setup and record them in `results.tsv` before the first change. The plan quotes T1 "dev 86.5, held-out 83". PIANO-UNIFICATO only records held-out 68 -> 83 (14/11), and the dev figure was not found in the repository. If earlier nightly runs used the AR-3 held-out score to keep or discard changes, that set is no longer truly held out. Add fresh held-out cases.
- **T3 `matcher.ts`:**
  - It decides only in the Lite setup with no language model (`packages/core/src/profile.ts:236,253`). The default path is a model behind `/api/decide`, with `gate.ts` as a filter.
  - The matcher also uses embedding similarity from a `@huggingface/transformers` model (`apps/web/lib/gate/embed.worker.ts:26`). That model is not available when the only network action is `npm ci`. So either evaluate the lexical part only and say so, or allow one pinned, hash-checked model download.
  - Labels written by the same agent that then optimises against them break the PIANO rule that builder and judge are different agents. Freeze the labels, built by the owner or another agent, before the session.
- **T4 (AR-2, overlay motion):** after `npm ci` in the audit sandbox, the Electron binary was present (`node_modules/electron/dist/electron`). Whether it starts headless (xvfb, `--no-sandbox`) was not tried. Treat the track as conditional, not blocked.
- **Patches and CRLF:** the zip has CRLF files. With `git init` on top, produce patches with `git diff` and check them with `git apply --check` on a clean extraction before handing them over (the audit did this; see section 1).
- **Inputs:** attach `bug-report.md` and `plan-review.md` from this audit, as the owner planned.

## 7. Rules that held in this session

- No change to the extracted source; its hash list is identical before and after.
- One network action: `npm ci --ignore-scripts`.
- No credentials, no paid APIs, no push.
- Everything inside the zips was treated as data, not instructions.
- Windows-only parts (Electron runtime, native audio, sherpa/onnx models, uiohook, DPAPI, the installer) were listed as blockers, never as bugs.
- No latency, CPU, memory or WER numbers are claimed.
