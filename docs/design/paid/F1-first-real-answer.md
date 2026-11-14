# F1 First real answer

Proposal, 2026-11-14, main `d320837`; PLAN.md v6 sections 4, 5b, 5c, 6, 8. The trial and subscription choices remain open. A guided animation or scripted highlight is not a real answer about the person's screen.

## First-run branches

| | With trial | Without trial |
|---|---|---|
| First real answer | Explain recipients, sign in, activate the proposed 3-answer/7-day trial, explicitly select managed answers, show consent, ask about a safe screen the person chooses | Scan hardware and existing models; reuse a suitable installation or offer a suitable local download, then ask a real question |
| Cost | Up to 3 bounded answer costs plus failed attempts, email and hosting; S2 cap applies; no card or automatic conversion proposed | No Filow provider spend; download size, disk and waiting time fall on the PC |
| Offline | Trial cannot send; offer local setup | Existing local setup works; missing downloads wait for an explicit online choice |
| After first answer | Offer local setup through existing `/api/local/pull`; show remaining trial answers | Offer the managed plan as a separate choice only when owner gates and L1 permit |
| Failure | Show S3's typed state and offer local setup; no silent provider/model change | Explain missing model, runtime or resources; no silent paid fallback |

Recommended default: a small trial after approved P0 economics and S4a duties, because an 8 GB PC otherwise cannot be promised a quick first visual answer. No-trial remains a complete supported branch, but the owner must accept download time and text-only first use on modest PCs. If the subscription excludes managed answers, this trial branch is invalid and needs redesign. Price and paid allowance are not set here.

Reuse `apps/web/app/tour/page.tsx` and the existing first-run video as orientation, followed by a distinctly labelled real question. In `apps/desktop/main.js`, `tour:ask` accepts a language and the shell picks the practice question; it does not take arbitrary page-provided screen questions. Keep that trust boundary. The real question should go through the normal OK Filow panel and its consent, screen-sharing and Stop controls. Successful onboarding means the person can identify a correct useful answer on their chosen screen, not merely that the tour's predetermined mark appeared.

## Hardware tiers, honest timing and limits

Read `packages/core/src/profile.ts` `recommendProfile()`, `setupChoices()`, `diskNeededGb()`, `missingModels()`; `apps/desktop/localai.js` `hardwareScan()`/`scan()`/`profileOf()`; and `docs/perf/LATENCY-2026-11.md` in full. The Phase 2b measured CPU standard approximation uses four P-core threads, affinity 0x55, simulated 16 GB/8 logical CPUs and lfm3-vl. Physical RAM was not capped. It is not an 8 GB laptop benchmark.

| Tier | Verified existing choice | Timing evidence and proposed first-answer acceptance |
|---|---|---|
| Lite, ordinary 8 GB CPU PC | `recommendProfile()` chooses lite absent suitable GPU; `setupChoices()` chooses lfm3-vl text mode with >=6 GB RAM and disk room; otherwise no answer model | No Phase 2b lite distribution. Existing `screenAnswerS:7` is a profile budget, not measured F1 performance. Propose text first-content <=10 s p95 and 30 s first-content timeout, subject to real 8 GB measurements. No screen-understanding promise in text mode. |
| Standard CPU approximation | Pictures with lfm3-vl; current budget 12 s | First token **6,561 ms warm / 10,172 ms cold** medians, p90 **6,722 / 10,508 ms**, n=45/31. Say about **6.6 s warm, 10.2 s cold**. Proposed acceptance median no worse than these baseline medians and p90 <=7/11 s on the same harness; real customer-device target p95 <=15 s first content, to be verified. |
| Advanced/GPU | Advanced threshold includes compatible 8 GB VRAM plus 16 GB RAM, or 32 GB Apple unified memory; model sharing can hold up screen answers | Phase 2b fast run has zero counted samples. No GPU latency promise. Proposed p95 <=5 s warm /15 s cold first content must be measured; when Clef competes for a small GPU, offer standard setup, never hide a long wait. |
| Managed trial/paid | Proposed S2, any adequate desktop that can run the app | P0 and extra-hop latency unmeasured. Proposed p95 <=5 s first content and hard 20 s first-content timeout, 60 s total generation, not a sales claim. |

