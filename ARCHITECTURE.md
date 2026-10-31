# Intelliprompter architecture

Where the project is, and the plan to turn it into a multi-surface product: web, desktop, **PowerPoint add-in**, **Google Slides add-on**, and **Android / iOS companion apps** that mirror the live session on a phone.

---

## 1. Today (v0.1)

One Next.js app. Browser captures the mic, streams it to a transcription backend, and every 500 ms posts the transcript plus the open talking points to `/api/decide`, which asks an OpenRouter model which points have been started. All state lives in one React component.

```
┌────────────── browser / Electron window ──────────────┐
│ mic ─► STT backend ─► transcript ─► 500 ms tick ──────┼─► /api/decide ─► OpenRouter
│                                       ▲               │
│  Teleprompter.tsx (all state, all UI) ┘               │
└───────────────────────────────────────────────────────┘
```

Works, but every new surface (a PowerPoint task pane, a phone) would have to re-implement the mic, the loop and the state. That is the thing to fix first.

---

## 2. Target architecture

**One session, many views.** The laptop that captures audio runs the *engine*. Every other surface is a *view* of that session over a WebSocket. Views send commands (next section, reset, mark missed) and receive state (points, confidence, transcript tail, stats).

```
                 ┌──────────────────────── Session server (Next.js) ────────────────────────┐
                 │  /api/decide          OpenRouter decisions                                │
                 │  /api/stt/*           token minting for ElevenLabs / OpenAI               │
                 │  /api/session/*       create session, 6-digit pair code, QR               │
                 │  /ws/session/:id      fan-out of SessionState, fan-in of commands         │
                 └───────────┬───────────────────────────────┬──────────────────────────────┘
                             │                               │
          engine (exactly one per session)                   │ views (any number)
┌────────────────────────────┴──────────────┐   ┌────────────┴──────────────────────────────┐
│ Web app / Desktop app (captures mic,      │   │ Phone app (Android / iOS)   mirror + remote│
│ runs STT, runs the 500 ms decision loop,  │   │ PowerPoint add-in task pane mirror + slide │
│ publishes SessionState)                   │   │ Google Slides add-on sidebar  sync         │
└───────────────────────────────────────────┘   │ Second browser tab / OBS overlay           │
                                                └───────────────────────────────────────────┘
```

### 2.1 Shared packages (monorepo)

```
packages/
  core/        pure TypeScript, no DOM, no React
               - types.ts            Script, Section, Bullet, SessionState, Command
               - script.ts           Markdown parser (exists today in lib/)
               - engine.ts           the decision loop as a class: feed(transcript) → emits state
               - prompt.ts           the classifier prompt + request builder (today in /api/decide)
  stt/         browser-side transcription backends (exists today in lib/stt/)
  ui/          React components shared by web, desktop, add-ins: PointList, SectionHeader, MissedTray
  client/      tiny WebSocket client: connect(code) → state stream + sendCommand()
apps/
  web/         the Next.js app (also the session server)        ← today's repo root
  desktop/     Electron shell                                   ← today's electron/
  powerpoint/  Office.js add-in (task pane)
  gslides/     Google Workspace add-on (Apps Script + HTML sidebar)
  mobile/      Expo (React Native) app for Android + iOS
```

Tooling: npm workspaces + Turborepo. Nothing exotic.

### 2.2 SessionState and Command (the contract everything speaks)

```ts
type SessionState = {
  id: string; version: number;              // version increments on every change
  script: Script;                           // sections and points
  sectionIdx: number;
  points: Record<string, { status: "waiting"|"started"|"missed"; confidence: number; startedAt?: number }>;
  missed: string[];                         // point ids
  transcriptTail: string;                   // last ~200 chars
  stats: { calls: number; avgMs: number; cost: number; model: string };
  engine: { backend: SttBackendId | null; recording: boolean; error?: string };
  slide?: { index: number; total: number; title?: string };   // set by PowerPoint / Slides when linked
};

type Command =
  | { type: "nextSection" } | { type: "prevSection" } | { type: "goToSection"; idx: number }
  | { type: "resetSection" } | { type: "clearMissed" } | { type: "markStarted"; id: string }
  | { type: "startTake" } | { type: "stopTake" }
  | { type: "loadScript"; text: string }
  | { type: "slideChanged"; index: number; total: number; title?: string };   // from PowerPoint / Slides
```

