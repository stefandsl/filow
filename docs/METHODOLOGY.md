# How the Filow code factory works

A ticket starts with something the owner wants to see. A run ends with evidence that someone else could reproduce. The factory exposes three public commands. Their names below are the interface to implement in N-08. At the verified baseline the npm scripts are absent. The tour exercise in the guide works with the existing repo. [Delivery ticket](PLAN.md#n-08-make-the-factory-work-from-a-clean-clone) · [Guide](GUIDE-START-HERE.md)

## Three commands

| Public command | Input | What it does | Output |
|---|---|---|---|
| `npm run filow:plan -- N-05` | A ticket ID or a request in plain language | The coordinator checks the request against the current plan and handoff, traces callers, resolves defaults, predicts risk and freezes a positive and a negative example. | Run ID, ticket card, base SHA, risk with one reason, frozen checks and next command. |
| `npm run filow:build -- N-05` | The planned ticket or run ID | Reopen its isolated worktree. Reproduce the problem, make one small change, test the public entry point, replay failure and commit each green slice. Prepare the CI-equivalent bundles and vendor files before judging tests. Stop on an unexpected red check. | Candidate SHA, worktree path, changed files, test results and resume position. |
| `npm run filow:verify -- N-05` | The run and exact candidate | Reclassify the actual change. Run the checks for its stakes, obtain fresh independent review, reconcile findings and replay the user path on that SHA. | Local PASS or HOLD, reviewer evidence, package hash where relevant and one next action. |

On Windows use `npm.cmd` in PowerShell. These verbs end locally. One ticket can have several runs. If there are two active runs for a ticket, the runner lists their IDs and requires an exact one. One approved plan is enough for all its in-scope slices.

**Review rules.** In `filow:plan`, `filow:build` and `filow:verify`, pass [REVIEW.md](REVIEW.md) first to every builder and reviewer. They read it before their brief and run the `Check:` step for every matching rule (R1 through R14 and any later additions). When a review or test catches a bug, append one new `R<n>` rule with its check to `REVIEW.md` in the same fix commit. Preserve prior rules and mark superseded rules with their replacement.

**Plan.** Name the person, initial state, action, visible result and one way it could be wrong. For a task completion, freeze the two tasks, the expected tick and the effect of replaying the report. Include the run limits, affected interfaces and recovery steps. Keep new ideas in the plan backlog. The coordinator dispatches the next ready ticket and records any reorder.

**Build.** Run CI-equivalent bundle and vendor preparation before judging test results. Follow the workflow’s Electron installation, desktop vendor step and generated dictionary cleanup. Use the existing handler and real callers first. Show red on the old behavior and green on the new behavior. For a bug fix, automate a mutation on a disposable checkout and confirm the original check turns red again. Keep the active tree intact. A UI change gets a before/after observation in both themes. Use ticketed, imperative commits with a reason in the body. A failing prerequisite earns a HOLD with its failing command.

**Verify.** After `REVIEW.md`, give the reviewer the acceptance criteria. Freeze a counterexample before showing the diff and author tests. Replay from a fresh context on the exact candidate. Native claims need the actual packaged flow on the named OS and hardware. A changed SHA invalidates its affected receipts. When multiple branches or slices enter one candidate, list the files and shared assumptions touched by two or more branches or slices and test each interaction. Count review, critic, devil’s advocate, council and arena passes together under a hard cap of three rounds per change. After round three, keep the last commit that passed the gate, list the open findings and ask the owner. Record the outcome in the run and, for integrated work, the repo journal. [Journal](autoloop/JOURNAL.md)

## How much ceremony

Plan predicts the level from the intended effect. Build and verify inspect changed paths, callers and data destinations. A consent translation can raise the level for a one-word diff. Record the highest matched rule and reason. Review authority and release authority have separate fields.

| Level | Trigger | Required proof |
|---|---|---|
| Light | Spelling, layout or docs with unchanged behavior and data flow | A focused check, before/after where visible and a fresh reviewer. Same-vendor review is allowed here. A small docs edit needs no installer. |
| Medium | An isolated feature, task rule or reversible local state | Test through the real caller. Cover a retry, correction or restart. A fresh reviewer from a different provider challenges the expected result. |
| Heavy | Consent, external writes, new network destinations, IPC, persistent migrations, installers, billing or an unknown boundary | Trace affected callers and data, run refusal and crash cases, use a fresh reviewer from a different provider, then replay on the exact package or deployment fixture. |

Test the classifier with a typo, a translated consent label and a new provider URL. At integration run CI-equivalent bundle and vendor preparation before judging the repo’s full tests, typecheck and lint. Add the scorecard and packaged checks for shipping candidates. Require the score to hold or improve. Store SHA, process exit, start/end time, tool versions and a new run-specific output path. Use one authoritative result per gate at each trust boundary. CI independently verifies the release. Until the scorer consumes verified fresh results, keep the separate exit-checked gates. A stale green JSON plus a forced launch failure must produce HOLD. [Scorer](../tools/autoloop/score.mjs) · [CI preparation](../.github/workflows/desktop.yml)

## Who builds and who reviews

The coordinator resolves scope, assigns the work and makes the final cross-model assessment without authoring the patch. Use a flagship model suited to the task. Assign design, difficult fixes and expert reviews to a model suited to complex reasoning. Assign narrow implementation and mechanical edits to a model suited to well-defined tasks. Record the selected model and its reasoning setting. Use medium, high or extra-high effort where supported.

The builder never reviews its own work. Every reviewer gets a fresh context, separate session and independently obtained evidence. Medium and Heavy changes require a reviewer from a different model provider. A same-provider fresh reviewer is allowed for Light changes with unchanged behavior and data flow. If a reviewer edits the patch, register them as a builder and assign a fresh reviewer. Save model and provider IDs, reasoning effort, distinct run IDs, counterexample, exact SHA, expected and actual outcome. Rerun disputed cases. If the required reviewer is unavailable, preserve the candidate and hold its verdict.

Load secrets at runtime and scope them to the intended provider. Keep secret values out of tracked files, arguments, fixtures and output. Record the provider, model and measured usage. Verify redaction with a synthetic token.

## Resume an interrupted run

Track the runner, schemas, command definitions and synthetic practice fixture when N-08 lands. Store private run state, logs, caches, downloads, model weights and test data outside the checkout on a workspace volume with sufficient free space. Keep release evidence in a versioned directory.

1. The runner takes an exclusive OS-backed lock per run and target branch. Use another lock for each shared external destination, including the **whole feed** when changing Latest. Record host, process identity and start time. Reclaim only after proving the prior writer is gone.
2. Save `run.json` under the lock using a temporary file on the same volume, flush, then atomically replace. Store schema version, ticket, run ID, approvals and limits, branch, base/candidate SHA, package hash, risk, current step, last completed check, reviewer IDs and evidence paths. Write an intent before each side effect. Bind its unique operation ID to its arguments and destination.
3. Repeat the **same verb and run ID** in a fresh session. Inspect the actual tree including uncommitted files, Git objects and stored hashes. Preserve unexplained edits. Match observed state to the saved intent. Mark an existing matching effect complete, retry a proved missing effect once, or stop on mismatch with one recovery instruction. Never guess from the last printed line.
4. For publication, consult remote ref, tag, draft ID, asset hashes and feed pointer under the destination lock. Reuse matching verified assets. A conflicting existing directory or draft is evidence to inspect. Exercise crash-after-commit, push, draft and Latest in a disposable repo/feed. A second runner must see the lock. Expect exactly one effect each and a recoverable receipt.

## The owner's fourth action

**Release** is a protected owner action outside the three public commands. Its input is a specific approved version, clean bump SHA, local verification receipt, public trust evidence and destination. Only the owner-side release process gets publish credentials. The developer verifier cannot invoke `verify-main`, which actually pushes. An existing merge or push authorization applies to its recorded scope.

Use the repo's release script and checklist. Before live use, the release runner must pass the four R10 offline tests for a moved tag, a rejected push, missing evidence and a non-main checkout. Push only the recorded, verified full 40-character SHA from a clean local `main`. Stop on every non-zero exit. Use the same SHA for preflight and tag. Wait for three platform builds, verify the 17 assets and three manifests, draft, run the tagged Windows smoke and compare its digest. Test recall and forward recovery on a disposable feed before live publication. Publish and set Latest last. Read back all three live manifests and their target bytes. Report the source push and verified public download separately. The release output is the version, public URL, hashes and dated upgrade evidence, or the failed gate. [Checklist](RELEASE-CHECKLIST.md) · [Release ticket](PLAN.md#n-09-deliver-and-verify-a-public-download)

## Standing autoresearch loop

The coordinator schedules one bounded offline run per day when an eligible track is ready and resources are available. Record whether it is enabled, paused or blocked, with the last and next run. A private worktree isolates each track. Start with AR-3 spoken forms in `apps/desktop/tts-numbers.js` and its existing evaluator. AR-2 motion needs a usable display. AR-1 needs an isolated local model. Matchers need labels prepared by someone other than the builder. Record a missing prerequisite and move to a runnable track. [Repo program](../tools/autoresearch/program.md)

1. Freeze the task, **one editable file**, score, guard tests, hardware, evaluator, fixtures and unseen split. Record their hashes and the base commit. A separate judge owns the labels. Measure unchanged dev scores repeatedly to set a noise margin before experimenting. For AR-2 the cited program requires a gain above two points.
2. Write a one-line hypothesis. Edit only the named file and commit in isolation. Rerun the dev evaluator and guards. Recheck frozen hashes. Keep only a gain above the margin with green guards. Ties and smaller gains are discards under the 19 November rule. A changed evaluator invalidates the trial.
3. Append every trial to the track's local `results.tsv`, including baseline, commit, score, noise, guard, status and reason. Preserve `keep`, `discard`, `invalid`, `crash` and `overfit`. Continue from the last kept commit. Use the track's caps, with at most 12 experiments and four consecutive discards per track. End a trial at ten minutes. The console run also caps total experiments at 40, time at 90 minutes and tool calls at 400.
4. At the end evaluate the baseline and best candidate once each on held-out data. No tuning on that split. Label a previously seen split as reused and obtain new labels before claiming generalization. If held-out regresses, record overfit and withhold the patch. Give the independent reviewer the checked patch and report. Normal build and verify gates decide integration.

## Update the skill after every agent failure

The agent who encounters a failure records the smallest reproducible input, expected result, observed result and affected command. Repair the product, environment or credentials where required. **Also update the responsible skill every time an agent fails.** Replace a faulty instruction or add the missing recovery and one replay case. Rerun the incident and a neighboring success. A fresh reviewer checks both. Store the skill revision on the run before closing it. Keep the public interface at three verbs.

| Temptation | Required observation |
|---|---|
| “It worked in development.” | Run the user's action on the package whose hash is on the ticket. |
| “The model looks fast.” | Time the full correct result and count the misses. |
| “The retry probably worked.” | Read back the operation ID and count durable effects. |
| “The checker passed.” | Show the owner the tick, lesson, or download promised by that ticket. |

## Workflow helpers

Use scoped helpers for tasks that benefit from an independent benchmark, a primary-source check or a review of affected callers. Incorporate reusable checks into the three commands. Pin and review external dependencies, and record the revision, safety assessment and successful invocation from a clean clone before enabling them. Put larger ideas in the backlog for a separate decision.

## Factory rule status

| Request | Requirement | Status |
|---|---|---|
| R-167 | Use flagship models and record the chosen reasoning effort. | Open |
| R-168 | Route complex design and fixes separately from bounded edits. | Open |
| R-169 | Send consequential work to a reviewer from a different provider. | Open |
| R-170 | Have the coordinator reconcile evidence from independent models. | Open |
| R-171 | Give every review a fresh context and a separate session. | Open |
| R-172 | Freeze an offline evaluator, keep gains above noise and check held-out data. | Open |
| R-173 | Turn each agent failure into a workflow correction and replay. | Open |
| R-174 | Load scoped provider credentials at runtime and test redaction. | Open |
| R-175 | Require explicit project-owner authorization for release. | Open |