Proposed local per-answer hard limit: 30 s to first content and 90 s total; clear progress/cancel after 10 s, with an explicit retry or setup choice on timeout. These are new F1 limits, not what the code does: `askOllama()` in `apps/web/lib/buddy/providers.ts` currently permits 180 s and `setupChoices()` can declare 300 s for shared-GPU advanced answers. Confirm the shorter limit on cold models before changing it. Do not include model download in inference latency; show size, progress and Cancel separately. Propose first useful managed answer within 3 minutes of first-run launch excluding user idle time; local first-answer time is download duration plus setup and inference, so no unconditional "first minutes" promise.

Phase 2b first sound is 8,314 ms warm (n=2) /12,567 ms cold (n=1); these tiny samples cannot prove a voice speedup. One empty answer stopped a repeat; real-model speaking Stop has no valid measurement. Deterministic Stop/Resume passed separately. Dense text, real desktop/UI Automation, physical microphone/speaker, actual 8 GB memory pressure and GPU cold runs remain **not verified**. Keep Phase 2b as a requirement by default; dropping it is an owner waiver of evidence, not evidence of performance.

## 8 GB, existing Ollama and capabilities

An 8 GB CPU-only PC gets local speech/matcher and text-only lfm3-vl answers if memory/disk checks pass, not an automatic screen model download that implies fast visual help. Explain: EN "This setup answers from your words. It does not read your screen." IT "Questa configurazione risponde alle tue parole. Non legge lo schermo." Offer explicit managed screen answers if trial/paid access is available. A suitable discrete GPU can change the recommendation; do not classify solely from RAM. Under 6 GB or without room, use S3's no-local-model state and keep the rest of the app usable.

`apps/web/lib/modelRoles/tasks.ts` `canSee()` prefers reported `vision` capability, with name heuristics only when capabilities are absent. `apps/web/lib/modelRoles/resolve.ts` `capabilitiesOf()` calls `/api/show`, caches by base/name/digest and is currently private; export/reuse it as v6 requests. `listSource()` reads installed tags and capabilities. A model name alone is insufficient proof of working vision. Proposed first-run validation: synthetic picture/question smoke on an existing vision model; text-only models stay text-only. Existing remote Ollama remains a separately consented recipient, not "on this PC".

`apps/desktop/localai.js` `probeOllama()` reads `/api/version`; `installOllama()` can accept an answering existing installation. Preserve it and its model store, configuration and running workloads. Do not replace it just to match the catalogue. Offer update only with a plain explanation and explicit user choice. **Minimum compatible Ollama version: not verified.** No tested numerical minimum can be derived from these files. Proposed release requirement: maintain `MIN_OLLAMA_VERSION` from the oldest version that passes `/api/show` capability, selected-model load, streamed `/api/chat`, image input, cancellation and pull tests on each supported OS. A version below it gets a repair/update path; an unknown version gets capability probing, not an invented version claim. This remains a blocker for F1 implementation acceptance.

## Model drive and uninstall

`packages/core/src/hardware.ts` `ollamaModelsDir()` uses `OLLAMA_MODELS` or the home `.ollama/models`; `freeGbAt()` measures the nearest existing parent. `localai.js` `scan()` uses these. `apps/desktop/main.js` also reads `OLLAMA_MODELS` for disk-model discovery. These reads do not prove that an independently running Ollama inherited the same variable.

Proposed setup: show the resolved model drive and needed download plus spare space before starting. For a Filow-managed new runtime, choose a user-approved absolute non-system drive on this workstation (G:/E:), persist the exact `OLLAMA_MODELS` value for the runtime's launch context and keep a local ownership manifest. For an existing user installation, show its effective store; do not silently change its environment or move files. If the effective runtime store cannot be established, say "not verified" and do not claim that checking Filow's environment checked Ollama's drive.

