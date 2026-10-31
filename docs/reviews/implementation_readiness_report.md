# Implementation Readiness Review: ARCHITECTURE.md sections 2 through 7 (phases 1 and 2)

Mode: REVIEW. Standard: implementation-readiness-standard.md.

**Verdict: FAILS the standard for both phase 1 and phase 2.** The document is a vision/roadmap, not an implementation plan. Phase 1 and phase 2 are each one table row; sections 2.1 and 2.2 name packages and a type contract but leave the server transport, the engine API, the pairing protocol, the delta format, the mirror UI, the build pipeline and every test to the implementer.

## BLOCKERS

**B1. The WebSocket server cannot live inside the Next.js app as written (lines 28, 32, 57, 187).** App Router route handlers are request/response functions; the standalone `server.js` started by electron/main.js and the systemd unit does not expose its http.Server. Decision needed: separate Node process on a second port (recommended: `apps/server`, `ws` ^8, port 4748, Caddy routes `/ws/*` and `/api/session/*` to it; Electron starts it after the Next server and waits for both ports) or a custom server that breaks `output: "standalone"`.

**B2. Engine class has no API (line 51).** Must replace Teleprompter.tsx constants (TICK_MS, START_THRESHOLD, TRANSCRIPT_WINDOW, STICKY_MS), refs (inFlight, lastSent, flippedAt), goTo, resetSection. Undecided: constructor, interval ownership, injected `decide` function vs fetch (core must stay DOM-free), event emission, Command→method mapping, transcriptTail length (200 vs today's 160), avgMs vs totalMs. Proposed skeleton: `new Engine({decide, now?, tickMs, threshold, stickyMs, window})` with `loadScript`, `feed(TranscriptEvent)`, `dispatch(Command)`, `start/stop`, `getState`, `subscribe(fn)`.

**B3. Phase 1 has no file-change list.** lib/types.ts mixes HTTP contracts with Script; lib/stt imports `@/lib/types`; tsconfig paths break after the split; elevenlabs.ts/openai.ts hard-code relative `/api/stt/...` URLs and need a base URL; packages/stt is browser-only; package names, module type, transpilePackages, outputFileTracingRoot, electron-builder extraResources path and desktop.yml changes all undecided. Needs an old→new move table and a "phase 1 done when" line.

**B4. WebSocket protocol unspecified (lines 89-91).** Patch format, command envelope, engine vs view authentication on the same path, second-engine behaviour, version-gap resync, heartbeat, close codes, command acks, relay vs server-applied commands. Proposed: JSON messages; `hello{role,token}` first; engine sends `state` and `patch{version, ops}` (RFC 6902 via fast-json-patch); views send `cmd`; server is a relay storing the latest full state; second engine → close 4001; version gap → `resync`; ping 15 s.

**B5. Pairing and token flow unspecified.** HTTP shapes, code generation and collision handling, one-time vs reusable, token transport (never in URL), token format, engine token, `ACCESS_PASSWORD` header, rate limit numbers, QR payload, code→id mapping. Proposed: `POST /api/session` → `{id, code, engineToken}`; `POST /api/session/pair {code}` → `{id, viewToken}`; 10 attempts/IP/min; tokens 16 random bytes base64url in the `hello` message; QR encodes `https://<origin>/mirror?code=...`.

**B6. No test plan.** Minimum: Engine unit tests (flip at 0.70, sticky window, goToSection forward marks missed, resetSection scope, parseScript id stability); server tests (two views same patch sequence, second engine rejected, bad code 404, rate limit 429, expiry with fake timers); one Playwright end-to-end (engine tab + mirror tab, nextSection from view). Name the runner (vitest) and location.

## MAJOR

**M1. PWA mirror is a label.** Needs file, rendered component, remote buttons, manifest content, no service worker, wake lock, reconnect/backoff, disconnected state.

**M2. "Desktop app publishes sessions" has no mechanism.** 127.0.0.1 binding; choose outbound connection to a session server (needs a URL setting) or LAN hosting with the QR carrying the LAN address.

**M3. SessionState contradicts the existing model.** `points[id].status` includes "missed" and there is a separate `missed` array: two sources of truth. `missed` ids vs text. avgMs vs totalMs. SttBackendId not placed in core. transcriptTail 200 vs 160.

**M4. packages/client API undefined.** Must also run in React Native (global WebSocket, no window).

**M5. Office.js claims need qualification.** getUserMedia only reliable on WebView2 (M365 Current Channel) and PowerPoint for the web; WKWebView on Mac has blocked it. PowerPointApi has no slide-show control or Present-mode slide-change event; selection APIs work in Normal view only. Rescope "slide sync both ways" to editor view. Web Speech exists in PowerPoint for the web (Chrome).

**M6. Apps Script sidebar claims.** No microphone in HtmlService sidebars (iframe `allow` is Google's). Nested iframe cannot call google.script.run; bridge via postMessage; no selection-change event; polling quotas; UrlFetch daily limits.

**M7. Expo module names deprecated.** expo-barcode-scanner → expo-camera CameraView barcode scanning; expo-av → expo-audio; neither gives raw PCM, so "phone as engine" needs a native module and a dev client / EAS build.

**M8. `POST /api/session/:id/script` bypasses the engine.** Convert to a relayed `loadScript` command; state who may call it.

**M9. Session lifetime vs Electron.** Desktop restarts a fresh server each launch; say sessions are not resumable or persist them in userData.

## NITS

Turborepo not needed for three packages; `parseDecisions`/`clamp` move to prompt.ts too; manifest needs `PowerPointApi 1.4` requirement set; Windows desktop sideloading uses a trusted catalog, not "Upload my add-in"; Caddy WS pass-through follows from B1; `HTTP-Referer` hard-coded to localhost in decide route.

## Summary

Add: WebSocket process model with Caddy/Electron/systemd consequences; Engine class signature and line mapping; move table and build-config edits; wire protocol and pairing endpoints with shapes, limits and error codes; `/mirror` spec and desktop connection model; concrete tests per phase; corrections to Office.js, Apps Script and Expo claims.
