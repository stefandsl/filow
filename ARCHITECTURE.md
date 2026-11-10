# Filow architecture

| | |
|---|---|
| Status | Draft v2, after one EGM goldfish review round (reports in `docs/reviews/`) |
| Date | 2026-10-31 |
| Applies to | repository version 0.1.0 |
| Owner | Stefan Butnaru |

---

## 1. Problem statement

A presenter has talking points, not a word-for-word script. On stage they cannot see the laptop that runs the teleprompter, they lose track of which points they have made, and when they skip one they only notice afterwards. If slides are involved, the slide deck and the talking points live in different places and drift apart.

Today's Filow solves the first part on one laptop: it listens, and ticks off a point the moment the presenter starts making it. This document extends that to the places a presenter actually looks (a phone on the lectern, the PowerPoint window) and to what is on the screen behind them (Screen Sense).

## 2. Goals and non-goals

**Goals**

- G1. The live state (which points are done, what is next, what was missed) is visible on a phone held by the presenter, with remote Next / Prev / Reset controls.
- G2. Slide speaker notes can be the script, so PowerPoint and Google Slides users maintain one artifact.
- G3. The app can watch the presenter's screen and give slide-specific cues and gap warnings, with frames never written to disk.
- G4. Keys stay on the server the presenter controls. Nothing goes to third parties except the chosen model and transcription providers.
- G5. The engine (the decision loop) is one TypeScript class, tested without a browser, reused by every surface.

**Non-goals (v1)**

- No user accounts; pairing codes only.
- No multi-speaker or multi-engine sessions.
- No transcript or screenshot storage; nothing persists past the session except the user's own script and exported notes.
- No control of Google Slides Present mode and no control of a running PowerPoint slide show from the task pane (the platform APIs do not exist; see §7 and §8).
- No AppSource or Workspace Marketplace public listing; sideload and internal listings only.
- No "phone as microphone" in v1 (needs a native audio module; deferred, see §9).

## 3. Glossary

- **Point**: one talking point. In code the type is still called `Bullet` (kept for compatibility with `lib/types.ts`); the UI says "point".
- **Section**: a group of points under a `#` heading; with slides, one slide = one section.
- **Script**: the ordered sections. Markdown in `script.md`, or imported from a document.
- **Take**: one recording run from Start take to Stop take.
- **Tick**: one iteration of the decision loop. The timer fires every 500 ms, but a call to the model is made only when the transcript window changed and no call is in flight, so the real call rate is bounded by the transcription update rate and model latency (observed 1 to 2 calls per second with ElevenLabs, fewer with Web Speech).
- **Point status**: `waiting` (not yet made), `started` (the model saw the presenter begin this idea with confidence ≥ 0.70), `missed` (the section was left while the point was still waiting, or the user marked it). `started` is never un-set by the engine; the user can reset a section.
- **Covered**: the set of points in the current section with status `started`. Not a fourth status, a derived list used in the prompt.
- **Missed tray**: the UI strip listing missed points; tapping one re-opens it as `waiting` in its section.
- **Next strip**: the UI strip previewing the next section's points.
- **Engine**: the one process in a session that holds the microphone, runs transcription and the decision loop, and owns the state.
- **View**: any other client of the session; it displays state and may send commands.
- **Session server**: the relay between the engine and its views.
- **STT**: speech-to-text. Backends: `elevenlabs` (Scribe v2 Realtime), `openai` (gpt-live-transcribe), `browser` (Web Speech, Chrome/Edge only, free).

## 4. Today (v0.1)

```
┌─────────── browser or Electron window ───────────┐        ┌──── Next.js (port 4747) ────┐
│ mic ─► STT backend ─► transcript ─► tick ────────┼──POST──► /api/decide ─► OpenRouter   │
│                                      ▲           │        │ /api/stt/*-token (mint STT   │
│  Teleprompter.tsx (all state, all UI)┘           │◄───────┤   tokens, unauthenticated)   │
│                                                  │        │ /api/script  (read/write md) │
└──────────────────────────────────────────────────┘        └──────────────────────────────┘
```

One React component owns state and loop. Desktop is Electron running the same server bound to 127.0.0.1. Everything that follows keeps this working at every phase.

## 5. Target architecture

### 5.1 One engine, many views

```
                 ┌──────────── apps/web  Next.js, port 4747 ────────────┐  ┌── apps/server  Node + ws, port 4748 ──┐
                 │ /api/decide            OpenRouter decisions          │  │ POST /api/session        create        │
                 │ /api/stt/*-token       mint STT tokens               │  │ POST /api/session/pair   code → token  │
                 │ /api/vision            Screen Sense frame analysis   │  │ /ws/session/:id          relay         │
                 │ /api/import            PDF/PPTX/DOCX/TXT → script    │  │ in-memory session store, TTLs          │
                 │ /mirror                PWA view                      │  └──────────────────┬─────────────────────┘
                 └──────────────────────────────────────────────────────┘                     │
                                 ▲ HTTPS (engine only)                                        │ WebSocket
                 engine (exactly one per session)                                              views (any number)
┌────────────────┴────────────────────────────────┐              ┌────────────────────────────┴───────────────────┐
│ Web app or Desktop app: mic, STT, Screen Sense  │              │ Phone (PWA now, Expo later)   mirror + remote   │
│ capture, Engine class, publishes SessionState   │              │ PowerPoint task pane          mirror + notes    │
└─────────────────────────────────────────────────┘              │ Google Slides sidebar         export + mirror   │
                                                                 │ second browser tab, OBS overlay                  │
                                                                 └──────────────────────────────────────────────────┘
```

Only the engine talks to `/api/decide`, `/api/stt/*` and `/api/vision`. Views never hold API keys or STT tokens and only ever receive text.

### 5.2 Process model (decision D1)

The WebSocket relay is a **separate Node process**, `apps/server`, using the `ws` package on `http.createServer`, port 4748. It does not run inside Next.js: App Router route handlers are request/response functions and the standalone `server.js` does not expose its `http.Server`. Keeping `output: "standalone"` keeps the desktop packaging and the Debian deploy unchanged.