Transport: plain WebSocket. The engine sends the full state on connect, then deltas (`{version, patch}`) on every change. Views are stateless and can reconnect at any time.

Pairing: the engine shows a **6-digit code and QR**. A view enters the code (or scans) and gets a short-lived session token. No accounts needed for a single user. Sessions expire 2 h after the engine disconnects.

### 2.3 Decision engine improvements (shipped in this commit)

The classifier prompt now receives three lists instead of one:

| List | Purpose |
|---|---|
| OPEN POINTS | the only ones it decides on |
| COVERED POINTS | so speech about an already-checked point is not credited to a lookalike open point |
| UPCOMING POINTS | so "moving on to the next section" is not read as covering the current one |

Plus a confidence rubric (0.70 = started), explicit rules for announcements ("I'll talk about X" is not a start), shared-keyword false positives, and multilingual speech. Next steps for the engine, in order of payoff:

1. **Hysteresis per point**: require two consecutive ticks ≥ 0.70, or one tick ≥ 0.90, before flipping. Cuts flicker from partial transcripts.
2. **Section auto-advance**: when all open points are started, or the transcript matches ≥ 2 upcoming points at ≥ 0.80, suggest "Next section" (phone vibrates, add-in highlights the button).
3. **Model routing**: cheap model for the per-tick check, a stronger one only when the cheap model returns 0.40–0.69 on a point for 3+ ticks. This is the small/medium/large router from the video, done with OpenRouter.
4. **Cost cap**: per-session budget in the engine, visible in every view.

---

## 3. PowerPoint add-in (Office.js)

**What the presenter gets:** a task pane inside PowerPoint that shows the Intelliprompter view for the *current slide*, follows along as they speak, and advances slides when they tell it to (or automatically when a section completes).

**Key design decision: talking points live in the slide notes.** Each slide's notes become one section; lines starting with `-` become its points. No separate script to maintain. "Reload script" re-reads the notes.

```
PowerPoint ──Office.js──► task pane (React, packages/ui)
   │  slide notes  ─────► Script (one section per slide)
   │  SlideSelectionChanged ─► Command slideChanged ─► engine jumps to that section
   ◄─ goToSlide(n)  ◄─────── engine: section advanced (manual or auto)
```

Components:

- `apps/powerpoint/manifest.xml` – add-in manifest (task pane, `ReadWriteDocument` permission; served over HTTPS from the session server, e.g. `https://prompter.example.com/powerpoint/`).
- `apps/powerpoint/src/taskpane.tsx` – React task pane. Two modes:
  - **Engine mode** (laptop runs PowerPoint and has the mic): the task pane *is* the engine. Mic + STT run inside the pane (Office.js task panes are Edge WebView2 / Safari web views, `getUserMedia` works on Windows and Mac desktop PowerPoint; browser PowerPoint also works).
  - **View mode**: PowerPoint is on a different machine (e.g. the venue PC); the pane pairs with the engine by code and only mirrors + syncs slides.
- `apps/powerpoint/src/office.ts` – thin wrappers: `readNotesAsScript()`, `onSlideChange(cb)`, `goToSlide(n)` (`PowerPoint.run` + `context.presentation.getSelectedSlides()`; in slide show mode uses `SlideShow` APIs where available, falls back to keyboard-free "selected slide" sync in Normal view).
- Web Speech is not available inside Office web views; the add-in uses ElevenLabs or OpenAI STT (same as desktop).

Distribution: sideload for yourself (`manifest.xml` → Insert → Add-ins → Upload my add-in), or **Microsoft 365 admin centralized deployment** for a company. Public AppSource listing is optional and needs a Partner Center account.

---

## 4. Google Slides add-on (Google Workspace add-on)

Same idea: **speaker notes are the script**. Constraints are tighter than PowerPoint:

- Apps Script sidebars can read notes and the *currently selected slide in the editor*, but the **Slides API cannot drive or observe the live presentation (Present mode)**. There is no "advance slide" API.
- The sidebar is an iframe (`HtmlService`) with a strict sandbox; `getUserMedia` does work in the sidebar iframe, but Web Speech does not.

So the add-on does two jobs well and does not pretend to do the third:

