# Filow hand-off

## N-03 | Packaged Windows baseline

The operator replayed the two-section support journey with local Sherpa and paced PCM at the packaged capture callback on main `d22031efab8086a5e7dda79cf844bbda4dbdd25b`. The private archive matches its SHA-512 manifest. Both runs clicked Start. Counts below are per desktop run at the end of each clip.

| Label | English | Italian |
|---|---|---|
| Noise, wrong ticks / opportunity | 0/1 in 6 s (0/min) | 0/1 in 6 s (0/min) |
| Pilot, correct target / opportunity | 1/1 Bristol | 1/1 Vicenza |
| Digression, wrong new ticks / opportunity | 0/1, pilot retained | 0/1, pilot retained |
| Corrected launch date, wrong ticks / opportunity | 1/1 | 1/1 |
| Support owner alias, correct target / opportunity | 0/1, recognizer returned “Myo” | 0/1, Giulia recognized, row still tentative |
| Near phrase and later positive launch-date line | 0 eligible for each | 0 eligible for each |

In both languages the launch date was already green before the near phrase. The phone stayed on its join screen. It supplied zero paired observations. The ambiguous alias, general backup remark, interruption timings, physical microphone switch and Bluetooth trial have no measurements in these receipts.

Recheck the supplied WAV directory with `node tools/autoloop/e2e/n03-windows.mjs fixtures <directory>`. For each private receipt run `node tools/autoloop/e2e/n03-windows.mjs score <receipt.json> d22031efab8086a5e7dda79cf844bbda4dbdd25b`. Both exit 1. The receipts contain desktop rows, submitted frame counts and recognizer events. They lack per-clip digests, paired rows and fault observations. Use the same external driver, speech model, PCM bytes and schedule for the candidate.

A separate replay through `Engine.feed` used a synthetic decision that recognizes the written owner's name in the committed window. In EN and IT only `s0b1` completed on the owner line and its evidence quoted that line. Reopen followed by the general backup sentence completed `s0b1` a second time from the old words. In section two, the positive restore-test partial set the hint on `s1b2`; the corrected final with an empty partial left the hint active. The unrelated manual mark on `s1b1` survived. These observations cover engine state only.

The script-scoped point references borrow the explicit identity pattern in `get-bb/bb` at `28cdd915db441933646c0e07543ddc05efa1b43f`, `packages/templates/src/templates/bb-guide-thread-messaging.md`. The notices generator includes the attribution and the packaged resources include the upstream MIT license, copyright 2026 Michael Yong. The operator verified the exact license text in the preview package.

### Paired Windows replays

In further main runs with a paired Chromium phone view, the operator played the near phrase before the correction so the date was still open. It wrongly turned green on 1/1 eligible opportunities in each language. The owner alias completed on 0/1 opportunities per language. English recognition changed Maya's name and Italian recognized Giulia. The two six-second noise clips produced zero wrong ticks (0/1 opportunity and 0/min in each language). The pilot completed on 1/1 opportunities per language.

On preview `6e35502a19961fc8b952541f8fdcef24689df23f`, both surfaces agreed on the following counts with the canonical clip order. Each column represents one observation per label. The near phrase followed the correction with the date still open.

| Label and denominator | English | Italian |
|---|---|---|
| Wrong noise ticks / opportunity | 0/1 in 6 s (0/min) | 0/1 in 6 s (0/min) |
| Correct pilot ticks / opportunity | 1/1 | 1/1 |
| Wrong new ticks during digression / opportunity | 0/1 | 0/1 |
| Wrong corrected-date ticks / opportunity | 0/1, still tentative | 0/1, waiting |
| Wrong near-phrase ticks / opportunity | 0/1 | 0/1 |
| Correct owner ticks / opportunity | 0/1 | 0/1, tentative |
| Correct fresh date ticks / opportunity | 1/1 | 1/1 |

The operator also interrupted four independent sessions on each build. Times below are milliseconds after the fault. A retained display alone does not establish that fresh speech works.

| Fault | Main | Preview `6e35502a` |
|---|---|---|
| Speech worker | Desktop/phone retained place at 305/307. Manual continuation at 1,865, recognizer stopped. | Desktop/phone at 312/313. Deliberate continuation at 8,847. |
| Relay listener | Desktop/phone showed the place at 621/622. The next manual move failed to sync. | Desktop/phone at 625/4,955 with one re-pair. Deliberate continuation at 6,059. |
| Renderer | Place lost at the 22,035 ms observation limit. | Place lost at 24,143 ms. |
| Main | Place lost at the 22,116 ms observation limit. | Place lost at 24,008 ms. |

The disk probe found section two in the saved file immediately before termination. On launch, the rehearsal recorder discarded the saved place and the initial load wrote section one back. The focused regression attaches the real recorder and checks the first published state, manual reopen and muted capture. The correction regression sends a weak positive score after a contradictory final and checks that the hint clears in both languages.

Main switched from a USB microphone to a virtual capture input in 1,519 ms (EN) and 1,520 ms (IT) following simulated track-ended and device-change events. Physical unplugging and Bluetooth remain owner checks. Exact-candidate packaging, paired replays including fresh speech after each fault, native matcher scores, both endpoint trials, the thirty-minute resource comparison and factory CI remain open. The focused tests cover changed-script rejection, evidence, manual reopen, muted restoration and rejection of stale speech and commands.

### Follow-up on the recorded failures

On packaged preview `3b6c51f21e32d6b71e04c06427020770d56a9416`, the corrected date and the lunch phrase each produced zero wrong ticks in one opportunity per language. Both screens returned to waiting after the correction. The canonical owner line completed Giulia's point (1/1). English recognition changed Maya's name and the point stayed open (0/1). Each language completed the pilot and the later positive launch-date line (2/2).

The expanded paced-audio set exercised four positive aliases, four ambiguous remarks, four near phrases and three 20-second noise clips per language and build. The paired rows agreed on all 15 observations in each run. The table counts correct target ticks for aliases and wrong ticks for each negative class.

| Class | Main EN | 3b6c51f2 EN | e05c8435 EN | Main IT | 3b6c51f2 IT | e05c8435 IT |
|---|---|---|---|---|---|---|
| Positive aliases | 1/4 | 1/4 | 1/4 | 4/4 | 4/4 | 4/4 |
| Ambiguous remarks | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 |
| Near phrases | 2/4 | 1/4 | 0/4 | 2/4 | 1/4 | 0/4 |
| Noise | 0/3, 0/min | 0/3, 0/min | 0/3, 0/min | 0/3, 0/min | 0/3, 0/min | 0/3, 0/min |