Consequences:

- **Caddy**: `handle /ws/*` and `handle /api/session/*` → `reverse_proxy 127.0.0.1:4748`; everything else → 4747. WebSockets pass through `reverse_proxy` without extra config.
- **systemd**: a second unit `filow-session.service`, `ExecStart=/usr/bin/node apps/server/dist/bundle.js`.
- **Electron**: `main.js` requires the relay bundle (`apps/server/dist/bundle.js`, packaged as `resources/server/bundle.js`) after the Next server and waits for both ports in `waitFor()`.
- **CI**: unchanged shape, root scripts `npm run desktop:build:<os>` (they call `dist:<os>` in `apps/desktop`).

### 5.3 Desktop topology (decision D2)

The desktop app has two connection modes, chosen in Settings:

- **LAN mode (default, zero setup)**: Electron binds both the Next server (it serves the `/mirror` page) and the relay to `0.0.0.0`, and the QR encodes `http://<lan-ip>:4747/mirror?code=…&server=http://<lan-ip>:4748`. Views on the same Wi-Fi work over plain HTTP because views never use the microphone. The spend endpoints are gated by a per-launch random `ACCESS_PASSWORD` that only the Electron window receives (through the preload bridge), so another device on the Wi-Fi can pair with a code but cannot mint STT tokens or call the decision model. Windows will show one firewall prompt the first time.
- **Hosted mode**: the engine connects outbound to a public session server (the Debian deploy). Required for the PowerPoint and Slides add-ins, which must load from HTTPS. API keys live on the hosted server; the desktop app sends its `ACCESS_PASSWORD` once and receives an engine token.

Desktop sessions are not resumable across app restarts: a new code is issued per launch.

### 5.4 Session server contract

**HTTP (apps/server)**

| Endpoint | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `POST /api/session` | `X-Access-Password` when `ACCESS_PASSWORD` is set | `{}` | `{id, code, codeExpiresAt, engineToken}` | 401 |
| `POST /api/session/pair` | none, rate-limited 10/IP/min and 60/min globally | `{code}` | `{id, viewToken, role:"pending"\|"controller"}` | 404 unknown or expired code, 429 |
| `POST /api/session/:id/code` | `engineToken` | `{}` | `{code, codeExpiresAt}` fresh single-use code | 401, 404 |
| `POST /api/session/:id/script` | `engineToken` or `viewToken` with `controller` role | `{text}` | `{ok:true}` → relayed to the engine as `loadScript` | 401, 404 |
| `DELETE /api/session/:id` | `engineToken` | | `{ok:true}` | |

`id` is a UUID. `code` is 6 digits from `crypto.randomInt`, unique among live sessions. Tokens are 16 random bytes, base64url. Tokens travel only in the first WebSocket message, never in URLs.

Lifetimes: a session ends on `DELETE`, or 2 hours after the engine socket closes, or 12 hours after creation, whichever comes first. A `code` is valid for 5 minutes and for one pairing; the engine requests a fresh one (`POST /api/session/:id/code` or `{t:"newCode"}`) for the next phone or when the old one ran out.

Roles: `pending` receives nothing; `viewer` receives state only; `controller` may send commands. Pairing yields `pending`, the engine is told `{t:"pairRequest", token, device}` and answers `{t:"pairDecision", token, role:"viewer"|"controller"|"reject"}` (the UI shows the device label with Allow / View only / Reject). With `AUTO_ACCEPT_LAN=1` (desktop LAN mode) a phone whose socket peer is a private address and that did not come through a proxy is admitted as `controller` at once. The engine can change a role later with `setRole`. `loadScript` and `startTake`/`stopTake` are accepted only from the engine's own UI or a `controller`.

Client addresses for the rate limiter come from the socket; `cf-connecting-ip` / `x-forwarded-for` are honoured only with `TRUST_PROXY=1` (behind Caddy on the Debian deploy, or while the desktop app runs its own cloudflared). A phone page uses a `?server=` parameter only when it is its own origin; any other host is confirmed by the user first.

**WebSocket `/ws/session/:id`**, JSON messages:

```
client → server   {t:"hello", role:"engine"|"view", token}
server → client   {t:"welcome", role, version}            | {t:"error", code, message} then close
server → engine   {t:"pairRequest", token, device}        a pending phone connected
engine → server   {t:"pairDecision", token, role}         viewer | controller | reject (close 4003)
server → view     {t:"role", role}                        then the latest state
engine → server   {t:"newCode"}  → server replies {t:"code", code, codeExpiresAt}
engine → server   {t:"state", version, state}             full SessionState
engine → server   {t:"patch", version, ops}               RFC 6902 ops (fast-json-patch), version = previous + 1
server → views    forwards state and patch unchanged; replays the latest full state to each new view
view → server     {t:"cmd", id, cmd: Command}
server → engine   forwards cmd (only from controller role)
engine → server   {t:"ack", id, ok, error?}  → forwarded to the sender
view → server     {t:"resync"}  when it sees a version gap → server replies with the latest full state
either            {t:"ping"} / {t:"pong"}  every 15 s, close after 2 missed
```

Close codes: 4001 engine already connected, 4002 bad token, 4003 session expired, 4004 role not allowed.

The server is a relay. It stores only the latest full state per session (for replay) and never applies commands itself; the engine is the single writer. When the engine reconnects it sends a fresh `state` and the server re-creates the session under the same `id` and `code` if it still exists.

**Types (packages/core)**