1. **Export**: one click turns the deck's speaker notes into an Intelliprompter script (one section per slide) and pushes it to the session server (`POST /api/session/:id/script`). The web app, desktop app or phone then runs the take.
2. **Mirror in the editor**: while rehearsing in the editor (not Present mode), the sidebar pairs with the engine by code and shows the live view; selecting a slide sends `slideChanged`.
3. **Live presenting**: use the phone app or the desktop app as the view; the laptop in Present mode just shows slides. Honest limitation, documented in the add-on's help.

Files: `apps/gslides/appsscript.json`, `Code.gs` (menu, `getNotesAsScript()`, `onSelectionChange` polling), `Sidebar.html` (loads the shared React view from the session server by URL so the UI is not duplicated). Deploy with `clasp push`; install for your account as a test deployment, or publish to the Workspace Marketplace (internal-only listings are free for a Workspace domain).

---

## 5. Android / iOS companion app

**Purpose:** the phone is the thing you actually look at while on stage. Big type, current section, points flipping live, a vibrate when a section completes, and remote buttons (Next / Prev / Reset / Missed). It also works as a **second mic**: if the laptop is far away, the phone can be the engine.

Stack: **Expo (React Native) + TypeScript**, reusing `packages/core` and `packages/client` directly. One codebase, both stores, EAS Build does the signing. Expo modules used: `expo-av` (mic, as engine), `expo-haptics`, `expo-barcode-scanner` (pair by QR), `expo-keep-awake`, `react-native-reanimated` (confidence bars).

Screens:

1. **Pair** – scan QR or enter 6-digit code. Remembers the last server URL.
2. **Stage** – landscape-friendly, dark, huge type. Section title, points with WAITING % / STARTED, Next strip, Missed tray as a swipe-up sheet. Tap a missed point to re-open it. Volume keys = prev/next section (optional).
3. **Remote** – minimal: Next / Prev / Reset / Start take / Stop take, for when the phone is in a pocket.
4. **Settings** – server URL, haptics, font size, "use this phone as microphone".

Why not a PWA? A PWA mirror is a two-day job and worth shipping first (the web app already resizes; add a `/mirror/:code` route). But store apps are what you asked for, and they add haptics, keep-awake, reliable background WebSocket and a camera QR scanner. Plan: PWA mirror in phase 2 as the fallback for everyone, Expo app in phase 4.

---

## 6. Security and privacy

- API keys stay on the session server. Views never get them. Engine gets short-lived STT tokens only.
- Sessions are pairing-code scoped; tokens are random 128-bit, expire with the session. Rate-limit pairing attempts.
- Transcripts are not stored. The server holds the last state in memory only (Redis later if you run more than one server).
- Add-ins and mobile talk only to *your* session server. Nothing goes to a third party except OpenRouter and the chosen STT provider.
- Optional: an `ACCESS_PASSWORD` the engine must present to create a session, so a public server cannot be used by strangers to burn your credits.

---

## 7. Roadmap

| Phase | Deliverable | Effort |
|---|---|---|
| 1 | Monorepo split: `packages/core`, `packages/stt`, `packages/ui`; engine as a class; web app unchanged for users | 2 days |
| 2 | Session server (`/ws/session`), pairing codes + QR, **PWA mirror** at `/mirror`; desktop app publishes sessions | 3 days |
| 3 | **PowerPoint add-in**: notes → script, slide sync both ways, engine mode and view mode; sideload instructions | 4 days |
| 4 | **Expo mobile app**: Pair, Stage, Remote screens; EAS Build for Android APK/AAB and iOS TestFlight | 5 days |
| 5 | **Google Slides add-on**: export notes, editor mirror, Marketplace internal listing | 3 days |
| 6 | Engine v2: hysteresis, auto-advance, model routing, cost cap | 2 days |

Phases 3, 4 and 5 are independent once phase 2 exists and can run in parallel.

---

## 8. Open decisions

1. **Mobile first as PWA or go straight to the store apps?** Recommendation: PWA in phase 2 (cheap, instant), Expo app in phase 4.
2. **Google Slides without live Present-mode control is acceptable?** There is no API for it; the phone or desktop app is the live view.
3. **Hosting for the session server**: the Debian box from the README works as is (WebSockets pass through Caddy). Needs a public HTTPS URL for the add-ins.
4. **Accounts**: none for v1 (pairing codes). Add sign-in only if several people share one server.
