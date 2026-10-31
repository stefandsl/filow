# Design Critic Goldfish — REVIEW of ARCHITECTURE.md (whole file)

Target standard: feature-spec-standard.md. Grounding: components/Teleprompter.tsx, app/api/decide/route.ts, lib/types.ts, lib/stt/index.ts, electron/main.js, README.md §1–2.

## Standard compliance gaps

**1. [Blocker] No Alternatives Considered section.** Every major decision is asserted, not argued: WebSocket vs WebRTC/SSE/WebTransport (line 89); bespoke session server vs hosted realtime relay; Turborepo vs single package (line 64); Expo vs Flutter/Capacitor/PWA-only (line 159); Office.js task pane vs Windows COM overlay (line 112); laptop-as-engine vs server-side engine (line 25). Fix: add Alternatives considered with one rejected option per subsystem and the concrete reason it lost.

**2. [Major] No Problem Statement or Goals/Non-Goals.** Lines 1–19 open with a feature list. The only "problem" named (line 19) is a code-structure problem, not a user problem. Fix: Problem Statement (one presenter, one laptop, cannot see the laptop from the stage / wants slides to follow) and a Non-Goals list (no multi-speaker, no persistence, no shared sessions, no AppSource in v1).

**3. [Major] Risks limited to security (§6).** Missing: STT outage mid-talk, OpenRouter rate limits/5xx at 2 req/s, WebSocket drop on venue Wi-Fi, phone screen lock, Office add-in approval delays, Apple review, in-process session store memory growth. Fix: risks table with likelihood/impact/mitigation and a "degraded mode" definition per view.

## Contradictions with the existing code and factual errors

**4. [Blocker] "/ws/session/:id" inside Next.js contradicts how the server runs.** electron/main.js boots `.next/standalone/server.js`; no custom server, no `ws` dependency. App Router route handlers cannot accept a WebSocket upgrade. Fix: state how the WS server is hosted (custom server wrapping next() + ws, or sidecar process), update the Electron plan and Caddy claim, add the `ws` dependency.

**5. [Blocker] "Desktop app publishes sessions" is impossible with the current binding.** electron/main.js binds 127.0.0.1. Either bind 0.0.0.0 (LAN-exposed server with API keys in process, needs auth and firewall prompts) or the desktop engine connects outbound to a public session server (then who runs it, where do keys live). Fix: choose topology (a) desktop engine connects outbound to hosted session server, or (b) desktop hosts the server on LAN with QR carrying ip:port; spell out key-custody consequences.

**6. [Major] SessionState/Command contract does not match today's types.** `missed: string[]` vs today's `Bullet[]`; "mark missed" has no `markMissed` command; `clearMissed` has no id while today missed items are dismissed individually; `goToSection`/`slideChanged` missed-marking rule undefined (jumping forward 5 slides floods Missed); `cost` depends on OpenRouter `usage.cost` which falls back to 0, so a cost cap is unenforceable for providers that don't report; Bullet vs point naming. Fix: reconcile the contract, add `markMissed` and an id to `clearMissed`, define missed-marking per navigation command, note the cost-reporting dependency.

**7. [Major] "Shipped in this commit" and "called twice a second" are partly false.** README still says 0.6 threshold while code says 0.70. The loop skips ticks when the transcript is unchanged or a call is in flight, so real call rate is bounded by STT update rate and model latency. No cost model (tokens/call, calls/minute, cost per 30-minute talk). Fix: state the real gating rule and add a cost model baseline.

**8. [Major] Hysteresis proposal conflicts with existing sticky logic and the "stateless views" claim.** `STICKY_MS` is effectively dead code since `started` is never un-set. "Two consecutive ticks" is not a time bound. No resync message for a view that sees a version gap. Fix: define hysteresis in transcript-change events, remove or justify STICKY_MS, add a full-snapshot-on-gap rule.

## Faulty assumptions about external platforms