```ts
type PointStatus = "waiting" | "started" | "missed";

type SessionState = {
  id: string; version: number;
  script: Script;                       // sections[].bullets[] (Bullet = point)
  sectionIdx: number;
  points: Record<string, { status: PointStatus; confidence: number; startedAt?: number }>;
  // no separate `missed` array: missed = points with status "missed", resolved against script
  transcriptTail: string;               // last 160 chars
  stats: { calls: number; totalMs: number; avgMs: number; costUsd: number | null; model: string };
  //                                   costUsd is null when the provider reports no usage.cost
  engine: { backend: SttBackendId | null; recording: boolean; error?: string };
  slide?: { index: number; total: number; title?: string };
  screen?: ScreenSummary | null;        // see §6
};

type Command =
  | { type: "nextSection" } | { type: "prevSection" } | { type: "goToSection"; idx: number }
  | { type: "resetSection" }
  | { type: "markStarted"; id: string } | { type: "markMissed"; id: string } | { type: "reopen"; id: string }
  | { type: "startTake" } | { type: "stopTake" }
  | { type: "loadScript"; text: string }
  | { type: "slideChanged"; index: number; total: number; title?: string }
  | { type: "lookNow" } | { type: "forgetScreen" };
```

Navigation rule: `nextSection`, `goToSection(idx > current)` and `slideChanged` to a later slide mark every `waiting` point of the sections being passed as `missed`. Moving backwards marks nothing. `slideChanged` maps slide index to section index only when the script was built from slides (`script.source === "slides"`); for a hand-written script it only updates `state.slide`.

### 5.5 Engine class (packages/core)

```ts
export class Engine {
  constructor(opts: {
    decide: (r: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse>;   // injected; core has no fetch, no DOM
    now?: () => number; tickMs?: number /*500*/; threshold?: number /*0.7*/;
    confirmCalls?: number /*2*/; sureThreshold?: number /*0.85*/; window?: number /*900*/;
    costCapUsd?: number | null /*1*/; timeoutMs?: number /*2500*/; maxQuestions?: number /*4*/;
    reaskOnPending?: boolean /*true*/; guard?: boolean /*true*/; verify?: boolean /*true*/;
    // plus verifyThreshold, onGuard, onVerify, sessionId and timer injection: see EngineOptions in engine.ts
  });                                        // Screen Sense text arrives through feedScreen(), not an option
  loadScript(script: Script): void;        // resets points, sectionIdx, counters
  feed(e: TranscriptEvent): void;          // same shape as lib/stt/types.ts
  feedScreen(s: ScreenSummary): void;      // from the capture pipeline, text only
  dispatch(cmd: Command): CommandResult;   // one switch; semantics from Teleprompter.tsx goTo/resetSection
  start(): void; stop(): void;             // owns the interval
  getState(): SessionState;
  subscribe(fn: (state: SessionState, ops: Operation[]) => void): () => void;
}
```

Flip rule (replaces the old `STICKY_MS`, which never did anything because `started` is never un-set): a point flips to `started` when it scores ≥ 0.70 on two consecutive **calls** (not timer ticks, since calls are gated on transcript change), or ≥ 0.85 (`sureThreshold`) on one call. `confirmCalls` and `sureThreshold` are configurable.

The React component becomes a thin `useEngine()` hook; all logic now in `Teleprompter.tsx` lines 131–220 moves into `Engine` verbatim, then gets tests.

### 5.6 Decision prompt (implemented in v0.1.0, `app/api/decide/route.ts`)

The classifier receives four lists: OPEN POINTS (decided on), COVERED POINTS (context), UPCOMING POINTS (context), and, when Screen Sense is on, ON SCREEN FACTS (context, see §6.4). It has a confidence rubric (0.70 = started), rules for announcements ("I will talk about X" is not a start), shared-keyword false positives, and multilingual speech.

Cost model, measured with `google/gemini-2.5-flash-lite`: about 700 input and 60 output tokens per call, 1 to 2 calls per second while speaking, roughly $0.03 to $0.06 per 30-minute talk. Shown live in the footer. A **cost cap** per session (default $1) stops the loop with a visible error. Where the provider does not report `usage.cost`, the cap uses a token-based estimate and the footer says "est.".

Model routing (later): the cheap model handles every call; when a point sits at 0.40 to 0.69 for three consecutive calls, that single point is re-asked to a stronger model. Section auto-advance needs its own output field (`upcomingHit: string[]`), because the prompt forbids deciding on upcoming points; it only *suggests* advancing (phone vibrates, Next button highlights). It never advances by itself.

### 5.7 Monorepo layout and migration (phase 1)

```
packages/core     TS, no DOM: types.ts, script.ts, prompt.ts (SYSTEM_PROMPT, buildUserPrompt, parseDecisions), engine.ts, patch.ts
packages/stt      browser-only: the three backends, mic.ts, startAuto; createBackend(id, { baseUrl })
packages/client   connect({serverUrl, code|token}) → { subscribe, send, close, status }; uses global WebSocket (works in RN)
packages/ui       web-only React: PointList, SectionHeader, NextStrip, MissedTray, OnScreenStrip, StageView
apps/web          today's Next app (also serves /mirror)
apps/server       ws relay
apps/desktop      electron/ + electron-builder config
apps/powerpoint   phase 3      apps/gslides   phase 5      apps/mobile   phase 4
```

Move table:

| From | To | Note |
|---|---|---|
| `lib/types.ts` | `packages/core/src/types.ts` + `api.ts` | `DecideRequest/Response`, `SttStatus` go to `api.ts` |
| `lib/script.ts` | `packages/core/src/script.ts` | |
| `app/api/decide/route.ts` prompt + `parseDecisions` | `packages/core/src/prompt.ts` | route becomes a 20-line wrapper; parametrize `HTTP-Referer` |
| `lib/stt/**` | `packages/stt/src/**` | add `baseUrl` option, replace `@/lib/types` imports |
| `components/Teleprompter.tsx` logic | `packages/core/src/engine.ts` | UI stays, calls `useEngine` |
| `electron/`, builder config | `apps/desktop/` | `extraResources.from: ../web/.next/standalone` |

Tooling: npm workspaces only (no Turborepo for five packages). Packages are `"type": "module"` and ship their TypeScript source (`"main": "./src/index.ts"`, no build step); `apps/web/next.config.ts` adds `transpilePackages` for the four packages (core, stt, client, ui) and `outputFileTracingRoot: path.join(__dirname, "../..")`. CI runs `npm ci` at root and the root script `npm run desktop:build:<os>`.