The English recognizer changed the name in three expanded alias clips. Preview `3b6c51f2` accepted an unset launch date in English and a Tuesday launch explicitly excluding Monday in Italian. With R170 and R171, packaged revision `e05c843569d3568c511551f987f9e018516947b3` kept the wrong points open on all eight near phrases. Desktop and phone agreed on all 30 observations. Each noise minute comprised three clips with zero recognized finals.

Preview `3b6c51f2` ran one trial per fault. Times are milliseconds from the interruption.

| Fault | Desktop | Phone | Deliberate continuation | Observation |
|---|---:|---:|---:|---|
| Speech worker | 324 | 359 | 9,314 | Presenter restarted capture |
| Relay listener | 623 | 5,865 | 6,040 | One re-pair, recording continued |
| Renderer | 1,168 | 1,169 | 6,141 | Start control visible before continuation, one re-pair in the trial |
| Main | 5,671 | 6,535 | 6,554 | Start control visible before continuation, one re-pair |

R172 routes confirmed relay loss through Stop before a replacement session is published. The mounted-session test checks capture stops once, the presenter's reopen survives, and an ordinary reconnect keeps listening. In separate endpoint tests, the preview paused on simulated loss and resumed on the second input in 2,069 ms (EN) and 1,846 ms (IT). Physical Bluetooth, actual unplugging, exact-candidate native measurements including the thirty-minute hold, and factory gates remain pending.

On `e05c8435`, separate control trials in both languages reproduced the restore failure. Both screens left the restore point waiting after a denial followed by a fresh success. After Reset the next successful final completed it. In the immediate English Next trial, the retention point had already turned green on the general backup and weekly review remarks. The focused regressions for R173 and R174 use those delivered finals and the recorded matcher score. Packaged confirmation of the subsequent speech changes is pending.

## N-01 | Working baseline, 20 November 2026

The operator observed `stefandsl/filow` at **`44569cfaad1bd2036871dda478e7e9d750d30f1f`** on `origin/main` at 07:49:15.712 UTC. The primary checkout, assigned `ticket/n01` worktree and private builder checkout all started at that SHA with zero tracked changes and zero untracked files. Hold the comparison if the baseline moves or unexplained edits appear. All seven prepared Windows checks passed on that commit. The earlier prepared run had 4,217 passes and 12 skips. [Delivery plan](docs/PLAN.md)

### History and audit recovery

Both `git merge-base --is-ancestor 4e0bb19 368f019` and `git merge-base --is-ancestor 368f019 44569cfaad1bd2036871dda478e7e9d750d30f1f` returned 0. In chronological order, the eight first-parent merges were `4490badc`, `ffc1c819`, `41ceb307`, `f77bab55`, `c88fd440`, `6a44c174`, `f6432758` and `4009dd08`. Replay with `git log --reverse --first-parent --merges --oneline edc47a4..4e0bb19`.

The original `tmp/branch-backup-2026-11-18.bundle` has SHA-256 `ca66b1da88eab644cd0c6f7dc8d7515ccd951f9a5fc5bfbd7508a50c819a11bb`. It contains a complete history with 115 advertised heads. The operator's private `run.json` records its location in `historyInputs.bundle`. Set `FILOW_FACTORY_BRANCH_BUNDLE` to that file. Run the recovery commands in a disposable clone.

```powershell
$bundle = $env:FILOW_FACTORY_BRANCH_BUNDLE
$ref = 'refs/heads/audit/fixes-0.9.42'
$audit = '0315dcf4f8b970c1f09dc93106c5c60111277cf3'
if (!$bundle -or !(Test-Path -LiteralPath $bundle -PathType Leaf)) { throw 'HOLD: supply the original branch backup' }
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256 -ErrorAction Stop).Hash -ne 'ca66b1da88eab644cd0c6f7dc8d7515ccd951f9a5fc5bfbd7508a50c819a11bb') { throw 'HOLD: backup digest differs' }
git bundle verify "$bundle"
if ($LASTEXITCODE) { throw 'HOLD: invalid bundle' }
$heads = @(git bundle list-heads "$bundle")
if ($LASTEXITCODE -or $heads.Count -ne 115 -or $heads -cnotcontains "$audit $ref") { throw 'HOLD: backup heads differ' }
git fetch --no-tags "$bundle" "${ref}:$ref"
if ($LASTEXITCODE -or (git rev-parse --verify $ref) -ne $audit) { throw 'HOLD: audit ref recovery failed' }
```

Keep C6, C12, C23, C27 and C28 on the archived branch until each fix has an independent evaluation on labelled EN/IT sentences. [Audit handoff](docs/audit/AUDIT-0.9.42-HANDOFF.md)

### Reproduce the Windows checks

CI selects Node 22 and installs with `npm ci --prefer-offline`. This run used Node `v22.13.0` and npm `11.15.0`. The SHA-256 of `package-lock.json` was `bb8a1cc903b21cbf2b4f2c6ece68695d694098eb3dae9389e30bd1832101779d`. It matched `node_modules/.filow-lock-sha256`, allowing the factory to link the prepared installation into its disposable gate checkout. Run the steps there with private caches and temp directories on G:, at least 20 GB free, a credential-free child environment, a 25-minute command limit and one setup retry. [Windows checks job](.github/workflows/desktop.yml)

