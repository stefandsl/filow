# Filow bug report

Source: `filow-main.zip` (uploaded; no git commit metadata). All 102 non-test source files (13,222 lines of TS/JS) were read twice, by a first reader and by an independent reviewer, in 12 slices. That produced 134 suspicions. The 38 rated 3 or higher went to independent provers.

**Result:** 33 confirmed (21 shown by a failing test, 12 confirmed by reading code that can't run here: Electron, Office, browser and React), 5 rejected.
All 33 fixes are applied in `fixes.patch`. Tests and their outputs are in `tests/bugN/`. Fixes marked "verified" passed the prover's test on a patched copy. The others are fixes suggested from reading the code and need a check in the real runtime.

Severity: **High** means ordinary input gives a silently wrong result, loses data, or hangs. **Medium** means a crash on ordinary input, or a wrong result only on unusual input. **Low** is everything else.

## High

| # | Where | Input → expected / actual | Evidence | Fix |
|---|---|---|---|---|
| 3 | `apps/web/lib/pii/guard.ts` `rizzoAnonymize`/`anonymizeRequest` | Transcript has "Mario Rossi" and a bullet has "Luca Bianchi" → restore should give back Mario. Instead both become `[FULLNAME_1]` in one shared map, so **the wrong person's name is restored**. | test (tests/bug3), fix verified | Collect each response into a local map, renumber on collision. |
| 2 | `apps/powerpoint/src/taskpane.tsx` `EnginePane` | Click Start session → one engine should last the whole session. Instead `setToken` changes `headers`, which recreates the Engine. Relay commands and the published state go to the old, **stopped engine**. | reading | Read the token through `tokenRef`; `headers` deps `[]`. |
| 5 | `packages/stt/src/index.ts` `startAuto` | Whisper posts the placeholder `"…"` → the probe should wait for real text. Instead it declares the backend live, so **fallback never happens** if transcription fails. | reading | Ignore `…`/`(…)` placeholder partials. |
| 6 | `packages/stt/src/index.ts` `startAuto` | A slow token fetch hits the probe timeout → the backend should be fully stopped. Instead `start()` finishes later and **leaves the mic and WebSocket open**. | test, verified | Keep the start promise and call `stop()` again once it settles. |
| 24 | `packages/stt/src/elevenlabs.ts` reconnect | 1006 drop, then the user stops during the reconnect → the new socket still gets assigned, so **an open socket leaks**. | test, verified | `if (!this.running) return next.close(1000)`. |
| 10 | `apps/desktop/main.js` `download` | Network drops mid-download → it should reject and clean up. Instead the promise **hangs forever** and the partial cloudflared binary is later treated as installed. | test, verified | Handle `res` error/aborted and delete the partial file. |
| 13 | `apps/browser/src/sidepanel.tsx` `generate` | Deck is on slide 5 of 10 → all 10 slides should be collected. Instead **slides 1–4 are silently skipped** and the rest renumbered from 0. | reading | Rewind with `prev` before collecting. |
| 34 | `packages/core/src/prompt.ts` `parseDecisions` | `{"started":"false","confidence":0.1}` → should be not started. Instead it comes back **started: true**. | test, verified | Strict boolean check plus the confidence ≥ 0.7 rule. |
| 36 | `packages/core/src/generate.ts` `parseGenerated` | "2025 revenue grew 30%" → should be kept as is. Instead **"revenue grew 30%"** (the leading number is stripped). | test, verified | Strip only real list markers. |
| 33 | `apps/web/lib/pii/guard.ts` CARD regex | "card 4111 1111 1111 1111 expires" → should become `card [CARD_1] expires`. Instead the space after the number is swallowed, giving `[CARD_1]expires`. | test, verified | `/\b\d(?:[ -]?\d){12,18}\b/g` |
| 29 | `apps/powerpoint/src/shapes.ts` `readNotesTexts` | Notes page with slide-number or footer placeholders → notes should be "My notes". Instead you get "My notes\n1\nConfidential". | test, verified | Match only shapes named "notes". |
| 35 | `packages/core/src/gauntlet.ts` `replay` | A flip 50 s after the label is "late" → it should not count as correct. Instead **recall = 1** and p50 delay = 50 s. | test, verified | Count only `correct`; late flips go into `flips`. |
| 8 | `apps/desktop/main.js` `/api/local/current-session` | Any website's `fetch` should be refused. Instead it **reads the session id and pairing code** (`ACAO: *`). | reading plus extracted test | Allow only `https://localhost` origins. |

## Medium

| # | Where | Problem | Evidence | Fix |
|---|---|---|---|---|
| 1 | `apps/desktop/slideshow.js` macOS script | A slide title with `"` produces invalid JSON, so slide following stops on that slide | test | AppleScript `esc()` handler |
| 4 | `packages/core/src/prompt.ts` | A model reply of `null` throws a TypeError | test, verified | `JSON.parse(..) ?? {}` |
| 7 | `apps/desktop/main.js` `allowFirewall` | A path with `'` is escaped twice, so the firewall rule targets a path that doesn't exist | test, verified | Escape only once |
| 9 | `apps/desktop/main.js` `pickRegion` | Pressing the hotkey twice quickly registers a second IPC handler and orphans a window | reading | `picking` flag |
| 14 | `apps/web/app/api/decide/route.ts` | `provider:"constructor"` gives a 502 instead of the fallback provider | test, verified | `Object.hasOwn` |
| 15 | same | A `null` or invalid JSON body gives a 500 | reading | `req.json().catch`, `body?.` |
| 17 | `apps/web/lib/import/parse.ts` | `&#99999999;` fails the whole import with a RangeError | test, verified | Range check, use U+FFFD |
| 18 | `apps/web/lib/gate/client.ts` | A worker crash leaves embed promises hanging forever | reading | Reject pending calls and reset the worker |
| 19 | `apps/web/lib/gate/embedder.ts` | One failed load (offline) means it never retries | test, verified | Clear `loading` when it rejects |
| 20 | `apps/web/lib/gate/client.ts` | The progress callback gets wiped by `loadGate()` | test, verified | Set it only when a callback is given |
| 21 | `apps/web/lib/pii/guard.ts` | A 200 response with a non-JSON body rejects instead of falling back to regex | test, verified | try/catch, return null |
| 22 | `packages/client/src/index.ts` | A failed first connect leaves an orphaned reconnect loop running | reading | Don't reconnect if never welcomed |
| 23 | `packages/core/src/script.ts` | `**Note:**` and `---` lines become bullets | test, verified | `\s+` after the marker |
| 25 | `apps/desktop/main.js` macOS cert | A cancelled keychain prompt means the cert is never trusted again | reading | Move trust behind the `certTrusted` flag |
| 26 | `apps/desktop/main.js` Windows cert | A regenerated cert is never trusted | reading | Reset `certTrusted` when generating |
| 27 | `apps/desktop/stt.js` | A late exit from the old worker nulls out the new worker | test, verified | Identity guard |
| 28 | `apps/powerpoint/vite.config.ts` | The dev server's `/powerpoint/` base breaks the dev manifest (404 on icons) | reading | Use base `/` in dev |

## Low

| # | Where | Problem | Fix |
|---|---|---|---|
| 30 | `apps/web/components/PairPanel.tsx` | An expired code fires `onNewCode` twice | Remove the duplicate effect and refresh `now` when the dialog opens |
| 31 | `apps/web/components/ResourcesPanel.tsx` | The shared-memory meter shows GPU load % | Use shared memory / RAM |
| 37 | `packages/core/src/script.ts` `serializeScript` | The slides/import marker is dropped (no current caller) | Write the marker out |

## Rejected (5)
- #11, #12: an NDJSON last line without a trailing newline is dropped (powerpoint `generate.ts`, `sidepanel.tsx`). The only server always ends lines with `\n`, so real callers can't hit it.
- #16: the PairPanel `switching` flag is never reset. Every path through the desktop handler reloads the window, which resets it.
- #32: `/api/local/status` is fetched without auth. The route has no auth check, so this is harmless.
- #38: the whisper backend receiving `'auto'`. The only caller maps `'auto'` before passing it.

## Not checked
96 suspicions rated 2 (lower confidence) were not sent to provers. They are listed in `BUGFIX-HANDOFF.md`. Worth a look: unauthenticated `PUT /api/script` and `POST /api/local/plan` (apply/probe), cancelling during the mic probe in `startTake`, whisper `stop()` dropping the last audio window, and a timing loop in `slideshow.js` that doubles on spawn failure.