Phase 1 is done when `npm run typecheck`, `npm run build`, `npm run desktop` pass from the new root, the UI is unchanged, and the engine tests in §11 pass.

### 5.8 PWA mirror (phase 2)

`apps/web/app/mirror/page.tsx` (client component): reads `?code`, calls pair, connects with `packages/client`, renders `<StageView state onCommand>` from `packages/ui`. Big type, dark, landscape-friendly, remote buttons (Prev / Next / Reset / Start / Stop), Missed tray as a bottom sheet, ON SCREEN strip. No service worker (live-only view). `public/manifest.webmanifest` with `display: standalone`, theme `#0b0b0d`. Reconnect with exponential backoff 0.5 s → 8 s; while disconnected it shows the last state dimmed with an "engine offline" banner. Requests `navigator.wakeLock` on first tap (HTTPS or LAN HTTP on Android; iOS Safari ≥ 16.4).

---

## 6. Screen Sense

Screen Sense lets the engine see what the audience sees and turn it into cues, gap warnings and notes. Inspired by Clicky (heyclicky.com, github.com/farzaa/clicky), whose open-source version captures only on a hotkey; the always-on mode here is our own, and the region picker comes from ShareX. Frame selection borrows from bradautomates/claude-video, the pipeline behind the /watch skill.

### 6.1 Two capture modes

**Mode 1, always-on watch (default during a take).** At Start take the user picks a screen, a window (for example PowerPoint) or a region drawn ShareX-style; the choice is remembered per presentation (later; today it lasts for the app session). A 1 fps thumbnail is compared with the last *sent* frame using a 16×16 RGB mean-difference (the claude-video dedup). Only on a real change (new slide, new page) does a full-resolution frame go to the vision model. Hard cap: 20 frames per minute. Presenter cues in the transcript ("as you can see", "on this slide", "here", and their translations) trigger an immediate capture. A **Look now** button forces one.

**Mode 2, hotkey region capture.** A configurable global hotkey (Settings UI like ShareX; default Ctrl+Shift+Space) dims the screen, the user drags a rectangle, and only that region is sent, optionally with a spoken question (hold the hotkey for push-to-talk; later, `globalShortcut` has no key-up event). Works outside a take too.

Electron: `globalShortcut`, a transparent fullscreen `BrowserWindow` for the picker, `desktopCapturer` for frames. Web: `getDisplayMedia` (screen or window only; no region picker, no global hotkey). PowerPoint add-in: slide text and notes through Office.js instead of pixels. Phone: never captures.

### 6.2 Privacy rules

- Frames live in memory only, sent once over HTTPS to a multimodal model via OpenRouter (default `google/gemini-2.5-flash`), then dropped. No disk, no cache, no image bytes in logs.
- Only the returned text (`ScreenSummary`) is kept, per session, with a **Forget screen context** button. Summaries are gone when the session ends unless the user exports notes.
- The Filow window itself is excluded from capture (`setContentProtection(true)` on Windows/macOS, plus filtered out of the chooser).
- Views receive only `ScreenSummary` text, never frames.
- A visible badge shows while a frame is being analysed; a Settings toggle disables the feature and unregisters the hotkey.
- Screen content, slide text and OCR are untrusted evidence, never instructions. The vision prompt says so; the gap detector emits tips, never actions.

### 6.3 Output

```ts
type ScreenSummary = {
  at: number; source: "screen" | "window" | "region" | "slide-text";
  title?: string; shows: string;            // one sentence
  pointsToMake: string[];                   // max 3
  facts: string[];                          // numbers, names, visible text worth saying
  mismatch?: string;                        // vs the script, e.g. "slide says 2025, script says 2024"
  unavailable?: "no-screen-selected" | "could-not-read" | "capped" | "disabled";
};
```

The ON SCREEN strip shows `shows`, `pointsToMake` and `facts`, or the `unavailable` reason instead of staying blank. With no script loaded, `pointsToMake` become the talking points of an auto-created section per slide.

### 6.4 Uses

1. **Cues**: the ON SCREEN strip above the points.
2. **Gap detector**: `facts` go into the decide prompt as a fourth list, ON SCREEN FACTS, and the model returns `unmentioned: string[]` so the UI can flag a number on the slide the presenter has not said.
3. **Live notes**: one `ScreenSummary` per slide plus the transcript tail at that time, exportable as Markdown at Stop take.
4. **Post-talk report (optional)**: the take can be recorded locally and run through the claude-video Python pipeline unchanged to produce time per slide, drift from script, and what was on screen when. Local only, opt-in.

### 6.5 Cost dial

Settings: **Off / On slide change / Balanced / Real-time**, mirroring claude-video's detail presets. On slide change = one call per changed frame; Balanced = also on presenter cues; Real-time = a call every few seconds while content keeps changing (demos). Saved once, changeable mid-talk, live cost in the footer, counted against the same session cost cap.

### 6.6 Document import

`POST /api/import` (engine only) accepts PDF, PPTX, DOCX, TXT, MD and returns a Script: one section per slide or page; PPTX speaker notes become points, slide titles become section titles; scanned PDF pages go through the vision model. Libraries: `unpdf` for PDF text, `jszip` + XML for PPTX/DOCX. Scanned pages are flagged in `warnings` for now (no OCR without native dependencies). Available to every surface through the engine.

### 6.6.1 Implementation notes (phase 6a/6b, shipped)

