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