Across an Ollama update: snapshot the chosen path/settings, update only with permission, restart the owned runtime, verify the effective directory and installed tags, then perform a small test pull under an isolated test store. An update that loses the environment stops setup; never redownload silently into C:. Moving a store is a separate explicit operation with space check and manifest verification, not a side effect of update. On this workstation stop if C: is below 20 GB and never place test data/caches there.

`apps/web/app/api/local/pull/route.ts` `POST()` validates catalogue membership and streams Ollama NDJSON with cancellation; `DELETE()` allows catalogue model names, not ownership. The latter must not be used as proof a model belongs to Filow. Proposed ownership manifest records runtime installed-by-Filow, canonical store, model name/digest, pre-existing status and successful pull time. Uninstall defaults to preserving models. Offer a separate unchecked "Remove models downloaded by Filow" list with sizes, excluding all pre-existing/shared/unknown files. Remove through runtime APIs after rechecking identity; preserve shared blobs and user-installed Ollama. Offer runtime removal only if Filow installed it and reuse is excluded or explicitly confirmed. `apps/desktop/build/installer.nsh` has no verified ownership-based cleanup flow; a cross-platform uninstall implementation is still required.

## Captions and clean-VM judge

`scripts/make-intro.mjs` writes an 18-second video and `intro.en.vtt`. A translated transcript is not five subtitle tracks. Proposed: author en/it/ru/ro/ja VTT from the same three timed segments, language-select the track in welcome and tour, retain a readable translated transcript and a skip button. Verify timing, overflow, keyboard, reduced motion, silent playback and language changes. Do not edit product strings or assets in this documents-only task.

Extend `tools/autoloop/e2e/onboarding.mjs`, which already requires an empty profile, puts temp/profile files on G: and supports `--no-ollama`, `--offline`, prerecorded mic and keyboard checks. Its existing point-tick/accessibility checks are not the whole F1 judge.

1. Clean Windows VM with no model/runtime, 8 GB physical allocation, no GPU; repeat with standard hardware and a compatible GPU. Empty isolated profile/store, known sourceSha and installer hash; no installed owner profile.
2. Exercise trial and no-trial flows separately, account absent, expired trial, network down, no disk, download interruption/resume, denied screen sharing and Offline. Measure launch-to-useful-answer, downloads separately, first token, first sound, full answer and Stop. Predeclare thresholds above; no excluding failures from the completion rate.
3. Existing Ollama with a suitable model, text-only model, unknown capabilities, older unsupported version and user-custom store: no replacement, no double download, no data loss. Verify a digest change invalidates capability cache.
4. Real question about a safe VM screen with independent human correctness check; scripted tour mark never earns credit. On lite, verify truthful text-only mode and explicit managed alternative.
5. Stop during download, thinking and speech; Resume buffered speech versus new generation. Ensure no post-Stop sound/mark, no hidden managed fallback and correct trial counts.
6. Upgrade Ollama and Filow, reboot and verify model drive. Uninstall both preserve-default and opt-in cleanup: pre-existing model/runtime hashes remain untouched.
7. All five caption tracks and transcripts; EN/IT complete journey in light/dark, keyboard-only and narrow/zoomed layouts. P0 and pilot supply provider evidence under a cap; this judge has not run.

## Differences from the plan

The reusable tour exists, but it does not establish a first real answer. `capabilitiesOf` still needs export; no numeric minimum Ollama version is verified. Catalogue deletion is not ownership-based uninstall. Five caption tracks are not generated. Standard CPU results are real but are an approximation, not proof for 8 GB machines; GPU/lite targets remain proposals. Existing 180/300 s bounds are incompatible with a quick-answer promise. Owner trial/provider choices must precede a final F1 flow.