- Policy is pure and tested in `packages/core/src/screen.ts`: `frameDiff` (16×16 RGBA mean difference, threshold 10), `FrameBudget` (sliding 20/min), `hasPresenterCue` (en/it/es/fr/de), `shouldCapture` (the cost dial), `parseScreenSummary`, `sectionFromSummary`, `notesToMarkdown`. The Engine owns `feedScreen` (adds vision cost to the session total, grows a `source: "screen"` script when none is loaded, keeps live notes), `setAnalysing`, `onLookNow`; `SessionState` gained `unmentioned` and `screenStats` so views can render the gap flags and the badge without any image.
- Capture lives in the surface: `apps/web/lib/screen/watcher.ts` samples a `getDisplayMedia` stream at 1 fps and grabs a ≤1280 px JPEG on demand; `useScreenSense` runs the loop and the hotkey flow. On desktop the app's own chooser (`desktopCapturer.getSources`, own window filtered out) feeds `setDisplayMediaRequestHandler`, so the page still calls plain `getDisplayMedia`; the region picker is a transparent always-on-top window on the display under the cursor and the crop happens in the main process at native resolution.
- `/api/vision` (engine-only) forwards one data-URL image to OpenRouter (`OPENROUTER_VISION_MODEL`); the route never logs the body and answers `unavailable: "disabled"` in offline mode. `/api/import` (engine-only) uses `unpdf` for PDF text and `jszip` + regex XML walkers for PPTX/DOCX; the result is reviewed in the script editor before it is saved.
- Not shipped from §6.1/§6.6: push-to-talk spoken question on the hotkey (Electron's `globalShortcut` has no key-up event), OCR of scanned PDF pages (no renderer without native dependencies; pages are flagged instead), the PowerPoint pane's slide text as a `slide-text` source (phase 3 follow-up).

### 6.7 Local-first tier (later)

Local Whisper for speech and a local vision model via Ollama for frames, chosen in an onboarding wizard with a plain consent screen stating what leaves the machine. Not in the first six phases.

### 6.8 Optional decision model

Jev remains a candidate behind the same `decide` interface for the yes/no gates ("is the speaker talking about what is on screen?", "suggest advancing?"). OpenRouter is the default by the owner's choice.

---

### 6.10 Local mode (v1): on-device models for privacy

Requirement from the owner: run fully on-device on Windows, Linux and macOS by downloading local models from inside the app; substitutes for the cloud decision model (Cloudflare Clef instead of Jev or OpenRouter), for speech-to-text, and a PII guard (Rizzo-PII) for anything that still goes to the cloud.

**Verified facts (2026-10-31, ollama.com/library/clef-flash)**: Clef (27B, multimodal, ~32 GB RAM) and Clef Flash (9B, ~16 GB RAM) are Apache 2.0 decision models from Cloudflare. On Ollama ≥ 0.35.1: `ollama pull clef-flash`, then `POST http://localhost:11434/v1/systemone` with `{model, state, questions: {id: {type: "noul", instructions, criteria}}}` returning `answers.<id>.noul` as a calibrated probability (1 to 64 questions per call, ~40 ms median for Flash on a GPU). Also hosted on Workers AI as `@cf/cloudflare/clef-flash`. Rizzo-PII (`rizzoaiacademy/rizzo-pii-0.3B`, ModernBERT token classification, 22 Italian PII categories) does reversible anonymise → cloud → de-anonymise; the reference implementation is Python (github.com/Rizzo-AI-Academy/rizzo-pii).

**Provider layer** (built): one function per capability on the server side, selected per request from Settings, with the env default as fallback.

| Capability | Cloud | Local | Where |
|---|---|---|---|
| decision | OpenRouter JSON classifier; Clef on Workers AI | **Clef via Ollama** (`packages/core/src/clef.ts` builds one `noul` question per open point and one per on-screen fact; the probability is the confidence, no JSON parsing) | `apps/web/lib/decide/*`, `/api/decide` |
| stt | ElevenLabs, OpenAI, Web Speech | **Whisper on-device** via transformers.js in a Web Worker (ONNX, WebGPU or WebAssembly; `onnx-community/whisper-base` or `-small`, downloaded from the Hub into the browser cache, ORT runtime served by the app from `/ort/`); 4 s windows, committed per window. Chosen over whisper.cpp because it needs no per-platform binary and runs identically in the web app, Electron and the PowerPoint pane | `packages/stt/src/whisper.ts` |
| vision (Screen Sense) | OpenRouter multimodal | Ollama vision model (qwen3-vl or similar), or Clef 27B for the yes/no gates | with Screen Sense |
| tts (v2) | cloud | Piper / Kokoro | v2 |

Rule kept from STT: an explicit provider choice never silently falls back to another provider; the UI shows the error.

**Settings > Local models** (built, `apps/web/app/settings/local`): detects Ollama (version ≥ 0.35.1, install link), shows RAM and a fits / tight / too big label per model, Pull with streamed progress from Ollama `/api/pull`, Delete, Test (one real decision with latency and the two probabilities), and the decision provider choice. Recommends clef-flash on 16 GB machines and clef on 32 GB+. Whisper and the vision model are listed as planned.

**Offline mode** (built): the desktop menu toggle forces local providers (`FILOW_OFFLINE=1`) and blocks every renderer request whose host is not this machine (`session.webRequest.onBeforeRequest`), with an OFFLINE chip in the top bar and zero cost in the footer. The web deploy honours the same env variable and can point `OLLAMA_URL` at an Ollama on the server.

**PII guard** (built, `apps/web/lib/pii/guard.ts`): before a cloud decision provider is called, every text field of the request (transcript window, point texts, covered, upcoming, on-screen facts) is anonymised with one shared in-memory map and placeholders are restored in the answer's `unmentioned` facts. Two layers: the **Rizzo-PII local server** (`POST /analyze` on `PII_SERVER_URL`, default `127.0.0.1:5005`, run from the repo's Docker image; response keys read defensively since only the README was available) when reachable, plus a **regex layer** always (emails, phones, IBANs, Luhn-valid card numbers, Italian codice fiscale). Modes: `PII_GUARD=on` (default), `strict` (refuse cloud calls without Rizzo-PII), `off`. Local providers skip the guard. The footer shows `pii rizzo+regex (n)` when placeholders were used.

