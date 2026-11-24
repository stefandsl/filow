# Filow delivery plan | 19 November 2026

Hand the owner a Windows package they can use on stage and at their desk. Record a verdict for each use on the same build. Either can go into private use first. Publish a new installer when its own trust, upgrade and download checks pass. See the [first-hour guide](GUIDE-START-HERE.md) and [factory rules](METHODOLOGY.md).

**Starting point.** The 18 November push put `368f019` on main. It contains `4e0bb19` and its fixes. The prepared full Vitest run had 4,217 passes, zero failures and 12 skips. The three historical desktop QA failures came from a missing generated hardware bundle. Issue 8 is closed. The branch cleanup removed 92 names and kept a backup. Live Windows ARM inspection remains open. The last public installer is v0.9.42. [Public v0.9.42 download](https://github.com/stefandsl/filow-releases/releases/tag/v0.9.42)

## Defaults Sheet

Use these defaults for planning. Data transfer, paid usage and publication each require explicit approval. The project owner can revise each decision independently.

| Decision | Recommended default |
|---|---|
| First audience and device | Owner on Windows x64 with their usual nearby or Bluetooth mic, LAN phone and synthetic lesson. Run EN and IT. Publish capabilities only for combinations actually tested. |
| Compute and cost | Use an approved cloud provider for demanding work. Start users who choose private mode on an available local route. Require explicit approval for paid research and disclose separate provider charges. |
| Classroom and control | LAN pairing first. Keep public sharing off until a scoped grant. Use an on-screen Stop and an independently handled keyboard Stop. Ask before changing target or sending an attachment. |
| Daily use | Local list with stable IDs, device time zone and visible Undo. One tap enables listening in Day-by-day. A shortcut is optional. Leave lecture and call speech isolated. |
| Model selection | Start with the simplest qualified decision route. Test Liquid d1 against alternatives. Offer one measured local recommendation and reuse compatible weights in place. |
| Data and evidence | Use synthetic lesson material. Keep brief local diagnostic metadata for seven days, with immediate deletion available. Retain raw recordings only for a specifically consented trial with an expiry. |
| Extensions | Pilot local CLI/MCP from subscribed clients. Enable personal recipes by choice. Leave Microsoft sync, plugin discovery, schedules and billing off initially. |
| Distribution and identity | Keep `com.intelliprompter.app`. Use CI installer builds. Prepare trust and policy evidence early. Only the owner promotes a specific verified version. Keep paid service a separate decision. |

### Limits for recording a website action

- Never ship reverse-engineered third-party endpoints as a Filow feature for all users. Exclude private Google endpoints. Never share a user's generated clients or personal recipes with another user.
- Require per-site opt-in for the user's own account and permission from the site operator or its terms. Before capture, show “This site's terms may forbid automation. Continue only if the site permits this use.” Show the target and a visible signal during capture and replay. Get separate permission to replay. Bind each run to the approved account, action and turn. Provide Stop and revoke.
- Never capture passwords, login or MFA exchanges, payment, checkout or bank flows. Observe only explicitly permitted screens and operations. Stop observation before unknown pages, frames or redirects. Never record a raw HAR.
- Keep all recording-derived data on this PC. Leave credentials and cookies under browser control for normal authentication with the approved site. Exclude them and all capture data from models, relay, telemetry, sync, Filow-managed backups and exports. One-click **Delete site data** stops work, revokes grants and removes the local clients, recipes, derived data and dedicated recording partition.

## Now

Nine tickets. N-01 pins the build. N-02 protects both paths. N-03 and N-04 deliver the stage trial. N-05 and the text part of N-06 deliver the daily trial. N-07 records each verdict as it arrives. N-08 runs alongside product work. Start the trust work in N-09 immediately. Release the tested feature set and label any held capability.

### N-01 Pin the working baseline

Record the remote SHA, ancestry, local changes, open issues and build inputs. Use a clean worktree. Match CI's desktop vendor step and dictionary cleanup before Vitest. Save the current exit codes for tests, typecheck and lint. Log native checks separately. Preserve the branch bundle. Keep the five held audit fixes isolated for labelled evals. Reopen an issue only with a fresh reproduction. [Windows CI preparation](../.github/workflows/desktop.yml)

- **Requests** R-003, R-024, R-088, R-148

### N-02 Make first use and sharing explicit

From a fresh install find Talk or type, see mic state, recipient and data, and finish one task. Repeat with missing provider configuration, denied mic, exhausted quota and provider outage. Record setup time, prompts, downloads and what still works privately. Support the cloud trial with an approved provider configuration. Exercise a fresh and upgraded profile. LAN pairing must work. Trace launch, pair, decline, grant, revoke and fallback. Expect zero unapproved public connections or sends and a visible indicator on approved sends. A provider change needs its own grant. Seed a fake name, sentence and token. Inspect crash files, retention, report preview, browser URL and actual requests including cancel and copy. [Pairing and diagnostics](../apps/desktop/main.js) · [Outbound inventory](okfilow/OUTBOUND.md)

- **Requests** R-017, R-048, R-087, R-152, R-156

### N-03 Keep the speaker’s place

Use a nearby mic, then Bluetooth. In EN and IT, digress, correct a phrase, reconnect the mic and resume. A partial highlights a possible match. A final revision can retract it. See evidence, green Done, missed and next on desktop and LAN phone. Try a late Next, clicker, Stop and Reset. Keep the manual reopen. Save the last committed point locally. Interrupt speech worker, relay, renderer and main. Time recovery. After a full restart, resume with mic muted and pending actions paused. Record the noise, alias and near-next-point cases separately. Borrow bb's shared point IDs.

Bluetooth and real phone checks await the owner's hardware test.

- **Requests** R-013, R-016, R-078, R-104, R-143, R-149, R-151

### N-04 Teach one lesson and perform one permitted action

On the packaged desktop, show a named photo and a water-cycle diagram. The teacher asks Filow to open one named lesson URL. Bind approval to this speaker, target, action, payload and turn. Check the browser actually opened that page once. Filow explains which control cools the air, points to it, waits for the learner to move it, checks the new state and explains condensation. Both screens resume at the preselected next point. Repeat with decline, changed window, classmate speech, assistant audio and takeover. Expect no extra grant, next-point tick or input after Stop. Interrupt just after dispatch and reconcile the effect before resuming. Freeze a teacher's key, units and arrow directions. A learner applies the idea to a new example. Any critical factual error fails. Label prepared boards and grade live generation separately on an unseen topic. Use Nod's scoped approval and grokbot's observed action result. [Lesson evidence](gauntlet/G2-LESSONS.md)

- **Requests** R-030, R-031, R-051, R-154

### N-05 Use tomorrow’s list for real

Start at installed launch. Enable Day-by-day by tapping Talk. Dictate two tasks for tomorrow, such as sending slides and printing worksheets. Report that the slides reached their recipient and check that only the matching task is completed. Correct the report and check that the task reopens. Undo affects only that revision. A partial, quote, repeated final, ambiguous reference or unrelated lecture must never silently change the list. Ask which person if needed. Show the evidence behind suggestions. Test keyboard, screen reader and typed entry. Kill the app after a tick, cross local midnight, reopen on day two and change the unfinished task. Repeat with another date locale. The owner uses their own two non-sensitive tasks over two days. Borrow To Do's daily view.

- **Requests** R-144, R-145, R-146, R-147, R-157

### N-06 Measure a useful decision before choosing a model

Freeze labels, speaker and album splits, machine and limits before tuning. Start with 100 utterances including negation, similar names, self-correction and no match. Include all five languages as probes and report EN and IT separately. Compare current matching, local d1-2B and a classifier qualified for each language. Suggested pilot bar per advertised language: at least 80% correct automatic ticks on clear completions, zero false ticks on held-out negatives and at most 20% clarification on clear inputs. Show denominators and uncertainty. Failing routes offer confirmation. Route teaching intent and layout through the same bounded choices. Open-ended teaching gets its own factual test. Live generation is HELD. On a frozen unseen topic, main had 3 critical errors in 19 graded lessons and N-04 had 3 in 20. Require zero critical errors in at least 20 graded lessons on a new frozen topic.

Time real Bluetooth speech with deck and mic active. Give one request ID to last audible word, VAD, partial/final STT, queue, inference, paint and phone. Publish cold/warm p50 and p95 to first correct and complete correct result, all attempts, misses, timeouts and RAM/VRAM by tier. Freeze usable time limits on the measured baseline with the owner before claiming gains. Keep the v17 comparison open if its trace is missing. Compare four-question rotation and Clef direct/gated where applicable. Photo recall continues in X-05. [Prior latency measurements](perf/LATENCY-2026-11.md)

- **Requests** R-038, R-150, R-158

### N-07 Put a usable package in the owner’s hands

Give the owner the matching Windows installer or private package, full source SHA and SHA512. Use an isolated test profile. Time cold startup through first visible feedback, check installer progress, icon, tray and actual first use. Inspect both themes, keyboard focus, Narrator and 200% scale. Record two separate lines with package hash, device, mode, date and PASS or HOLD. One is the N-04 lesson. One is the N-05 two-day list. Hand over each passing route immediately. Rerun both on the final shared hash. A failed route stays disabled or clearly held in a narrower release. A dev server or an older unpacked O2 build cannot earn either receipt.

- **Requests** R-008, R-010, R-025, R-026, R-070, R-133

### N-08 Make the factory work from a clean clone

Register the three verbs, qualify the pinned helpers and ship the runner fixture for the tracked [sanitized practice ticket `N-08-PRACTICE`](../tools/factory/N-08-PRACTICE.json). Use existing tools while this runs in parallel. Let an unaided junior make a visible edit, stop mid-run, resume in a new session and show evidence. Record time, outside help and duplicate effects. Enforce flagship routing, independent review, the standing offline experiment and a skill correction on every agent failure. Prove stale green evidence produces a red verdict. Show measured spend or unknown. [Command contracts and rules](METHODOLOGY.md) · [First exercise](GUIDE-START-HERE.md)

- **Requests** R-057, R-064, R-141, R-165, R-166, R-167, R-168, R-169, R-170, R-171, R-172, R-173, R-174, R-175

### N-09 Deliver and verify a public download

The owner pins version, identity, signing and final policy text against the public checklist. Verify Windows signature, timestamp and SmartScreen on a clean non-admin PC, Mac notarization and Gatekeeper, and a real supported Linux install. Include previous unsigned to signed upgrade, persisted list, talk, settings, progress, idle update and Install and Relaunch. Use CI if local signing extraction hits the symlink limit.

Before live use, pass the four [R10](REVIEW.md) offline tests for a moved tag, a rejected push, missing evidence and a non-main checkout. The release runner pushes only a recorded, verified full 40-character SHA from a clean local `main` and stops on every non-zero exit. The owner runs verify-main, preflight and tag against that SHA. Wait for Windows, macOS and Linux CI. Verify all 17 source assets and the three manifests. Create the feed draft. Match the clean Windows smoke digest to the draft installer. Before live publication, drill recall and forward recovery on a disposable feed. Exercise recall before download, after caching and after install. Point Latest to good, withdraw bad, and roll affected users forward to a higher fixed version with data intact. Publish, set Latest last, then download each live manifest and its referenced bytes and verify hashes. Confirm updater-driven upgrades on advertised routes. Announce the remote main SHA and the tested public URL with version and SHA512 as separate receipts. [Owner release checklist](RELEASE-CHECKLIST.md)

- **Requests** R-005, R-009, R-043

## Next

Pull each pilot when its dependency works. Keep it off the first download path.

### X-01 Let the listener follow in another language

Start an IT to EN exchange as soon as a stage build exists, then reverse it. A speaker who pauses or rephrases keeps their place. Compare live audience captions, translated voice with mic ducking, and optional presenter readback. A bilingual reviewer checks corrections, negation, numbers and units. A listener explains a new example. Record text and speech outcomes separately. Qualify the installer-provided local route disconnected.

- **Requests** R-082, R-155

### X-02 Drive Filow from a subscribed client

Start when N-04 has one stable action. Install the packaged CLI and register local MCP in compatible clients such as Codex and Claude. From each client, read the active session, complete a permitted task, cancel another and revoke the grant. Test expired authentication, a replay and denied reads. Run the pilot with Filow's own cloud provider disabled. Record provider charges separately. Extend the same validated handlers to slide navigation, diagrams and desktop guidance after each grant is enforced.

- **Requests** R-161

### X-03 Reuse existing local models

Check the inventory before any local demo download. Open a compatible Ollama model or GGUF in place. Record actual path, weight bytes written and downloaded, and free space. Both byte counts must be zero for a complete shared model. Fetch only missing verified parts by choice. Show active model, fit, size and one recommended option. Test Lite, Standard and Advanced with speech and slides active, including a larger model and out-of-memory recovery. Uninstall and open the original weights in the original app. Compare Pinokio, Hugging Face, Mirage, PrismML and Gemma only on matched tasks with license, RAM, accuracy and latency evidence. A text-only hybrid route previews local OCR before transfer.

- **Requests** R-035, R-074, R-096, R-097, R-128, R-134, R-163, R-164

### X-04 Prove wider computer use and teaching parity

Record five matched HeyClicky jobs on the same supported OS, layout and target. Include native and browser workflows, an unfamiliar canvas, target switch, attachment refusal and takeover. Trial 20 labelled screens at 100%, 125% and 150% DPI. Report completion, wrong clicks, first correct cue and last effect after Stop. A named job keeps its plan, history, files, resource limits, pause, steering and actual result. Test slow pages and Bluetooth completion alerts during recording. Sending an approved file needs a grant for that recipient. Repeat a drawing in Paint offline. Grade cloud and private lessons on unseen topics by hardware tier. Only measured pairs earn a parity claim.

- **Requests** R-040, R-042, R-045, R-046, R-047, R-099, R-136

### X-05 Find and use the right visual

Label 50 consented or synthetic photos, including tiny handwritten formulas, diagrams, tables and empty matches. Compare SigLIP 2 plus crops/OCR with a vision decision route. Freeze album recall, false inclusion and complete-result time limits before tuning. Count misses outside the shortlist. Correct then project. Compare the v17 car sketch, labelled slide, playable GIF/video and saved board. Test six overlapping items, continuous native resize, Esc, Close, click-through and typed focus in both themes and on ARM when available. Try a ready diagram part by ID and a graphics fallback. Use Khan Explainer and FigJam as references. Recover the original GIF settings before changing new-machine defaults.

- **Requests** R-023, R-036, R-061, R-065, R-067, R-069, R-080, R-089, R-098, R-110, R-111, R-112, R-113, R-121, R-137, R-159

### X-06 Create a personal workflow by voice

From empty Settings, describe a ticket-note and calendar recipe. Name it, preview the note, change the second step and run it after restart. Install one pinned plugin explicitly. Enforce grants in the host, including a denied file read outside its scope. Revoke calendar access and keep the reviewed note. Disable the plugin and confirm the main screen stays simple.

- **Requests** R-162

### X-07 State exactly who can finish each task

Publish separate UI, STT, voice, decisions and translation results for EN, IT, RU, RO and JA. Include native review, noisy speech, negation and language switching. Document the Japanese tokenizer or character error rate. Check real first-audio delay and recognition against the recorded targets. A keyboard and screen-reader user must complete, undo, refuse and stop in high contrast at 200% scale. Test PowerPoint and a browser deck, Android/iOS rejoin, Mac and Linux. Split Windows x64, x64 emulation on ARM and native ARM. Record mic, native hooks, local inference, action, update and uninstall per tested route. Mark untested hardware and the unspecified Microsoft 365 app explicitly. [Platform inventory](PLATFORMS.md)

- **Requests** R-075, R-076, R-132

### X-08 Keep speech and typing reliable across apps

Test hands-free and hold-to-talk in four real apps. Preserve the full phrase and selected field, prevent password-field paste and explain clipboard recovery. Keep the idle helper compact. Show listening and thinking, retain answer style, direct typed input once and recover after unplugging audio. Compare audio.cpp and the current backend on real accuracy, noise and release-to-text latency by tier.

- **Requests** R-039, R-044, R-068, R-083, R-084, R-085, R-100

### X-09 Pilot Google voices and translated captions

Pilot Gemini Flash-Lite TTS for short answers and Flash TTS for whiteboard narration. A Gemini API key is required for this pilot. Compare both voices with Cloud Chirp 3 HD, ElevenLabs and the local voice on the same scripts. Blind-rate intelligibility, lost words, names, numbers and units. Measure time to first audible speech and cost per finished minute on the packaged app. Keep ElevenLabs as a fallback until the comparison is complete. Test a missing key, quota exhaustion, Stop and offline use. Keep each provider subject to its own N-02 consent.

Pilot Cloud Translation Advanced through its EU endpoint for finalized captions on the paired phone. Check IT and EN in both directions with X-01. The owner can use NotebookLM to draft lessons from cleared sources and review the result before teaching. Defer Gemini Live to a separately approved live-audio trial. Use documented Google APIs only and exclude private Google endpoints. Verify current quota, pricing and terms for the intended audience before rollout.

- **Requests** R-176

### X-10 Follow the message as Filow explains a diagram

Bring Super Board's motion to Filow's whiteboard so a learner can follow a transfer, replay it or identify its direction with reduced motion. Work in the lesson player, Excalidraw renderer, scene and sequence metadata, pacing, CSS and screenshot harness. Reuse the lesson voice, reading clock and board themes.

**First slice.** Animate explicitly identified directed lesson edges and sequence-template messages. Draw a small signal along the prepared arrow from sender to receiver once in the current step's time slot. Briefly outline the receiver on arrival. For multiple eligible edges, use their reveal order. Use the template's actor and message identities for a sequence. Keep the stroke, label and static direction legible on completion. The effect is presentation state. On pause, step change, edit or replay, cancel the old cue before showing the next state.

**Acceptance.** Open the whiteboard and play “How does the TCP three-way handshake work?” Watch SYN travel Client → Server, SYN-ACK travel Server → Client, and ACK travel Client → Server as each message is explained. The receiving end visibly responds. Both participant names and earlier arrows stay legible. Go back to the reply and replay it. Only the reply travels. Pause mid-reply and wait. The board settles with its arrowhead and label visible. Switch the board look and repeat. In reduced motion and Lite, the reply, direction and recipient remain identifiable without a moving signal. A formula or plot-only step shows its normal drawing.

**Verification.** Use a fake provider with record 3 from `apps/web/lib/whiteboard/fixtures/cloud-r3.json` and run the local sequence-template case as a second path. Exercise the actual lesson page at 1280 × 720 with a controlled clock. Capture the start, midpoint and arrival of the same SYN-ACK in light and dark, six PNGs named `x10-{light,dark}-reply-{start,mid,arrival}.png`. Show the owner the two three-frame sequences side by side. Also check replay cancellation, static reduced motion, a note-only step, a moved endpoint and reopen/export. Opening an older board without relationship metadata must still work. Compare PNG and Excalidraw exports for stable positions and a clean final board. Check the WebM path explicitly because the recorder samples live SVG styling. Use the live-page harness for motion evidence. The standalone diagram screenshot harness can check static layout in both themes. Run the existing whiteboard tests, typecheck and lint.

Use an existing fixture or saved lesson. Approve the slice when the reply's reversal is clear both in motion and in the static frame. Node inspection and nested views can follow separately.

**License.** Implement the effect in Filow with its own artwork. If Super Board code is copied, identify the file and pinned revision. Keep its source attribution and include the full MIT copyright and permission notice and applicable third-party notices in Filow's distribution. Use original assets where rights are unclear. [Super Board license](https://github.com/EricTechPro/super-board/blob/d0b7d5a6850614ca809477c1af43d5d7da408726/LICENSE) · [Bundled notices](https://github.com/EricTechPro/super-board/blob/d0b7d5a6850614ca809477c1af43d5d7da408726/skills/visual/THIRD_PARTY_NOTICES.md)

- **Requests** R-062, R-120 (whiteboard foundations)

### X-11 Repeat one owner-approved lesson lookup by voice

**Goal.** In a packaged Windows build, let a presenter demonstrate “show the next exercise” on a Filow-controlled lesson site, name the lookup and repeat it by voice after restart. Use one operator-approved, read-only lookup, local recognition and a recipe checked by the desktop host. In a dedicated browser partition, store only the approved operation ID and its permitted fields. Run after N-04 provides scoped approval and Stop. Apply the [recording limits](#limits-for-recording-a-website-action).

**Acceptance test.** On a synthetic loopback lesson site, opt in with the teacher account after sign-in. Record the lookup, review its site, account and result field, and save it. Change the exercise on the server and move its button. Restart Filow and invoke the saved name in EN and IT. The current title must appear exactly once, with Recording and Running visible at their respective stages. The slide position and daily list must stay unchanged. Decline, account switch, revoke, changed schema, forbidden screen, Stop before dispatch and one-click deletion followed by restart must each prevent an unauthorized result. A classmate's speech must not authorize dispatch.

**Verification.** On the same machine and site, run ten paired trials with the approved click workflow and the voice shortcut. Measure from the end of the command to the correct visible title, including approval time on both paths. Report success count, median latency, requests and wrong targets. Pass the pilot with ten correct voice results, zero wrong targets and a lower median than the click path. X-04 owns any wider HeyClicky parity claim. Use synthetic cookie, password and payment markers to test the boundary. Assert the observer is detached on forbidden flows and markers never reach recorder callbacks, files, logs or agent messages. Block all non-loopback traffic during the trial. Verify Stop before and after dispatch, expiry, deletion after restart and zero calls from a second profile. Save only synthetic results and timings on the project drive.

**Risks.** A layout change may be harmless while a server change alters meaning. Pin the operation contract and stop on drift. A stale account or queued request can use an old grant. Bind the host check to the live account and turn immediately before dispatch and invalidate pending results on Stop. Prompts can leak session data into generated code. Keep the stock generator outside the signed-in path.

- **Requests** R-154, R-162 (related lesson and personal workflow requests)

### X-12 Give speech fixes a reproducible EN/IT scorecard

**Goal.** Give the R1 reviewer a same-case comparison for [held fixes C6, C12, C23, C27 and C28](audit/AUDIT-0.9.42-HANDOFF.md). Start with C12 and reuse Filow's production matcher, guard, parser and navigation paths as each fix enters review. Build the offline comparator and speech suite in Filow's Node toolchain. N-06, X-04 and autoresearch can reuse the report format.

**Acceptance test.** An independent labeller freezes versioned EN/IT development and reviewer-held talk groups with positives, negatives and ordinary controls, keeping paraphrases from the same talk together. Start with unpunctuated C12 cases where “later” or “alla fine” genuinely postpones a point and cases where the presenter has moved on to it. Replay identical events on the pinned base and isolated candidate. Produce a paired scorecard with expected and observed states for each case, counts and denominators by language and defect, false ticks, misses, section moves and development case IDs that flipped. List the status of all five fixes. A fix advances only with improvement on its target, no loss in either language, no new prohibited tick or section move, and passing ordinary controls. The comparator can pass its pilot while a patch receives HOLD.

**Verification.** Run focused Vitest coverage for the comparator and replay, then use the Node comparator on frozen baseline and candidate results. A baseline self-comparison must report no flips. Inject a forbidden tick and a compensating fix and require a named regression and nonzero exit even if aggregate accuracy stays flat. Reject missing case IDs and stale candidate digests. An independent reviewer runs the reserved split once per frozen arm and checks the receipt against the candidate, manifest, scorer and comparison digests. Add the replay check to [R1](REVIEW.md), run the existing gates and attach an independent PASS or HOLD with EN and IT counts. Keep each patch isolated until its own evidence passes.

**License.** Implement the comparator in Filow. If substantial upstream code is copied or vendored, pin the source revision and retain the full MIT copyright and permission notice. [Eval Harness license](https://github.com/lxlynx/eval-harness/blob/2a73972c6af2cb2b302e7571d0bed91ab2c97fd5/LICENSE)

- **Requests** R-177

### X-13 Continue a decision or factory assignment when an approved model runs out of quota

**Goal.** In a Cloud take, apply ordered routing rules to a pending decision. Check task fit, context, spend and consent, then try the configured primary and the user's ordered, eligible fallbacks on quota or availability failures. Include a qualified route already on this PC. Private mode uses only on-device routes. Pilot FreeLLMAPI as an optional fallback gateway when it can enforce the approved destinations before dispatch and identify the provider that actually answered. Require consent for the data kind and named recipient before each send, including to each serving provider behind a gateway. Show the destination before each attempt and visibly name the provider that answered. Let the factory resume an exhausted role on an approved flagship with its grants, checkpoint and independent review intact. Build on N-02, N-06, N-08 and X-03. Keep X-09 voice grants separate.

**Acceptance test.**

1. Start a packaged Cloud take with a synthetic transcript, local speech and one expected tick. With only the primary approved, force a 429, then repeat with a 503. A ready local route completes once and the unapproved provider receives zero requests. Approve the second cloud recipient and rank it ahead of local. Repeat through a pinned FreeLLMAPI route and check that the second provider completes once. The outbound signal names each destination and the final signal names the provider that answered.
2. Repeat with a legacy gateway grant, a revoked secondary grant, an opaque route and Stop during retry. Count zero sends to unapproved destinations and zero new attempts after Stop. In private mode, disconnect the network and repeat with local weights present, then missing. Observe a qualified local result or a visible manual choice, zero off-device requests and zero automatic weight downloads.
3. Inject quota exhaustion in a synthetic factory packet. Resume on a role-approved flagship from the last verified checkpoint. Record the actual provider, model, effort and fresh session. Observe one completed effect and a different underlying reviewer vendor for consequential work. When only an ineligible alternate remains, verification returns HOLD.

**Verification.** Use two counting provider mocks, a pinned gateway fixture and a local adapter. Correlate order, grant, destination, reason, timing, result and visible signal by request ID. Check absent or mismatched gateway receipts, retryable and terminal errors, shared retry limits, cooldowns, cancellation and a late first answer. FreeLLMAPI quota-exhaustion fallback remains unverified. The earlier fallback used an invalid-model error. Verify actual quota exhaustion on an approved route before claiming support. Replay N-06's held-out EN/IT decisions and record false ticks, clarification rate and cold/warm p50 and p95 per route. Attach redacted counts, packaged Windows evidence for Cloud and private modes, and the factory checkpoint, replacement assignment and verifier result. Qualify Responses streaming, tool results and interrupted continuation before enabling a factory gateway. Run the existing gates and exclude payloads and keys from evidence.

**License.** Implement the routing rules in Filow's TypeScript. If substantial upstream code is copied or vendored, pin the revision and retain the full MIT copyright and permission notice. Check FreeLLMAPI's pinned license and applicable notices before distributing it. [Model Router license](https://github.com/lxlynx/model-router/blob/80ba22fb777e0aaf4092942bfc7e8e5bf598ee8c/LICENSE)

- **Requests** R-178

### X-14 Act in another app through one measured driver

**Goal.** After N-04's grant gate works, let the user ask Filow for one small action in another app and see it done, confirmed by a fresh read of that app. Every action passes one `ActionDriver` interface and Filow's own grant gate. The eval chooses the driver: [agent-desktop](https://github.com/vercel-labs/agent-desktop) headless (pinned tag, built and signed by us, MCP stdio child), Windows-MCP, or Filow's own UI Automation act helper. Keep Filow's read-only screen helper for pointing. No driver ships in the default download until it passes. Build on N-04, X-02 and X-04.

**Acceptance test.** On a clean non-admin Windows 11 profile with loopback-only network, run a fixed 30-task set at 100%, 125% and 150% DPI. Each positive task ends with the effect read back from the app. Decline, a changed window, classmate speech, assistant audio, Stop before and during dispatch, an elevated target, a password field and Filow's own window each prevent any input. After Stop no input reaches any app. Headless actions never change the presenter's foreground window or pointer.

**Verification.** Five repeats per task per driver with one fixed planner model. Report success rate, steps, median and p95 latency, wrong actions, focus steals, effect after Stop, refusals and bytes that left the PC, per driver. Pass with zero wrong actions, zero effect after Stop, 100% refusals, at least 90% success on tasks with a rich accessibility tree and a median action of at most 500 ms. A driver that steals focus fails; do not patch around it in prompts. Each dispatch needs a fresh snapshot id. Record the chosen driver, pinned version, SHA256 and the SmartScreen and Smart App Control result. Snapshots stay local and out of logs.

**License.** agent-desktop is Apache-2.0. Keep its notice with any copied or vendored code and pin the revision.

- **Requests** R-179

### X-15 Win back wake recall at the default setting

**Goal.** The Filow wake word merged with fewer detections at Balanced than the previous detector on the same held-out set: Filow 16/30 against 27/30, OK Filow 25/30 against 30/30, Hey Filow 20/30 against 26/30. Italian and Japanese profiles never wake on Filow alone. Restore recall without losing the gains (0 against 4 false wakes in 6 hours, 7 against 12 near-word accepts).

**Acceptance test.** On a new held-out set that no tuning saw, Balanced detects at least as many calls as the previous detector for every form and every language, with no more false wakes per hour and no more near-word accepts. Settings never advises a change that lowers a user's measured recall. The automatic fallback to OK Filow has a test that fails without it.

**Verification.** Freeze the new set before any tuning and record its hash. Report form x sensitivity x language for the new and the previous detector, false wakes per hour over at least 6 hours, and near-word accepts. Packaged replay through the capture seam.

- **Requests** R-180

### X-16 Keep background listening under one core

**Goal.** Background listening for the wake word and live speech uses at most one CPU core on average and no more peak private memory. Preserve wake recall and zero drops. Set thread counts explicitly and share one pool where the runtime allows. Three ONNX Runtime thread pools currently each size themselves to the machine.

**Acceptance test.** Repeat the same packaged 30-minute paced microphone capture with the default wake setting on main and the branch on the same machine. Main used about 6.0 CPU cores on average (5.99 to 6.01), about 1.5 GB peak private memory and had zero drops. The branch uses at most one core on average and no more peak private memory than main. Wake recall on the frozen held-out set stays the same and drops stay at zero.

**Verification.** Report average CPU cores, peak private memory, drops and wake recall on the frozen held-out set for both builds. Repeat the comparison on a low-spec 4-core machine and report the same measures.

- **Requests** R-181

### X-17 Raise correction and near-next accuracy on unseen phrasing

**Goal.** Recover at least 30 of 40 corrections and make at most 5 near-next errors in 40 trials per language, with 0 false accepts per hour. On the spent held-out set, main recovered 0/40 corrections in both English and Italian. N-03 recovered 7/40 in English and 5/40 in Italian. Near-next errors fell from 25 to 17/40 in English and from 19 to 16/40 in Italian. Both builds recorded 0 false accepts per hour.

**Acceptance test.** Before any implementation or tuning, freeze a new held-out set of unseen English and Italian phrasing and commit its manifest hash. Include 40 corrections, 40 near-next trials and ordinary speech per language. Meet all three thresholds independently in each language.

**Verification.** Score the packaged candidate once on the new set. Report correction counts, near-next errors, ordinary-speech hours and false accepts per hour separately for English and Italian.

- **Requests** R-182

### X-18 Label a diagram on the user's screen while Filow explains it

**Goal.** The user opens a diagram in any app, for example a heart picture in the browser, and asks OK Filow to explain it. Filow explains the flow in order. When the voice names a part, a short label appears on that part of the real picture. Labels stay until the answer ends, so the user sees the whole diagram annotated. Filow only reads the screen and draws on its own overlay. It never clicks or types. Reuse the existing point, circle, arrow and box tags, the progressive bubble and the answer voice. X-10 owns motion on Filow's own whiteboard. X-14 owns actions in other apps. Use HeyClicky's diagram explanation as the reference.

**Acceptance test.** On the packaged Windows build, open each of 10 frozen diagrams with known part positions: heart circulation, water cycle, a labelled cell, a circuit, a flow chart and five others. Use original or openly licensed pictures in a browser and an image viewer, at 100% and 150% DPI. Ask in EN and IT. Each label appears within 300 ms of the spoken part name and inside that part's frozen box. All labels of the answer stay visible and readable until the answer ends, without overlap and in both themes. Stop and Esc clear the labels at once. Moving or covering the window removes stale labels instead of leaving them on the wrong place. A picture with no matching part gets no invented label. Filow says that it cannot see that part.

**Verification.** Freeze the 10 pictures, their part boxes and the questions with a manifest hash before any tuning. For each run, report correct labels, wrong labels, missing labels, the delay from spoken name to label at p50 and p95, and overlaps, per language and DPI. Pass with zero wrong labels on a part, at least 90% correct labels, and a p95 delay of at most 300 ms. Any wrong label on a medical or safety picture fails the run. Record the provider, the model and the bytes that left the PC. Private mode runs the same set on the local route and reports it separately. Save screenshots at the end of each answer for both themes.

- **Requests** R-027, R-029 (voice and screen assistant, pointing overlays)

## Later/Icebox

Return to these for the named decision or evidence.

### L-01 Try connected lists and scheduled routines

Borrow My Day, assignment cues and shared task identity now. If selected, sync one To Do list and inspect the same task in Outlook. A timed-out write yields one item. Disconnect stops transfers. Planner needs a separate eligible tenant trial. Scheduled routines can be created, changed, paused and deleted by voice under a separate grant.

- **Requests** R-050, R-160

### L-02 Design two-way privacy masking

Use synthetic text, audio, photo and video. Trace identifiers before upload, what the recipient sees, and permitted restoration on return. Specify local mapping lifetime, deletion, residual risks and failure closed. Review the design before implementation. N-02 supplies current protection.

- **Requests** R-153

### L-03 Investigate accounts and a paid service

Reproduce the original authentication symptom before claiming a fix. Study supported subscriber sign-in and a settings panel that isolates and masks provider credentials. A paid pilot needs verified merchant, domain, deployment, trial allowance, actual job usage, repeat follow-ups and account recovery. Keep commercial launch separate from installer availability.

- **Requests** R-004, R-049, R-117, R-129, R-130, R-131

### L-04 Resolve history and prune duplicate instructions

Recover the Nov 5 reproduction steps where available and mark missing evidence. Compare the existing docs, preserve unique instructions and branch backups, and point duplicates at one canonical plan. Native fullscreen and issue fixes stay with their actual tickets.

- **Requests** R-020, R-058, R-079, R-109

### L-05 Measure a different desktop shell

Compare a small Tauri/Rust feasibility build with the packaged Electron path on startup, native hooks, install reliability and maintenance. A rewrite needs measured benefit and its own decision.

- **Requests** R-081

Keep broad 3D asset work after X-05, a public plugin catalog after X-06, and store distribution or a native Windows ARM target after X-07 device evidence. Defer the 24-hour enrolled wake-word trial until the owner can check false triggers, CPU and listening quality. C6, C12, C23, C27 and C28 need independent EN/IT evidence before integration. None gates the first two private outcomes.

## Historical record

Request statuses come from the owner's private request register (not in the repo). A ticket covers the full request. Its first pilot can pass while wider acceptance stays open. The baseline above supersedes earlier evidence on issue 8, the three tests and the public version. [Factory rules](METHODOLOGY.md#factory-rule-status)

<details>
<summary>Show completed and superseded requests</summary>

## Done log

- R-001, R-101 | Jarvis tracking study and Rakazo feasibility research | 0.9.39 planning checkpoint.
- R-002 | Repository access and verified push | edc47a4.
- R-007, R-054, R-127 | Work coordination, independent review and resumable runs | 4e0bb19 integration checkpoint.
- R-011, R-077, R-108 | Tool setup, storage safeguards and efficient context use | edc47a4 checkpoint.
- R-055 | Gauntlet and independent review workflow | 4e0bb19 integration checkpoint.
- R-006, R-018 | Theme treatment and single sidebar | 0.9.22 to 0.9.27. N-07 retains installed theme and control checks.
- R-014 | Five UI languages | 0.9.42.
- R-015, R-019, R-059 | Pairing view retention, microphone repair and hold-to-talk dictation | 0.9.38.
- R-021 | Offline mode and outbound blocking fixes | 0.9.28.
- R-022, R-032 | Phone reconnect and launch shortcuts | ddeddd8.
- R-027, R-028 | Voice/screen assistant and sourced pictures | 0.9.42.
- R-029, R-041 | Pointing overlays and answer captions | 0.9.39.
- R-033, R-034, R-052 | Local answers in five languages and measured cloud defaults | 0.9.41. X-07 retains noisy mixed-language and switching checks.
- R-037, R-063 | Desktop 3D and separate drawing-model role | fdc5408.
- R-053, R-066, R-116 | Provider errors, opt-in memory and adjustable voice speed | 0.9.42 checkpoint, memory recovery at ddeddd8.
- R-056, R-090, R-091, R-093, R-095, R-102 | Easy model choice, cancellable downloads, answer and eye controls, fullscreen bar | 0.9.39.
- R-060 | Dictation cleanup and meaning-preservation fixes | ddeddd8.
- R-062, R-120 | Assistant whiteboard, structured lessons and diagram layouts | fdc5408.
- R-071, R-072 | Consent notices and send indicators on documented paths | 0.9.42, public relay gap tracked in N-02.
- R-073, R-105, R-106, R-107 | Local voice, pronunciation, dates and sentence endings | 0.9.41, board narration by 0.9.42.
- R-086 | Prefilled problem report | 0.9.39 planning checkpoint.
- R-103 | Optional enrolled wake word, off by default | fdc5408. Owner activation, false triggers and CPU remain in the icebox.
- R-114 | Release instructions in the README | 0.9.41.
- R-115 | Owner-authorized fourth media review round | edb2e8a, redesign held.
- R-118, R-119 | Manual Done and granted phone controls | cd71246, phone controls documented in 0.9.42.
- R-122, R-123, R-124, R-125, R-126 | Board library, sample privacy, narrated export, Tab and zoom | fdc5408, includes ff37b6c and b82b028.
- R-138 | Provider placeholder cleanup in cards and drawings | edc47a4.
- R-139, R-140, R-142 | Verified audit subset, identity remapping and cancelled paid decisions | ddeddd8.

## Dropped

- R-012 | On November 5 the owner chose a single sidebar with matching controls in both themes. The November 4 flat-layout brief was superseded. Readability still applies.
- R-092 | On November 11 the owner chose mouse and keyboard for stopping, pausing and resuming answers. A later voice barge-in proposal had no approval.
- R-094 | On November 11 the owner limited the screen eye to its button and shortcut.
- R-135 | On November 18 the owner reopened computer actions with permission. Explain-and-point remains an available mode.

</details>

## Coverage table

<details>
<summary>Show the destination of every request</summary>

| Request | Register status | Destination |
|---|---|---|
| R-001 | Done | [Done](#done-log) |
| R-002 | Done | [Done](#done-log) |
| R-003 | In progress | [N-01](#n-01-pin-the-working-baseline) |
| R-004 | Open | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-005 | Open | [N-09](#n-09-deliver-and-verify-a-public-download) |
| R-006 | Done | [Done](#done-log) |
| R-007 | Done | [Done](#done-log) |
| R-008 | Open | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-009 | Open | [N-09](#n-09-deliver-and-verify-a-public-download) |
| R-010 | Open | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-011 | Done | [Done](#done-log) |
| R-012 | Dropped | [Dropped](#dropped) |
| R-013 | Open | [N-03](#n-03-keep-the-speakers-place) |
| R-014 | Done | [Done](#done-log) |
| R-015 | Done | [Done](#done-log) |
| R-016 | In progress | [N-03](#n-03-keep-the-speakers-place) |
| R-017 | Open | [N-02](#n-02-make-first-use-and-sharing-explicit) |
| R-018 | Done | [Done](#done-log) |
| R-019 | Done | [Done](#done-log) |
| R-020 | Open | [L-04](#l-04-resolve-history-and-prune-duplicate-instructions) |
| R-021 | Done | [Done](#done-log) |
| R-022 | Done | [Done](#done-log) |
| R-023 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-024 | In progress | [N-01](#n-01-pin-the-working-baseline) |
| R-025 | Open | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-026 | Open | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-027 | Done | [Done](#done-log) |
| R-028 | Done | [Done](#done-log) |
| R-029 | Done | [Done](#done-log) |
| R-030 | Open | [N-04](#n-04-teach-one-lesson-and-perform-one-permitted-action) |
| R-031 | Open | [N-04](#n-04-teach-one-lesson-and-perform-one-permitted-action) |
| R-032 | Done | [Done](#done-log) |
| R-033 | Done | [Done](#done-log) |
| R-034 | Done | [Done](#done-log) |
| R-035 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-036 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-037 | Done | [Done](#done-log) |
| R-038 | In progress | [N-06](#n-06-measure-a-useful-decision-before-choosing-a-model) |
| R-039 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-040 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-041 | Done | [Done](#done-log) |
| R-042 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-043 | Open | [N-09](#n-09-deliver-and-verify-a-public-download) |
| R-044 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-045 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-046 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-047 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-048 | Open | [N-02](#n-02-make-first-use-and-sharing-explicit) |
| R-049 | Open | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-050 | Open | [L-01](#l-01-try-connected-lists-and-scheduled-routines) |
| R-051 | Open | [N-04](#n-04-teach-one-lesson-and-perform-one-permitted-action) |
| R-052 | Done | [Done](#done-log) |
| R-053 | Done | [Done](#done-log) |
| R-054 | Done | [Done](#done-log) |
| R-055 | Done | [Done](#done-log) |
| R-056 | Done | [Done](#done-log) |
| R-057 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-058 | Open | [L-04](#l-04-resolve-history-and-prune-duplicate-instructions) |
| R-059 | Done | [Done](#done-log) |
| R-060 | Done | [Done](#done-log) |
| R-061 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-062 | Done | [Done](#done-log) |
| R-063 | Done | [Done](#done-log) |
| R-064 | In progress | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-065 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-066 | Done | [Done](#done-log) |
| R-067 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-068 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-069 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-070 | Open | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-071 | Done | [Done](#done-log) |
| R-072 | Done | [Done](#done-log) |
| R-073 | Done | [Done](#done-log) |
| R-074 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-075 | Open | [X-07](#x-07-state-exactly-who-can-finish-each-task) |
| R-076 | Open | [X-07](#x-07-state-exactly-who-can-finish-each-task) |
| R-077 | Done | [Done](#done-log) |
| R-078 | Open | [N-03](#n-03-keep-the-speakers-place) |
| R-079 | In progress | [L-04](#l-04-resolve-history-and-prune-duplicate-instructions) |
| R-080 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-081 | Open | [L-05](#l-05-measure-a-different-desktop-shell) |
| R-082 | Open | [X-01](#x-01-let-the-listener-follow-in-another-language) |
| R-083 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-084 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-085 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-086 | Done | [Done](#done-log) |
| R-087 | Open | [N-02](#n-02-make-first-use-and-sharing-explicit) |
| R-088 | In progress | [N-01](#n-01-pin-the-working-baseline) |
| R-089 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-090 | Done | [Done](#done-log) |
| R-091 | Done | [Done](#done-log) |
| R-092 | Dropped | [Dropped](#dropped) |
| R-093 | Done | [Done](#done-log) |
| R-094 | Dropped | [Dropped](#dropped) |
| R-095 | Done | [Done](#done-log) |
| R-096 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-097 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-098 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-099 | Open | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-100 | Open | [X-08](#x-08-keep-speech-and-typing-reliable-across-apps) |
| R-101 | Done | [Done](#done-log) |
| R-102 | Done | [Done](#done-log) |
| R-103 | Done | [Done](#done-log) |
| R-104 | In progress | [N-03](#n-03-keep-the-speakers-place) |
| R-105 | Done | [Done](#done-log) |
| R-106 | Done | [Done](#done-log) |
| R-107 | Done | [Done](#done-log) |
| R-108 | Done | [Done](#done-log) |
| R-109 | Open | [L-04](#l-04-resolve-history-and-prune-duplicate-instructions) |
| R-110 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-111 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-112 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-113 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-114 | Done | [Done](#done-log) |
| R-115 | Done | [Done](#done-log) |
| R-116 | Done | [Done](#done-log) |
| R-117 | In progress | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-118 | Done | [Done](#done-log) |
| R-119 | Done | [Done](#done-log) |
| R-120 | Done | [Done](#done-log) |
| R-121 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-122 | Done | [Done](#done-log) |
| R-123 | Done | [Done](#done-log) |
| R-124 | Done | [Done](#done-log) |
| R-125 | Done | [Done](#done-log) |
| R-126 | Done | [Done](#done-log) |
| R-127 | Done | [Done](#done-log) |
| R-128 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-129 | Open | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-130 | Open | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-131 | Open | [L-03](#l-03-investigate-accounts-and-a-paid-service) |
| R-132 | Open | [X-07](#x-07-state-exactly-who-can-finish-each-task) |
| R-133 | In progress | [N-07](#n-07-put-a-usable-package-in-the-owners-hands) |
| R-134 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-135 | Dropped | [Dropped](#dropped) |
| R-136 | In progress | [X-04](#x-04-prove-wider-computer-use-and-teaching-parity) |
| R-137 | In progress | [X-05](#x-05-find-and-use-the-right-visual) |
| R-138 | Done | [Done](#done-log) |
| R-139 | Done | [Done](#done-log) |
| R-140 | Done | [Done](#done-log) |
| R-141 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-142 | Done | [Done](#done-log) |
| R-143 | In progress | [N-03](#n-03-keep-the-speakers-place) |
| R-144 | Open | [N-05](#n-05-use-tomorrows-list-for-real) |
| R-145 | Open | [N-05](#n-05-use-tomorrows-list-for-real) |
| R-146 | Open | [N-05](#n-05-use-tomorrows-list-for-real) |
| R-147 | Open | [N-05](#n-05-use-tomorrows-list-for-real) |
| R-148 | In progress | [N-01](#n-01-pin-the-working-baseline) |
| R-149 | Open | [N-03](#n-03-keep-the-speakers-place) |
| R-150 | Open | [N-06](#n-06-measure-a-useful-decision-before-choosing-a-model) |
| R-151 | Open | [N-03](#n-03-keep-the-speakers-place) |
| R-152 | Open | [N-02](#n-02-make-first-use-and-sharing-explicit) |
| R-153 | Open | [L-02](#l-02-design-two-way-privacy-masking) |
| R-154 | Open | [N-04](#n-04-teach-one-lesson-and-perform-one-permitted-action) |
| R-155 | Open | [X-01](#x-01-let-the-listener-follow-in-another-language) |
| R-156 | Open | [N-02](#n-02-make-first-use-and-sharing-explicit) |
| R-157 | Open | [N-05](#n-05-use-tomorrows-list-for-real) |
| R-158 | Open | [N-06](#n-06-measure-a-useful-decision-before-choosing-a-model) |
| R-159 | Open | [X-05](#x-05-find-and-use-the-right-visual) |
| R-160 | Open | [L-01](#l-01-try-connected-lists-and-scheduled-routines) |
| R-161 | Open | [X-02](#x-02-drive-filow-from-a-subscribed-client) |
| R-162 | Open | [X-06](#x-06-create-a-personal-workflow-by-voice) |
| R-163 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-164 | Open | [X-03](#x-03-reuse-existing-local-models) |
| R-165 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-166 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-167 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-168 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-169 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-170 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-171 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-172 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-173 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-174 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-175 | Open | [N-08](#n-08-make-the-factory-work-from-a-clean-clone) |
| R-176 | Open | [X-09](#x-09-pilot-google-voices-and-translated-captions) |
| R-177 | Open | [X-12](#x-12-give-speech-fixes-a-reproducible-enit-scorecard) |
| R-178 | Open | [X-13](#x-13-continue-a-decision-or-factory-assignment-when-an-approved-model-runs-out-of-quota) |
| R-179 | Open | [X-14](#x-14-act-in-another-app-through-one-measured-driver) |
| R-180 | Open | [X-15](#x-15-win-back-wake-recall-at-the-default-setting) |
| R-181 | Open | [X-16](#x-16-keep-background-listening-under-one-core) |
| R-182 | Open | [X-17](#x-17-raise-correction-and-near-next-accuracy-on-unseen-phrasing) |

</details>

Stage, daily use and public download each require their own observed result.