**9. [Blocker] PowerPoint "Engine mode" assumptions unverified.** getUserMedia in Office task panes (WebView2) needs manifest device permissions and has prompted inconsistently across Office versions. Programmatic slide navigation during an active slide show is not generally available in released requirement sets; the hedge concedes the headline feature may not work during a real presentation. `ReadWriteDocument` is over-scoped; reading notes needs `ReadDocument`. Fix: cite the requirement set and API names; prototype mic capture and slide-show navigation on Win and Mac before committing 4 days; downgrade permission; state fallback UX ("press →" nudge).

**10. [Major] Google Slides sidebar assumptions stated without a source.** HtmlService sandboxed iframes have historically not received mic permission. Polling via google.script.run at 1 s for a 45-minute rehearsal is ~2,700 executions against daily quotas. Loading the shared React view by URL means nesting a cross-origin iframe inside the sandbox with CSP/XFO constraints. Fix: verify, state polling interval and quota math, describe the iframe nesting and headers.

**11. [Major] Expo module choices are stale.** expo-av → expo-audio; expo-barcode-scanner → expo-camera. "Reliable background WebSocket" is false on iOS; the pocket-remote use case loses its socket on screen lock. Fix: name current modules; specify reconnect-on-foreground; commands only with screen on.

## Security and cost risks

**12. [Blocker] Key custody for "phone as engine" and PowerPoint "Engine mode" undefined.** Today `/api/stt/*-token` and `/api/decide` are unauthenticated; on a public server anyone can mint STT tokens and burn OpenRouter credit. `ACCESS_PASSWORD` is optional and only gates session creation. Fix: mandatory engine authentication on a public server; gate `/api/decide` and `/api/stt/*` behind a valid engine session token; bind STT minting to a session id with per-session quota.

**13. [Major] 6-digit pairing code is brute-forceable; mitigation under-specified.** 10^6 codes, 2-hour window, unspecified rate limit. Every view has full control including `loadScript`. Fix: rate limit (5 attempts/code then rotate; 20/min/IP), code TTL 5 min, roles `viewer` vs `controller`, `loadScript` restricted to the engine.

**14. [Major] In-memory single server with no failure story.** A crash kills every session; the engine is the source of truth but never said to re-publish. Fix: engine-driven recovery (reconnect, resend full state, server recreates the session under the same id/code) and view-side "engine offline" state.

**15. [Major] Session lifetime tied to the wrong actor.** "2 h after the engine disconnects" has no absolute maximum. Fix: absolute TTL (12 h), idle TTL on last state change, explicit `endSession`.

## Over-engineering / sequencing

**16. [Major] Roadmap estimates unjustified and inconsistent.** Phase 2 hides a WS server, auth, and an Electron topology change in 3 days. Phase 6 (engine accuracy) has the only direct user-visible payoff and is last. Fix: justify or drop numbers; move hysteresis + cost cap into phase 1; mark phases 3/5 as "spike first".

**17. [Major] Five surfaces for a single-user, no-account product is over-scoped.** No success metric justifies any surface beyond PWA + desktop. Fix: goals/success criteria per surface; make phases 4 and 5 conditional on phase 2 adoption.

**18. [Nit] `packages/ui` cannot serve Office pane, Apps Script sidebar and Expo as one component set.** React Native does not render DOM. Fix: ui is web-only; mobile reimplements Stage on core + client.

**19. [Nit] "Today" diagram omits token-minting and script endpoints.**

**20. [Nit] Section auto-advance relies on classifying UPCOMING points, which the prompt tells the model not to decide on.** Needs a second output field or a second call.

## Summary

Blockers: 1 (no alternatives), 4 (WebSocket in Next standalone), 5 (desktop binds to localhost), 9 (PowerPoint API/mic assumptions), 12 (key custody / unauthenticated spend endpoints). The document lacks a problem statement, non-goals, alternatives, a cost model and a risk register; several platform claims are asserted without evidence; the session-server plan contradicts how the current Electron and Next.js server actually run.