**Config**: `DECISION_PROVIDER=openrouter|clef-local|clef-cloudflare`, `OLLAMA_URL`, `CLEF_MODEL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLEF_CLOUDFLARE_MODEL`, `FILOW_OFFLINE`; later `STT_PROVIDER`, `VISION_PROVIDER`, `PII_GUARD`.

### 6.9 Version 2: real-time drawing and speaking (not in the current pass)

Source: Farza's HeyClicky stream "we shipped something new" (youtube xOkfw1_ePhg; drawing at 15:00–24:50 and 28:50–38:20). Observed behaviour: voice first, a status chip cycling Listening / Thinking / Speaking; answers are spoken while drawings appear on floating cream "paper" cards with a small title, hand-drawn style type, boxes, arrows, grids and icons, revealed progressively with an orange pen marker in sync with the sentence being spoken; "point at" draws an orange rounded highlight around a real on-screen element; a native 3D engine renders labelled models (out of scope here). Lessons stated on stream: one strong model for voice, screen and routing beat a small router in front of a big model (the router misrouted and was slower); hide the model's thinking; a minimal agent harness beat a bloated one on speed and cost.

Design for our stack (the Electron desktop app owns it; phone and add-ins receive text plus a static image of each card):

1. **Overlay**: one transparent, always-on-top, click-through `BrowserWindow` per display (`setIgnoreMouseEvents`, no frame, no shadow), excluded from our own screen capture. It renders cards and highlights. A card is an SVG/canvas "paper" component with a handwriting-style font and rough.js-style strokes.
2. **Draw DSL** streamed from the model as newline-delimited JSON ops, executed as they arrive: `card(id,title,anchor)`, `text(card,x,y,str)`, `box(card,x,y,w,h,label)`, `arrow(card,from,to)`, `grid(card,rows,cols,values)`, `icon(card,name)`, `highlight(bbox | elementText)`, `pointer(x,y)`, `clear(card)`, interleaved with `say(text)`. The renderer animates each op over ~300 ms with the pen marker and advances only when the matching `say()` has started playing, so audio and drawing stay in sync.
3. **Speaking**: streaming TTS (ElevenLabs streaming or OpenAI realtime voice) fed sentence by sentence from the `say()` ops; barge-in cancels playback and pending ops when the user speaks. Status chip in the top bar.
4. **Pointing at the screen**: the current frame goes to the multimodal model with a numbered grid overlay (or normalised 0–1000 coordinates); it returns a bbox for `highlight()`. Fallback: text search in the OCR summary when the model cannot localise.
5. **One brain**: one strong multimodal model via OpenRouter receives the voice transcript, the frame and the session state and emits the op stream. No separate router model. The cheap per-tick classifier for talking points stays unchanged.
6. **Modes in the teleprompter**: (a) rehearsal coach: "explain this slide with a drawing" yields a card you can keep as a speaker note; (b) live silent mode: only `highlight()` and `pointer()` ops, no speech, used by the gap detector to point at the figure not yet mentioned; (c) Q&A mode after the talk: full voice and drawing.
7. **Privacy and cost**: Screen Sense rules apply (frames memory-only, text kept, cost dial); voice and drawing calls are on demand only, never on the tick loop.
8. **Not copied**: the native 3D engine and the agent / computer-use system.

Rough effort: overlay + DSL renderer 3 days, TTS sync + barge-in 2 days, pointing 1 day, modes and UI 2 days.

## 7. PowerPoint add-in (phase 3, spike first)

**What works**: a task pane that shows the Filow view, reads speaker notes as the script (one slide = one section, `-` lines = points), follows the *selected slide in Normal view* both ways, and feeds slide text to Screen Sense without screenshots.

**What does not exist in the platform**: the PowerPoint JavaScript API has no slide-show navigation and no slide-change event during a running show, and the task pane is not visible in Slide Show or Presenter View. So during the actual presentation the live view is the phone or the desktop app, exactly like Google Slides. The pane is for rehearsal in Normal view and for loading the script.

**Engine mode vs view mode**: the pane can be the engine (mic + STT inside the pane) only where the runtime is WebView2 (Windows, Microsoft 365 Current Channel) or PowerPoint for the web; detected via `navigator.mediaDevices` and `Office.context.diagnostics`. Everywhere else, including Mac (WKWebView blocks microphone prompts), the pane is a view and pairs by code. The spike at the start of phase 3 verifies mic capture on Windows and web before the rest is built. Web Speech is unavailable in WebView2 but present in PowerPoint for the web (Chrome); `browserSupported()` gains Office detection.

Files: `apps/powerpoint/manifest.xml` (requirement set `PowerPointApi 1.4`, permission `ReadDocument`, served from the hosted HTTPS origin), `src/taskpane.tsx`, `src/office.ts` (`readNotesAsScript`, `onSelectionChange`, `selectSlide`). Distribution: trusted-catalog sideload on Windows desktop, "Upload my add-in" on the web, or Microsoft 365 admin centralized deployment.

### 7.4 Script from slides without notes (shipped)

`POST /api/script/generate` (engine token, or a short-lived engine token that the relay mints for an accepted controller via `POST /api/session/:id/engine-token`) takes `{ language?, slides: [{ index, title?, text, notes?, imageBase64?, hasPicture? }] }` and streams NDJSON: one `{progress}` per slide, then `{done, text, script, model, cost, perSlide}`. The pure part lives in `packages/core/src/generate.ts`: notes win per slide (`- ` lines verbatim, prose split by sentence), the model fills the rest with 3–5 spoken claims plus an italic transition line, and the output is script.md with the slides marker and `<!-- slide: n -->` comments so Follow mode maps slide → section. A slide gets an image only when it has little text (< 40 chars) or a picture, and only if the caller attached one. Providers: OpenRouter `google/gemini-2.5-flash-lite` (text) / `gemini-2.5-flash` (image slides); offline or `GENERATE_PROVIDER=ollama`: Ollama `gemma4:e2b` by default (`gemma4:e4b` on 16 GB, `qwen3-vl:2b` light, `lfm2.5-vl` English-only), listed in Settings > Local models. Cloud calls go through the PII guard. The PowerPoint pane collects slide text (shapes, tables, alt text, notes via a two-phase load that never touches text frames of pictures) and `getImageAsBase64` where the host has PowerPointApi 1.8; the pane never holds keys. This is a one-shot pre-talk job and never touches the 500 ms live loop.

