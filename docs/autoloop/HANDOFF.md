# Autoloop handoff (items in files owned by other sessions)

## For the OK Filow session (apps/desktop/okfilow*, apps/web/lib/buddy, apps/web/app/okfilow)
- SEC-02: add `sandbox: true` to the 3 webPreferences in `okfilow.js` (lines ~145, ~208, ~306). Verified safe pattern: `okfilow-preload.js` only requires electron; main.js windows run sandboxed fine (CDP probe: bridge intact).
- SEC-06: `okfilow.js` ~102 and ~104 call `shell.openExternal` after a regex test; route them through a URL-parsing allowlist like `openExternalSafe` in main.js (https, http, mailto only).
- SEC-13: `okfilow.js:43` and `main.js:19` enable QA switches in packaged builds when `okfilow-qa.flag` sits next to the exe. A user-writable file must not unlock test hooks: gate on a build-time constant (e.g. an env baked at package time for QA builds only) instead.
- BUG: the live overlay showed the raw tag text "[CIRCLE:420,500,15:Photosynthesis: Light-dependent reactions:..." as its label (CDP probe of /okfilow/overlay, 2026-11-08). A tag that fails to parse (label containing ":" or an unclosed tag) is leaking into the visible text. This is likely the user's "photosynthesis" report.
- SEC-05: `okfilow.js:697` ipcMain handler without a sender check.

## For the P1 tracking session (packages/core/src/engine.ts, gate.ts, docs/gauntlet/corpus)
- BUG (T1 take probe, 2026-11-10): "Reset section" does not really reset. `resetSection` in engine.ts clears the points, streaks and `lastSent` but keeps `this.committed`, so the next tick asks again about words said before the reset and re-ticks the points within 1-2 s (20-minute probe run: 278 resets, each re-ticked from old text, cycles of 1.3-2 s). Expected: only speech after the reset counts (drop or fence the committed text at reset). Repro: `node tools/autoloop/e2e/take.mjs --minutes 20`, then `cycles` in tmp/autoloop/take.json.
- UX (same probe): with clef-flash at ~1.0-1.1 s per call (this PC), `slowMs` (> 2 x the 500 ms tick) shows "slow model: N ms per call" for the whole of every local take. Either the threshold or the message needs a look; T2 (latency) may own the fix.
- TRK-1/TRK-2 in the score read the newest `docs/gauntlet/results/clef-local*` or `ollama*` result file (`summary.recall`, `summary.falseStarts`). Please write local results in that shape so the loop can track them.

## From the 2026-11-09 scheduled run (I18N-01, elephant review)
- OK Filow session: `apps/web/lib/buddy/text.ts` has its own `en`/`it` tables (lines ~2 and ~71). `Record<OkfKey, string>` enforces key parity at compile time but not {placeholder} parity or non-empty text. Reuse the check in `packages/core/src/i18n.test.ts` (import `PLACEHOLDER` from @filow/core).
- Whoever owns `apps/desktop/main.js`: inline `it:` objects (around lines 158, 624, 1235, 1377) plus en/it ternaries (around 1625) are outside DICTIONARIES, so they have no parity check. Consider moving them to `packages/core/src/i18n.ts` (main.js already loads it through vendor/i18n.js).

## From the 2026-11-10 scheduled run (branch autoloop/2026-11-10)
- Orchestrator, urgent: on main no take can start in the packaged app. The CSP added on 2026-11-09 has no `blob:` in script-src, so the microphone worklet fails ("Failed to load worklet module script: blob:..."). Track T1 already fixed it on its branch (commit 94eab53, apps/desktop/csp.js); this run confirmed both the failure on main and the fix in a throwaway package. Merge that commit first.
- T3 onboarding or the owner: every start without an OpenRouter key shows a dialog "Add your OpenRouter key / No OPENROUTER_API_KEY set" (main.js, end of main()), also for people who only use local mode. Seen on each launch of the test profile. It is now in Italian for Italian users, but whether it should exist at all is a product choice.
- TRK-2 session: when `failStartup` lands, its "Filow failed to start" title is the one sentence the new dialog guard test allows; read it from MENU_TEXT if the settings are loaded by then.
- P1 / TRK-2 session (packages/core/src/gate.test.ts:168): "the lexical scores ... are prepared once and reused" asserts wall-clock time (< 5 ms per call). It failed at 7.1 ms during a coverage run with a build going on beside it. Count calls or compare against an unprepared run instead of a fixed time.
- T6 OK Filow: apps/desktop/okfilow.js:688 ("Pick a folder outside drive C:, which is full.") and other texts there are English only; /okfilow/panel and /okfilow/overlay show 0 tab stops when opened in the main window, so their keyboard flow needs a walk inside their own windows. A voice question in the panel opens the microphone without telling the shell (`setTakeLive`), so an update prompt can still appear then.
- T7 / T8: English-only labels in apps/desktop/localai.js:15-24 and stt.js:159-160.
- T5 PowerPoint: the pane runs its own engine with no desktop bridge, so the shell cannot know a take is live there; the shell does treat a running slideshow as "presenting".
- Whoever owns packages/ui: StageView (phone mirror, PowerPoint pane) ticks points without a live region; the region and the `.sr-only` class now live in apps/web only (PointsList.tsx, globals.css).
- SEC-08: `allowed()` in main.js grants all of "media" (camera too) and notifications. The standard asks for microphone and display-capture only.
- Coverage of the update texts: MENU_TEXT (updateReady, updateRestart, updateLater) repeats update.ready, update.restart, update.later of the shared dictionary with different wording.