All rows tested the full baseline SHA above on 20 November 2026. Paths are relative to the private directory for `run-dda8fd7b`. The working directory for every command was `ci-uu2JWG/` (the receipt's `checkout` field). Each receipt is under `rc/<ID>.json`. The expected exit was 0 at each step.

| Command in execution order (PowerShell) | Start UTC | End UTC | Actual exit | Receipt ID |
|---|---|---|---:|---|
| `node node_modules/electron/install.js` | 07:51:02.833 | 07:51:45.651 | 0 | `f2bb250d` |
| `npm run vendor -w apps/desktop` | 07:51:46.041 | 07:51:54.008 | 0 | `bb6a1e03` |
| `if (Test-Path apps/desktop/vendor/i18n.js) { Remove-Item -LiteralPath apps/desktop/vendor/i18n.js }` | 07:51:54.389 | 07:51:54.390 | 0 | `5f0ed88c` |
| `npx vitest run --reporter=json` | 07:51:54.834 | 07:53:01.878 | 0 | `cad1b848` |
| `npm run build:welcome -w apps/desktop` | 07:53:02.277 | 07:53:02.662 | 0 | `4d7434d6` |
| `npm run typecheck` | 07:53:03.066 | 07:53:21.194 | 0 | `e96d2925` |
| `npm run lint` | 07:53:21.595 | 07:53:32.371 | 0 | `f3f35024` |

**4,290 tests passed**, 0 failed, 12 skipped and 0 todo. Of 331 files, 326 passed, 0 failed and 5 were wholly skipped. The JSON report measured 66,427.4267578125 ms. The factory adds the JSON reporter to the workflow's `npx vitest run` and saves the raw report beside the receipt as `rc/cad1b848.json.vitest.json`.

**Missing input.** The vendor step builds `apps/desktop/vendor/hardware.js` from `packages/core/src/hardware.ts`. Without it, `qaHardware` returned `null` for `ramGb=16,cores=8,gpu=none`. The “every hardware read” test in `apps/desktop/qa.test.ts` exited 1 in the disposable fixture. After preparation the same test returned the expected hardware and exited 0. This explains the three historical desktop QA failures. Record HOLD for incomplete preparation if this happens again.

**Interrupted gate.** Preserve the first nonzero exit or missing Vitest report and record which later gates did not run. Resume with the same run ID. Match the saved intent to the receipt's run, SHA, phase, step and ID before repeating a command. In the fixture, a failed Vitest launch held welcome, typecheck and lint. A successful retry reused the first three receipts. A separate interruption after the Electron receipt resumed at vendor. The private `b/operator-evidence.json` locates the fixture results under `fixtureReceipt`.

After the builder reply, `npm.cmd run filow:build -- run-dda8fd7b` in the assigned operator worktree runs these checks on the new commit. Read `buildEvidence` in the private `run.json` for that SHA's receipts. [Factory walkthrough](docs/GUIDE-START-HERE.md)

### Tracker and native checks

The operator's 20 November 2026 inventory (07:53:44 UTC) from `gh issue list --repo stefandsl/filow --state open` returned **zero open issues**. If the tracker snapshot is unavailable on replay, mark the inventory unverified and hold that check. Issue 8 was last documented closed at 22:24:05 UTC on 18 November. Before proposing a reopen, reproduce the drawing, move or resize failure on the prepared SHA and record the exact action and result. [Issue 8](https://github.com/stefandsl/filow/issues/8)

| Device and action | Observation on the pinned SHA |
|---|---|
| Windows AMD64 test PC, NT 10.0.26300.0. Open About in packaged Filow 0.9.43 and use Save in the report dialog. | One fresh-profile run passed, UI exit 0. The saved file matched the visible preview. The screenshot and saved-file hashes matched the receipt. An earlier attempt at the same source SHA recorded `passed: false` without a UI exit or saved report. A second successful launch remains unverified. |
| Windows ARM device | Live package inspection remains unverified. |
| O2 overlay on Windows in light and dark themes | Fast drags, DPI scaling, display edges, capture cancellation and click-through remain unverified in the package. |

The tested x64 archive was `Filow-win-x64.tar`, SHA-512 `a29efacf581302a31aa1fc330a10548e18d96ade3a9b8c2e594fd076f28071f7234cc0db445447dda525943ae86a1881551690a09450ee562c06738f6fffc624`. For the same-device replay and independent review, open `b/operator-evidence.json` in the run directory. Its `packageManifest` identifies the source SHA, archive, OS and device. Its `receipt` locates the native result, saved report, screenshot and startup log. The same index locates the two tracker snapshots.

## Integration history (18 November 2026)

The integration candidate at `4e0bb19` includes bounded overlay resizing and the 2D drawing width fix. Its gate had 4,183 passes, 12 skips and the same three desktop QA failures as main. See the eight merges with `git log --first-parent --merges edc47a4..4e0bb19` and the issue 8 regression with `git show 4e0bb19`.

- **O2.** On a 1280 x 720 display, the handle at (470, 56) accepts a new drag after resizing a photo to 860 x 641. Closing three of six photos exposes the slide’s Close button at (786, 298). Native Windows fast drags, DPI and display edges, capture cancellation and click-through still need checking in both themes. See the O2 sections in `git show 4e0bb19:HANDOFF.md`.
- **TK-14.** Main includes placeholder cleanup in OK Filow answers and complete bracketed card fields. The final parser keeps main's behavior for malformed cards and preserves whiteboard labels. The “TK-14 final fix round” in `git show 4e0bb19:HANDOFF.md` records the 43 differential cases, nested fields and stream-boundary checks.

C6, C12, C23, C27 and C28 are held on `audit/fixes-0.9.42` for an eval-driven track.

## Measurements and open checks

- **Local voice.** [Speaker selection and queue measurements](docs/okfilow/VOICE-NATURAL-2026-11.md) and [pronunciation and endings](docs/okfilow/VOICE-NATURAL-ROUND2.md) include the listening sets and the owner’s first-round choices. Acceptance of round 2 remains open.
- **Local answers and install cleanup.** [Hardening evidence](docs/design/paid/HARDENING-2026-11-14.md) covers pointer-only answers, prompt scope, account limits and model ownership. Native runtime removal remains open.
- **Wake word.** Merged on 15 November at the owner's request, off by default and gated by personal enrolment. The [wake-word evaluation](docs/okfilow/WAKE-WORD.md) records the no-ship recommendation, false accepts, CPU target and outstanding owner trial.
- **Paid preparation.** [Safe preparation](docs/design/paid/SAFE-PREP-2026-11-14.md) records the packaged updater, billing and captions checks. [Paid readiness](docs/design/paid/STATUS.md) tracks the remaining acceptance gates.
- **Answer latency.** [Phase 2b measurements](docs/perf/LATENCY-2026-11.md) cover standard CPU results, sample exclusions and outstanding GPU, microphone and phone checks.
- **Releases.** [R2 verification evidence](docs/releases/R2-VERIFY-2026-11-14.md) covers the installer audit and outstanding manual smoke and publication checks.
- **Scorecard.** See [score recovery](docs/autoloop/FIX-SCORE-2026-11-14.md) for the measurements and evidence expiry.
- **Overlay motion.** The [final 2B rework](docs/okfilow/OVERLAY-R2B-REWORK4.md) records the sampled frame results. Owner visual and native checks remain open.

## What Filow is

A speaking companion for live presentations. Filow it listens while you present, ticks off your
talking points as you cover them and shows what you skipped. Tagline "Speak freely. Stay on point." /
"Parla liberamente. Resta sul punto." GPL-3.0-or-later since 0.9.18 (was proprietary), © VoidExploit. Surfaces: Windows /
macOS / Linux desktop app (Electron), phone mirror (QR pairing, Cloudflare quick tunnel for any
network), PowerPoint add-in, browser extension, Screen Sense (slide-aware cues from the screen),
slide-to-script generator, on-device Whisper, local decisions through Ollama (Clef), cloud through
OpenRouter with a PII guard (Rizzo-PII) in front.

## Historical branch and release notes (through 12 November 2026)

- [Faster answers, first run and accounts](docs/FAST-ONBOARDING-ACCOUNT.md) records the November 12 implementation and its Windows checks. The “Phase 1 review” in `git show 4e0bb19:HANDOFF.md` records the checkpoint commits, review fixes and merge findings.
- `/account` and the separate `apps/cloud` service implement email/device sign-in, OS-encrypted
  desktop tokens, Stripe checkout/portal and server subscription status. No cloud or merchant
  deployment was verified at this checkpoint. Read `apps/cloud/README.md` before operating it.
- For the account notice and signal, see the [outbound inventory](docs/okfilow/OUTBOUND.md). The [paid readiness record](docs/design/paid/STATUS.md) tracks the deployment gates.
- A dev tour that asks a real question needs the desktop translation bundle rebuilt with `npm run vendor`.

- Landed after the 0.9.30 release (2026-11-06 to 2026-11-10): OK Filow, the screen helper,
  with the outbound notice (nothing leaves the PC without a yes, every send is shown;
  `docs/okfilow/OUTBOUND.md`); a natural voice on this PC (`docs/okfilow/VOICE.md`); speech in five
  languages, English, Italian, Russian, Romanian and Japanese (`docs/stt/LANGUAGES.md`); release
  hardening (single instance, offline privacy policy and About, private problem report, macOS
  permission prompts, `docs/RELEASE-CHECKLIST.md`). Platform notes: `docs/PLATFORMS.md`.

- For B01 through B05, including the native checks still open, see [Sync and stop fixes](docs/audit/sync-fixes.md).

- Offline audit fixes (2026-11-05, `audit/baseline`): B06-B14 from Step 4 are fixed
  in seven commits, with ordinary-test failure/pass output for each bug. Translation
  refuses offline and uses the shared PII guard online; cloud STT tokens refuse offline.
  Desktop preserves profile offline state, stops existing tunnels, refuses setup downloads,
  and offers a local clipboard report. An additional status-route PII health probe leak
  is fixed separately (B15). See `docs/audit/offline-fixes.md` and its output directory.

- Audit Step 3 (2026-11-05, `audit/baseline`): added synthetic EN/IT presentation
  journeys under `docs/gauntlet/corpus/journey-en` and `journey-it`, using the existing
  script/transcript/labels format. Two deterministic keyword-overlap tests cover ordered
  flips, manual reopen preserved in the final state, stop/restart mid-section, and a
  general backup mention leaving retention/restore points open. No production changes
  or speech-quality claims. Replay has no command timeline or final-state result, so
  the tests drive Engine commands and its injected clock/interval directly; automatic
  semantic correction/retraction remains unverified. `npm.cmd test -- packages/core/src/gauntlet.test.ts`:
  5 passed; `npm.cmd test`: 241 passed, 1 existing opt-in skip; `npm.cmd run typecheck`:
  all six checks passed. All exit 0, with `GAUNTLET=0` and temp and npm caches on the workspace volume.
  The initial `npm test -- packages/core/src/gauntlet.test.ts` exited 1 before running
  tests because PowerShell blocks npm.ps1; npm.cmd used without changing execution policy.
  No contract failures or `it.fails` added. No push or release; real speech/model and
  native/UI acceptance remain separate work.

- [Microphone and download recovery](docs/microphone-fixes-2026-11-05.md) records the USB/C920 diagnosis, timeout handling and native checks.
- [One-layout evidence](docs/superpowers/plans/2026-11-05-one-layout-evidence.md) records the final sidebar decision, captures and remaining acceptance checks.
- For the earlier designs, see the [flat review](docs/superpowers/plans/2026-11-04-flat-layout-redesign-review.md), [release fixes](docs/superpowers/plans/2026-11-04-flat-layout-review-fixes.md), [glass review](docs/superpowers/plans/2026-11-03-liquid-glass-ui-review.md), [remaining surfaces](docs/superpowers/plans/2026-11-03-liquid-glass-rest-review.md) and [polish review](docs/superpowers/plans/2026-11-03-liquid-glass-polish-review.md).
- For first-run behavior, QA isolation and remaining OS checks, see the [Welcome implementation](docs/welcome/IMPLEMENTATION.md) and [independent review](docs/welcome/REVIEW.md).

- Public repositories are `stefandsl/filow` (source branch `main`) and `stefandsl/filow-releases` (update feed).
- v0.9.30 (installer Information + Select Components pages) was the public release (2026-11-06,
  CI run 42211883754, feed manifests say 0.9.30). Before it: v0.9.29 (phone sync fixes + stop flush + overlay close button) (2026-11-05,
  CI run 42098611434, feed manifests say 0.9.29). Before it: v0.9.28 (mic picker + offline leak fixes + audit steps 1-4) (2026-11-05,
  CI run 42067234678, all three platforms first try, feed manifests say 0.9.28). Before it: v0.9.27
  (one sidebar layout for both themes) (2026-11-05, CI run
  41994059664, all three platforms first try, feed manifests say 0.9.27). Before it: v0.9.26 and
  v0.9.25. v0.9.25 (2026-11-04; macOS job needed a third rerun of CI run
  41855168600 because GitHub had no macOS arm64 runner; feed manifests say 0.9.25). If macOS runners
  keep failing, rerun with `gh run rerun <id> --repo stefandsl/filow --failed` later; never publish
  without all three latest*.yml.
- Before that: v0.9.24 (flat redesign).
- Before that: v0.9.23 was the public release (2026-11-03, CI run 41728198913, feed manifests say 0.9.23,
  packaged-build gate and icon count run before the tag). Before that: v0.9.22 (2026-11-03, CI run 41720898785, feed manifests say 0.9.22; packaged
  Windows build launched on a clean profile and icon groups counted before tagging). Before that: v0.9.21 (2026-11-03, CI run 41687452972, all three platforms green,
  feed manifests say 0.9.21). 0.9.19 and 0.9.20 were published to the feed the same day and superseded
  within hours (0.9.19 did not start when installed; 0.9.20 had no installer icon). v0.9.18 exists on the
  source repo only (no Linux assets). Before that: v0.8.7 was tagged on 2026-11-02 (CI run 41458509342); 0.8.6 was in the public feed. The public
  v0.8.5 release was deleted (no Windows assets: its installer script failed on CI, which made
  installed apps show "Cannot find latest.yml ... 404"). Never publish a release to the feed
  without `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.
- Release history:
  - 0.9.27 to 0.9.29 shipped the single-sidebar, microphone, offline and sync fixes documented above. The Windows package was launched before the layout tag.
  - 0.9.26: large green tick + green "Detto" label and bar on done points
    (8ef6679); pairing panel reopens after the reload that switching the public link triggers
    (e47bae1, sessionStorage flag in apps/web/lib/pairReopen.ts); resizable next-section rail in the
    dark layout (114c943; that rail and its saved width were removed in 0.9.27, which moved both themes
    to the sidebar layout). Packaged Windows build launched before the tag.
  - 0.9.22 to 0.9.25 moved the prompter from glass to the two flat mockups, then fixed the release review findings. The [flat-layout evidence](docs/superpowers/plans/2026-11-04-flat-layout-redesign-evidence.md) records the captures before the single-sidebar change.
  - 0.9.21: the NSIS installer and the portable exe of 0.9.19/0.9.20 had NO icon resource (generic
    icon in the browser's download list and in Explorer; the installed Filow.exe was fine). The NSIS
    bundled with electron-builder 26 silently drops a PNG-compressed .ico entry, and build/icon.ico
    had its 256 px entry as PNG. `scripts/make-icon.js` now writes every entry as a DIB (381 KB
    .ico) and icon.ico is regenerated; checked with ExtractIconEx: installer, portable and app all
    report one icon group and the extracted icon is the mark. Before tagging,
    build the Windows package locally (`electron-builder --win`), count icon groups and launch the
    packaged Filow.exe on a throwaway profile with welcomeCompleted=true; the dev launch proves nothing
    about packaging.
  - 0.9.20 (hotfix for 0.9.19, which did not start when installed: "Cannot find module 'next'"):
    electron-builder 26 drops a root `node_modules` folder from any `extraResources` source
    (app-builder-lib/out/util/filter.js line 43, unconditional), so the Next standalone shipped
    without its dependencies. The standalone's node_modules is now a second extraResources entry
    (`from ../web/.next/standalone/node_modules, to app/node_modules`); verified with
    `electron-builder --win --dir` (node_modules/next present) and a launch of the packaged
    Filow.exe on a throwaway profile. Also: the welcome window's "Run at startup" always failed
    ("Impossibile modificare l'avvio automatico") because Electron 45 on Windows reports
    `openAtLogin: false` even right after a successful registration under a custom name (probed);
    the readback now trusts the launch-item list and executableWillLaunchAtLogin.
  - 0.9.19: the acrylic window is back. On Electron 45 / Windows 11 26300 a
    `backgroundMaterial: "acrylic"` window with `backgroundColor: "#00000000"` maximizes and goes full
    screen (measured with a probe: only `transparent: true` windows cannot), so the 0.9.11 reason is
    gone; macOS gets `vibrancy: "under-window"`. The 0.9.9 CSS had a bug that made it invisible: the
    selector `:root[data-glass] html` never matches (html is :root), so the root kept painting
    `--bg` over the material; now `:root[data-glass], :root[data-glass] body` are transparent.
    Verified on screen in light, dark and system (the material follows nativeTheme, which the page
    sets through `ui:theme`). Also: `build.executableName: "Filow"` (electron-builder 26 derived
    `@filowdesktop` from the package name and refused the Linux AppImage: v0.9.18 has Windows and
    macOS assets only and was NOT copied to filow-releases; the next tag supersedes it), and the
    installer calls SHChangeNotify(SHCNE_ASSOCCHANGED) after install to refresh stale shortcut icons.
    The first-run design covers language, startup, system theme and system accent color.
  - 0.9.18, licence: relicensed from proprietary to GPL-3.0-or-later
    (LICENSE = SPDX text, package.json `license` fields, README badges, installer licence pages
    `apps/desktop/build/license_*.txt` = short notice + privacy paragraph + full GPL text).
  - 0.9.18, dependencies: `npm audit` went from 40 findings (4 critical) to 15
    moderate. Bumped next 15.3.3 → 15.5.28, vitest 3 → 5.1.0, electron 33.4.11 → 45.2.1 (also
    `build.electronVersion`), electron-builder 25 → 26.18.0, office-addin-manifest/dev-certs 1 → 3;
    root `overrides` pin sharp ^0.35.5 and postcss ^8.5.32 (next and transformers pulled vulnerable
    copies; sharp is now an optional dependency of apps/web so npm keeps it installed). Verified:
    110 tests, typecheck, web build, PowerPoint build + manifest validate, `desktop:build:win`
    (installer + portable + latest.yml) and a 25 s launch of the app on Electron 45 (no
    deprecation warnings). The 15 left are minimatch < 11 (globparts DoS) and rimraf/temp under
    electron-builder's own tree: minimatch 11 dropped the CommonJS default export that glob 7 and
    @electron/asar 3 call, and no release of those packages uses it yet, so they cannot be cleared
    without breaking the packager. Build tooling only, nothing shipped. Re-check after the next
    electron-builder release. The build rewrites `apps/powerpoint/manifest.xml` (new Id) and adds a
    BOM to `apps/desktop/build/license_*.txt`: revert those before committing.
  - 0.9.18: `PUT /api/script` and `POST /api/local/plan` now require the engine
    token while `ACCESS_PASSWORD` is set (first item of the bug-hunt handoff). Reproduced on the dev
    server first: an anonymous caller overwrote the script file and ran the plan with `apply`.
    The prompter's save and `fetchPlan` (prompter Auto start and Settings) now send the token;
    `PUT` also answers 400 instead of crashing on invalid JSON. Route tests added for both.
  - 0.9.17: "Translate to" in the points editor: `POST /api/script/translate` (engine token,
    OpenRouter, GENERATE model) rewrites the "# / -" script in en/it/ro/ru/de/fr/es keeping the
    structure; the editor shows the result and a status line (model, section/point count, mismatch
    warning); saving stays manual. Checked in the dev server: IT → EN, 4 sections, 15 points.
  - 0.9.16: 33 fixes from an external bug hunt (report and its handoff in `docs/bughunt/`), applied
    as one patch: PII map collision, PowerPoint pane recreating its engine, auto-start probe fooled by
    the "…" placeholder and leaking a mic/socket on timeout, ElevenLabs reconnect after stop,
    download hanging on a dropped connection, extension script skipping slides before the current one,
    `parseDecisions` accepting "false", list-marker stripping eating leading numbers, CARD regex,
    notes placeholders, gauntlet late flips, current-session origin check, and smaller ones. Typecheck
    and the 107 tests pass. Gauntlet metric: `correct`/recall now exclude late flips (new `late`
    field); delays still include them (my change on top of the hunt's). The hunt's 96 unverified
    suspicions are listed in `docs/bughunt/2026-11-03-handoff.md`; the ones worth doing first are the
    unauthenticated `PUT /api/script` and `POST /api/local/plan`, cancel during the mic probe, and
    the committed-segment join without a space in `engine.ts`.
  - 0.9.15: one icon everywhere: the compact "O + cradle" mark at every size (ico 16-256, icon.png 512
    for macOS/Linux, favicon, extension 48/128), owner's choice after two PCs showed different icons
    (the ico mixed the mark below 64 px with the full tile above). `node scripts/make-icon.js`
    (there is no `npm run icon` script despite AGENTS.md).
  - 0.9.14: diagnostics. Crashes (main uncaught/unhandled, renderer or child process gone) are written
    to `startup.log` with a CRASH marker. Help > "Report a problem…" (also a button on the take log)
    opens a prefilled issue on the PUBLIC repo stefandsl/filow-releases with version, OS, CPU/RAM/GPU,
    the take log (the page sends it to main over `diag:takeLog`) and the tail of startup.log; the
    user reviews and submits in the browser, nothing is sent automatically. Over ~7800 chars the
    body goes to the clipboard instead (browser URL limit). Not tested in a packaged build yet.
  - 0.9.13: restored microphone capture from 0.9.6 and removed the Electron audio switch; everything else (gate, unload, ElevenLabs
    error reporting, glass CSS) stays. The 0.9.7–0.9.12 capture is in git history (`git show
    v0.9.12:packages/stt/src/mic.ts`). Open question: on the Windows test system the mic track ends 4 s after
    start in every backend; the capture code was identical from 0.9.1 (when it transcribed) to 0.9.6,
    so the cause may be on that PC (exclusive-mode app, driver, Windows privacy). Next step there:
    test with "Browser (Web Speech)" (no AudioContext) and check Windows Sound > mic > Advanced.
  - 0.9.12: on the Windows test system, capture starts after 14 s whatever the sample rate, then "no audio ... track
    ended" (also in local mode). Diagnosis: Chromium's out-of-process audio service hangs and restarts,
    ending every capture track. `main.js` now passes `--disable-features=AudioServiceOutOfProcess`;
    mic.ts logs the peak level after 3 s and reports a track "ended" event at once. To verify on that PC.
  - 0.9.11: the acrylic window of 0.9.9 removed (a transparent-background window cannot maximize or go
    full screen on Windows; the owner hit it). The glass look stays in CSS; `--filow-glass` is no
    longer passed, so `data-glass` is never set (the CSS rule is harmless and kept).
  - 0.9.10: the audio context opens at the device's own rate and the worklet resamples to 16 kHz
    (linear interpolation, checked in Node: 48 kHz → exactly 16000 samples/s, pitch kept). Asking
    Windows for a 16 kHz context on the test USB mic (C-Media 0d8c:016c, native 48 kHz) blocked
    the whole app for 14 s (take log 21:46). The desktop log file is `%APPDATA%\@filow\desktop\startup.log`.
  - 0.9.9: frosted-glass look. `globals.css`: glass tokens (`--glass*`, `--glow-*`), a soft brand glow
    on the page, translucent blurred panels/buttons/modals in both themes (`@supports backdrop-filter`).
    Desktop: Windows 11 (build >= 22000) gets `backgroundMaterial: "acrylic"`, macOS `vibrancy:
    "under-window"`; the page is told through `--filow-glass` (preload `glass`) and sets `data-glass`,
    which makes its background transparent. Checked in the browser (dark/light); the acrylic window
    itself is not verified on a Windows 11 PC yet (this laptop was not rebuilt): if it looks wrong, drop
    `backgroundMaterial` and the transparent backgroundColor in `apps/desktop/main.js`.
  - 0.9.8: the take hung in "Starting" after "transcription ready" on the Windows test system: the mic probe
    opened and closed the device, then the capture opened it again and that second open never
    returned. `preopenMic()` (packages/stt/src/mic.ts) opens once at the check and the capture reuses
    the stream; every step (open, audio context resume, worklet load) has a timeout with a message.
    Not reproduced here (no such driver); verify on the 3070 PC. The frosted-glass wish shipped in 0.9.9.
  - 0.9.7: "Unload from memory" for a loaded Ollama model (`/api/local/unload`, keep_alive 0) in
    Settings and as a cross on the dashboard chip (the RTX 3070 test system sat at 7.5/8 GB VRAM).
    ElevenLabs: every error/warning message (`message` field: auth_error, quota_exceeded_error,
    input_error, insufficient_audio_activity_error, ...) now reaches the take log; before, they were
    dropped and a take looked live with no transcript. Mic capture resumes a suspended AudioContext,
    logs device + setup time, and reports "no audio from the microphone" after 4 s without PCM.
    The reported 33 s connection without transcription still needs reproduction:
    the next take log on that PC will say which of the two it was.
  - Step 3 + state validity (0.9.6): embedding gate `packages/core/src/gate.ts` (pattern from
    Priler/jarvis, no code copied; MiniLM multilingual through transformers.js: Node embedder
    `apps/web/lib/gate/embedder.ts` for the gauntlet, Web Worker `lib/gate/embed.worker.ts` +
    `lib/gate/client.ts` with a per-script vector cache in localStorage for the app). Settings
    "Pre-filter before the model", off by default; `useEngine` wraps the decide call when on.
    Gauntlet `GAUNTLET_GATE=1`; numbers in `docs/gauntlet/BASELINE.md` (3/17 calls skipped,
    recall equal or better, latency within cloud variance: measure with Clef on the 3070 PC
    before making it the default). Engine epoch guard: replies from before a script reload,
    section change, reset, manual mark or start/stop are dropped and the in-flight call aborted
    (`engine.ts`, six tests). `docs/gauntlet/REUSE.md`: licence/strategy table for the reference
    repos (Jarvis, VoiceCue (unlicensed), my-prompter, moves-cli, prompter, promptme-ai,
    SallyZhou9527/prompter, STT-Presentation-Review). The November 2 plan set the order: measures and state correctness → less redundant work → EN/IT quality → hardware
    profiles; ro/ru stay roadmap (the Spoken-language setting already lists them for the STT only).
  - 0.9.4–0.9.5: Windows .ico fix (DIB entries below 256 px), hotkey shown as key caps.
  - Model router (0.9.3): `apps/web/lib/router.ts` (pure, unit-tested) + `/api/local/plan` (inventory,
    hardware, one measured call per candidate) + `lib/plan.ts`. Start mode Auto runs it at every
    Start and starts with its picks (STT backend + decision provider; slide generation applied
    server-side via GENERATE_PROVIDER/GENERATE_LOCAL_MODEL env). Settings "Automatic setup" panel
    with reasons and "Measure now". Also: model extraction moved off the main thread (the app showed
    "not responding" while unpacking the 475 MB Nemotron archive), small icons (0.9.2), ElevenLabs
    language + reconnect and OpenRouter throughput routing (0.9.1).
  - Step 2 (0.9.0): streaming STT in the desktop app. `apps/desktop/stt.js` downloads the Nemotron
    3.5 streaming int8 archive (475 MB, GitHub k2-fsa/sherpa-onnx "asr-models") into
    userData/models and runs it with `sherpa-onnx-node` in a worker thread (`stt-worker.js`,
    unpacked from asar). `packages/stt/src/sherpa.ts` is the page-side backend ("sherpa"): mic PCM
    over IPC, partials + committed sentences back. Local mode prefers it when the model is present.
    New "Spoken language" setting (auto/en/it/ro/ru). Measured 105 ms per 560 ms chunk on this
    laptop's CPU. Target languages are now en, it, ro, ru (brief updated). Not yet: installer page
    checkbox for the model (first-start auto list handles "nemotron-streaming"), Intel-Mac addon in the
    x64 dmg built on an arm64 runner (falls back to Whisper), a real-speech English check.
  - Step 1 + confirm rule (0.8.17/0.8.18): see BASELINE.md.
  - Gauntlet Step 0 and Step 1 done (0.8.17): replay harness (`packages/core/src/gauntlet.ts`, runner
    `apps/web/lib/gauntlet/run.test.ts`, seed corpus `docs/gauntlet/corpus/demo-it`, first baseline in
    `docs/gauntlet/BASELINE.md`: OpenRouter p50 1.5 s/call, precision 1.0, recall 0.78, median delay
    7 s = the two-call confirm rule). Engine: aborts slow calls and reports "slow model" instead of an
    error, paces to the model's speed, max 4 questions per call; Clef warm-up with keep_alive -1;
    Whisper language hint and whisper-tiny. Also fixed: OpenRouter 400 (models list capped at 3).
  - Phone on the Wi-Fi: fixed and confirmed by the owner (0.8.14, Windows only): the QR used a VirtualBox adapter;
    interfaces are now ranked (default route first, virtual ones last), Windows Firewall rule offered
    at first start and from the pairing dialog, adapter picker there too.
  - Local-mode latency: gauntlet brief v2 (`docs/local-latency-gauntlet.md`, after an EGM review) and
    the lap-1 council report (`docs/gauntlet/REPORT-lap1.md`). Finding: the 4 s Whisper windows and the
    two-call confirm rule dominate latency (9–12 s mouth-to-tick), not the model. Recommended stack
    for low-spec: Nemotron 3.5 streaming STT via sherpa-onnx + MiniLM embedding gate + NLI verifier;
    nothing implemented yet. Next: Step 0 (test corpus + benchmark harness) and Step 1 (hygiene:
    keep_alive, non-blocking decision calls, question cap, catalogue sizes).
  - Settings: explicit memory per model (download, VRAM, RAM, measured when loaded); Clef Flash is
    11 GB. Dashboard also on the prompter page. Cancel button on pulls. Liquid model is lfm3-vl.
  - Settings dashboard (`/api/local/resources`, `apps/web/lib/sysinfo.ts`): live CPU, RAM, GPU
    memory/load (nvidia-smi, Windows GPU counters, Apple unified), which Ollama models are loaded and
    whether they sit on the GPU or in RAM (`/api/ps` size_vram), best-option advice. Start mode
    "auto" picks local when the models are there and the GPU (6 GB VRAM) or RAM (16 GB) can hold them,
    else cloud; the start dialog shows the pick and why.
  - Screen Sense: REC chip + Stop button in the top bar, system notifications on start/stop.
  - Region picker rewritten in the style of classic screenshot tools (Greenshot is GPL-3.0, so no
    code was taken): the display is grabbed first, shown frozen and dimmed, full-screen crosshair,
    4x magnifier with pixel grid and coordinates, size label, Enter = whole screen, Esc / right
    click cancel. The crop comes from the same frozen frame (`apps/desktop/picker.html`,
    `pickRegion` / `captureRegion` in `main.js`).
  - Cancel button on a running pull; Liquid vision model renamed to `lfm3-vl`; Ollama pull errors
    shown as they are.
  - Installer page: intro gets three lines (it overlapped the list), detects an existing Ollama
    (`%LOCALAPPDATA%\Programs\Ollama`, Program Files) and already-pulled models
    (`the Ollama model store's manifests directory`): those lines say "already installed",
    are unticked, and the Ollama box is greyed out with a "nothing to download" label.
  - Installer custom pages in all 11 installer languages (auto-detected from Windows, no chooser),
    a reason on every model line (recommended / RAM / disk / GPU), cumulative disk rule.
  - Local AI chosen from the hardware: NSIS page scans RAM / GPU / free disk and preselects models,
    `apps/desktop/localai.js` scans + recommends + installs Ollama unattended (Windows silent
    `OllamaSetup.exe`, macOS `Ollama.app`), first-start dialog on macOS/Linux/portable, Settings page
    shows the phases and pulls the models (`?auto=...&ollama=1`).
  - Settings page gets an engine token itself (`ensureEngineToken`), so Pull / Delete / Test work in
    the desktop app (before: "engine token required (ACCESS_PASSWORD is set)").
  - OpenRouter fallback list + 429 retry in `apps/web/lib/openrouter.ts` (Google free-tier models get
    rate-limited upstream at busy hours).
  - Brand kit applied everywhere (`brand/`, `npm run icon`, `Wordmark` component, palette in
    `apps/web/app/globals.css`, splash, README header). Italian README (`README.it.md`).
  - Start take asks Cloud or Local with readiness checks (`StartModeDialog` in `Teleprompter.tsx`,
    pref `prefs:startMode`).
  - Visible update flow (electron-updater, chips/banner, system notification, menu "Check for
    updates", `startup.log` in the profile folder).
  - CI attaches installers straight to the release from each OS job (artifact storage quota hit
    twice before); artifacts only for manual runs.

## Platform acceptance

See [platform status](docs/PLATFORMS.md) for the Windows, WSLg and phone-browser checks and the remaining real-device tests.

## Upcoming work

See [PLAN.md](docs/PLAN.md) for product tickets, owner decisions and release acceptance.

## Native acceptance evidence

- Offline fixes still need native acceptance: real tunnel termination, download refusal,
  and the EN/IT clipboard report dialog. Phone-sync and Sherpa-stop seam failures are
  fixed in source; real phone/network, native audio and packet inspection remain unverified.

- Verify the new picker on the USB/C920 test setup in packaged Electron and exercise a
  stalled model download there. Browser QA uses simulated devices/capture; download tests use
  fake streams, not the network. Source fixes are complete, native acceptance remains pending.

- The owner’s visual review, native behavior, live pairing and hardware FPS checks remain open. See the [single-sidebar acceptance record](docs/superpowers/plans/2026-11-05-one-layout-evidence.md) and the [glass test plan](docs/superpowers/plans/2026-11-03-liquid-glass-ui.md).
- Welcome acceptance: Windows visual controls/maximize/acrylic QA is pending computer-access
  approval for Electron. Packaged Windows startup registration/sign-in/update/path-with-spaces,
  Windows 10 fallback/high contrast/scaling/Narrator and macOS/Linux device checks are unverified.
  No startup registration has been created by source QA. Keep these separate from unit-test claims.

- A standalone makensis build checked the hardware-scan values. Native checks remain open for
  the installer page, Ollama silent install, the Mac first-start dialog and `Ollama.app` unzip,
  the presenter overlay and slideshow follow, and the browser extension on a reveal.js deck.

- Screen Sense lists `qwen3-vl` as planned in `apps/web/lib/localModels.ts`. At this baseline frames go through OpenRouter.
- The public-link default at this baseline is on in `settings.remoteShare`.
- The brand kit icon won over the mascot explored in the ignored `design/` folder.
- Ollama installation on Linux is manual and the official script needs sudo.
- The previous tracking plan, including the Jarvis notes and the RTX 3070 gate comparison command, is preserved in `git show 368f019:HANDOFF.md` under Pending.

## Known gaps and traps

- The offline audit uses local `OLLAMA_URL`; configured remote Ollama remains an explicit
  destination, and the local daemon's own model-pull networking is not intercepted by Filow.
  In-flight cloud requests/downloads and already-open sockets were not cancellation-tested.
  Temporary test output was stored on the workspace volume.

- Web Speech uses the system default. For PCM device selection and synchronous AudioContext startup delays, see the [microphone diagnosis](docs/microphone-fixes-2026-11-05.md).

- `npm run desktop:build:win` on the Windows test system fails in electron-builder's winCodeSign extraction
  (symbolic links need Developer Mode); CI is the way to build installers.
- `next dev` and `next build` must not run at the same time in `apps/web` (shared `.next`):
  "Cannot find module for page: /_document".
- Port 4747 is usually taken by the installed app; use 4799 for a dev server, and kill stale ones by
  PID (`netstat -ano | findstr :4799`).
- `APPDATA` alone does not isolate Electron's `userData`; use the new absolute
  `FILOW_USER_DATA_DIR` override for QA (also relocates sessionData). Without it, source runs share
  the real profile (`%APPDATA%\@filow\desktop`). `install-choices.json` there triggers the first-start
  model downloads and is deleted after reading.
- NSIS: define page functions inside `customPageAfterChangeDir`, finish-page functions inside
  `customFinishPage`, variables inside `!ifndef BUILD_UNINSTALLER`; `${Using:StrFunc}` is not
  accepted by the NSIS 3.0.4 that electron-builder uses (hence `FilowContains`). The System plugin
  silently returns nothing in an ANSI build, so a test harness needs `Unicode true`.
- Office caches add-in manifests; after changing `manifest.xml`, clear
  `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` or bump the manifest version.
- Tests: `apps/web/lib/pii/*.test.ts` pin `PII_SERVER_URL` to an unused port because Rizzo-PII really
  may already be running locally.

## How to syntax-check the installer page locally

Save this harness as `tmp/nsis-check.nsi` in the checkout. Run the compiler from the repository root.

```
Unicode true
!include MUI2.nsh
!macro StdUtils.ExecShellAsUser a b c d
!macroend
!define StdUtils.ExecShellAsUser "!insertmacro StdUtils.ExecShellAsUser"
!define SHORTCUT_NAME "Filow"
!define APP_EXECUTABLE_FILENAME "Filow.exe"
Var launchLink
OutFile "tmp\nsis-check.exe"
!include "apps\desktop\build\installer.nsh"
Function .onInit
  !insertmacro customInit
FunctionEnd
!insertmacro customWelcomePage
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "English"
Section
  !insertmacro customInstall
SectionEnd
```

```bash
N=%LOCALAPPDATA%/electron-builder/Cache/nsis/nsis-3.0.4.1
"$N/Bin/makensis.exe" //NOCD "//X!addincludedir $N\Include" "//X!addplugindir $N\Plugins\x86-unicode" tmp/nsis-check.nsi
```

## Continuing development

See [METHODOLOGY.md](docs/METHODOLOGY.md) for factory commands, model routing and review.

### Package and release

Follow [PLAN.md](docs/PLAN.md) and the [release checklist](docs/RELEASE-CHECKLIST.md) for owner-approved packaging and publication.

### Other open items

- 15 moderate npm audit findings inside electron-builder's own tree (minimatch < 11): re-check at the
  next electron-builder release.

## Additional evaluations

- [Small items](docs/okfilow/SMALL-ITEMS.md) covers notice copy, local dates and overlay finishing, including the observed label overlap during abrupt turns.
- [Local lesson gauntlet](docs/gauntlet/G2-LESSONS.md) records the rejected and incomplete candidates, the frozen protocol and the held-out topics left unscored.