On the desktop app the pane is served from `https://localhost:4749/powerpoint/` and joins the app's own session automatically: the engine page reports its session code to the shell, the HTTPS proxy answers `/api/local/current-session` only on 127.0.0.1, and the pane in View mode pairs with it (auto-accepted as a local peer).

### 7.5 Following the live show and the presenter overlay (desktop, shipped)

The JavaScript API cannot see a running show, but desktop automation can: `apps/desktop/slideshow.js` polls `PowerPoint.Application.SlideShowWindows(1).View.Slide` through COM in a Windows PowerShell 5.1 helper (GetActiveObject needs the .NET Framework runtime) and `slide show view of slide show window 1` through AppleScript on macOS, 400–500 ms, one JSON line per change. The shell forwards `{running, index, total, title}` to the engine page, which dispatches `slideChanged`; sections follow when the script came from slides. The presenter overlay is a frameless always-on-top `BrowserWindow` loading `/mirror?compact=1&overlay=1&code=<current code>`: a compact `StageView` (title, points, next title) joined to the app's own session as a local peer, opened and closed with the show, position remembered, optional `setContentProtection` to stay out of recordings.

## 8. Google Slides add-on (phase 5)

Speaker notes are the script. Constraints: the Slides API cannot drive or observe Present mode; HtmlService sidebars get no microphone; there is no selection-change event, only polling through `google.script.run` (1 s interval, rehearsal-length budgets fit daily quotas; no `UrlFetchApp` per poll).

The add-on does two jobs: **Export** notes as a Script to the session server (one `UrlFetchApp` call, through `/api/session/:id/script` with a controller token obtained by code), and **Mirror in the editor** by nesting the hosted `/mirror` page in an iframe and bridging the selected slide index with `postMessage`. Live presenting is not a sidebar feature; the phone or desktop app is the live view.

Files: `apps/gslides/appsscript.json`, `Code.gs`, `Sidebar.html`. Deploy with `clasp`; internal Workspace listing.

### 8.3 Browser extension for HTML decks (apps/browser, shipped)

Manifest V3, one codebase for Chrome, Edge, Brave, Opera and Arc; Firefox through `webextension-polyfill` (`sidebar_action`); Safari later with `xcrun safari-web-extension-converter`. The side panel pairs with a session by server URL and code (controller after the presenter accepts), shows `StageView`, and drives the deck tab through a content script injected on demand (`activeTab` + `scripting`; host permission only for the configured servers, requested at pairing). Adapters: reveal.js, Slidev, Marp, impress.js, and a generic one that reads the text intersecting the viewport (Canva and Pitch present pages). Slide changes: `hashchange`, `popstate`, `fullscreenchange`, reveal's `slidechanged`, and a `MutationObserver` debounced at 300 ms. Two modes: **Generate script from this deck** steps through the slides (adapter `next()` or ArrowRight), collects text and, for image slides, a `captureVisibleTab` frame, calls `/api/script/generate` and loads the result into the session; **Follow** sends `slideChanged` on every change and, for image-only slides, a frame to `/api/vision` under the cost dial. Page text is untrusted data. Store listing needs a privacy policy page; until then the zip in the release is loaded unpacked.

## 9. Phone app (phase 2 as PWA, phase 4 as Expo)

Expo SDK 52+, TypeScript, reusing `packages/core` and `packages/client`. UI is re-implemented in React Native (packages/ui is web-only). Modules: `expo-camera` (QR, `CameraView` barcode scanning), `expo-haptics`, `expo-keep-awake`, `react-native-reanimated`. Screens: Pair, Stage, Remote, Settings.

iOS suspends background sockets within seconds of screen lock, so the "remote in a pocket" use case is screen-on only; the app reconnects on foreground. "Phone as microphone" needs raw 16 kHz PCM, which `expo-audio` does not give; it requires a native module and an EAS dev client, and is deferred.

## 10. Risks and mitigations

| Area | Risk | Mitigation | Phase |
|---|---|---|---|
| Security | Public server: anyone can mint STT tokens or call `/api/decide` and burn credit | `ACCESS_PASSWORD` mandatory when the server is not bound to localhost; `/api/decide`, `/api/stt/*`, `/api/vision`, `/api/import`, `/api/script` (PUT), `/api/script/*`, `/api/local/{plan,pull,test,unload}` require an engine token; STT minting bound to a session id with a per-session quota | 2 |
| Security | 6-digit code brute force | 10 pair attempts per IP per minute, codes unique among live sessions, sessions capped at 12 h, `viewer`/`controller` roles, `loadScript` controller-only | 2 |
| Security | Screen frames leak | memory-only, no logs, window excluded, text-only to views, visible badge, kill switch | 6 |
| Availability | Engine laptop loses Wi-Fi mid-talk | views keep last state dimmed with "engine offline"; engine reconnects and resends full state; session survives 2 h | 2 |
| Availability | Relay process crashes | engine reconnect re-creates the session with the same id and code; views resync | 2 |
| Availability | OpenRouter 5xx or slow | per-call timeout 2.5 s, skip the call, keep last confidences, error chip; cost cap stops runaway | 1 |
| Availability | STT provider fails mid-take | Auto mode falls back to the next backend; an explicit backend choice never silently falls back, it shows an error | done |
| Scalability | In-memory store, one process | fine for one presenter; Redis adapter behind the same store interface if several people share a server | later |
| Platform | Office.js and Apps Script limits (§7, §8) | spikes before building; features scoped to what the APIs do today | 3, 5 |
| Platform | iOS background sockets | screen-on remote only, reconnect on foreground | 4 |
| Cost | Screen Sense calls add up in Real-time mode | cost dial, 20 frames/min cap, same session cost cap | 6 |

## 11. Test plan

Runner: vitest, tests beside sources in `packages/*/src/**.test.ts`; Playwright in `apps/web/e2e`.

- `core/engine`: flips at 0.70 after two confirming calls, flips at `sureThreshold` (0.85) or more on one; `nextSection` marks waiting points missed; `prevSection` marks nothing; `resetSection` clears only the current section; `reopen` returns a missed point to waiting; cost cap stops the loop; version increments once per emitted patch; `parseScript` ids are stable across re-parses.
- `core/prompt`: `parseDecisions` handles fences, missing ids, out-of-range confidence.
- `server`: two views receive identical patch sequences; second engine closed with 4001; bad code 404; 11th pair attempt 429; expiry at 2 h after engine close and at 12 h absolute with fake timers; `resync` returns full state.
- e2e: open `/` as engine with a mock `decide`, open `/mirror?code=` in a second context, send `nextSection` from the mirror, assert the engine's section changes and the mirror shows the new section.
- Screen Sense: dedup rejects an identical frame and accepts a changed one; cap enforced; `unavailable` reasons rendered.

## 12. Alternatives considered

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| D1 Relay process | separate `ws` process | custom Next server; SSE + POST; WebRTC data channel; hosted pub/sub (PartyKit, Liveblocks) | custom server breaks standalone output; SSE needs a second channel for commands; WebRTC adds signalling for no benefit on a relay; hosted pub/sub adds a third party for a one-user tool |
| D2 Desktop topology | LAN relay by default, hosted optional | always hosted; always LAN | always hosted forces a server for a single-laptop user; always LAN cannot serve add-ins |
| D3 State sync | full state + RFC 6902 patches | full state every change; custom merge | full state at 2 Hz is fine on LAN but wasteful on mobile data; custom merge is one more thing to get wrong |
| D4 Pairing | 6-digit code + QR, roles | accounts; magic links | accounts are a non-goal; links alone cannot be typed from a phone |
| D5 Monorepo | npm workspaces, no Turborepo | single package with aliases; pnpm + Turbo | aliases cannot be consumed by Expo or the add-ins; Turbo adds nothing for five packages |
| D6 Mobile | PWA first, then Expo | Expo first; Capacitor; Flutter | PWA ships in a day and is the fallback for everyone; Capacitor and Flutter cannot reuse `core` and `client` as directly |
| D7 PowerPoint | Office.js task pane, editor-view sync | Windows COM/Interop overlay | COM would allow slide-show control but is Windows-only, needs an installer, and cannot ship to Mac or web |
| D8 Screen capture | always-on with change detection + hotkey region | hotkey-only (Clicky); fixed interval | hotkey-only misses the "watch my slides" case the owner asked for; fixed interval wastes calls on static slides |
| D9 Vision model | OpenRouter multimodal (Gemini Flash) | local model | local is the later tier; the owner's cost dial needs the cloud path first |

## 13. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-31 | OpenRouter for decisions, no Jev by default | owner's choice |
| 2026-10-31 | All three STT backends with Auto selection; explicit choice never falls back silently | owner's choice; claude-video policy |
| 2026-10-31 | PWA mirror before store apps | owner's choice |
| 2026-10-31 | Slides add-on is export + editor mirror only | platform limit, accepted by owner |
| 2026-10-31 | Screen Sense: always-on + hotkey region, memory-only frames, cost dial, document import | owner's requests via side session |
| 2026-10-31 | D1–D9 above | this document |
| 2026-10-31 | Drawing and speaking (Clicky-style) is version 2, specified in §6.9, not built in the current pass | owner's request via side session |
| 2026-10-31 | Phase 3 PowerPoint add-in built (apps/powerpoint) | this repo |
| 2026-10-31 | Local mode is v1: Clef via Ollama as the local decision model, Settings page, offline switch built; local Whisper and the PII guard next | owner's request via side session |
| 2026-10-31 | On-device Whisper via transformers.js (not whisper.cpp) and the PII guard (Rizzo-PII sidecar + regex) built | this repo |

## 14. Roadmap

Estimates assume one engineer, include tests, exclude store review and code signing.

| Phase | Deliverable | Days |
|---|---|---|
| 1 | Monorepo split per §5.7; `Engine` class with flip rule, per-call timeout and cost cap; engine tests; web and desktop unchanged for users | 3 |
| 2 | `apps/server` relay with pairing, roles, TTLs, rate limits and tests; engine token gating on the Next API; desktop LAN and hosted modes; `/mirror` PWA; Caddy and systemd docs | 4 |
| L1 | Local mode (§6.10): provider layer, Clef via Ollama, Settings > Local models, offline switch | done |
| L2 | On-device Whisper backend with in-app model download; PII guard (Rizzo-PII + regex) before cloud calls | done |
| 6a | Screen Sense on desktop: always-on capture with dedup and cap, ON SCREEN strip, cost dial, Forget button | done |
| 6b | Document import; hotkey region picker; gap detector; live notes export | done (push-to-talk question and scanned-PDF OCR deferred) |
| 3 | PowerPoint: one-day spike (mic on WebView2 and web, selection sync), then notes → script, editor sync, slide text to Screen Sense | 1 + 4 |
| 4 | Expo app: Pair, Stage, Remote, Settings; EAS builds | 5 |
| 5 | Google Slides: export, editor mirror, internal listing | 3 |
| 7 | Model routing, auto-advance suggestion, post-talk report, local-first tier | later |
| v2 | Real-time drawing and speaking (§6.9): overlay, draw DSL, synced TTS with barge-in, screen pointing, three modes | 8 |

Phases 3, 4 and 5 are independent once phase 2 exists and can run in parallel; 6a and 6b depend on phase 1 only.

## 15. Open decisions

1. Default vision model and whether Real-time mode is enabled by default (cost).
2. Whether the hosted server should offer sign-in once more than one presenter shares it (currently a non-goal).
