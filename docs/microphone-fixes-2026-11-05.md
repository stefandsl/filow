# Microphone selection, capture warnings and model-download recovery

Implemented against the owner's 2026-11-05 USB/C920 diagnosis. No version change or release.

## Source map

- `packages/stt/src/micDevice.ts`: browser device enumeration and default marking, persisted
  preference, async constraints with exact deviceId and logged missing-device fallback.
- `apps/web/components/MicrophoneSelect.tsx`: shared Settings/action-bar picker, permission
  button for device names, devicechange/storage/focus refresh, next-start tooltip and Web Speech note.
- `packages/stt/src/mic.ts`, `silence.ts`: passive peak/track monitoring, four-second silence
  transition, recovery and measured AudioContext constructor duration. The 0.9.6 sample rate,
  chunk length, PCM conversion, probe open/stop and muted output graph remain unchanged.
- `packages/stt/src/types.ts` and all four PCM backends: dedicated recoverable warning callback.
  `Teleprompter.tsx` renders the translated role=alert and focuses/opens the shared selector.
- `apps/desktop/stt.js`, `stt-download.js`: header/body idle protection, pipeline response/output
  error handling, aborted response handling, content-length validation before extraction,
  partial cleanup and one initial attempt plus three retries after 5/15/45 seconds.
  `main.js` logs attempt messages through onStatus; `package.json` includes the helper in installers.

## Verification

- `npm run typecheck`: passed across all workspaces.
- `npx vitest run --root G:/FILOW`: 230 passed, one existing skipped test, 39 passing test files.
- `npm run build -w apps/web`: passed, including standalone preparation.
- New tests: six device preference cases, four pure silence-sequence cases, five capture wiring
  cases, ten download helper cases. Download tests use fake streams/timers and make no network requests.
- Production Chromium UI checked at 1280x820 and 760x540 in both themes, plus EN/IT labels.
  Simulated devices and capture verified: default labels, preference persistence into Settings,
  Web Speech note, silence alert after four seconds, recovery, ended-track alert, no automatic
  stop, chooser focus/open, next-take selection, unplug/devicechange fallback and take-log entry.
  No page errors. A fallback-note navigation overflow discovered during QA was fixed and rechecked.
- Inspected screenshots in `output/playwright/mic-fixes/`: dark/light silence alerts, both
  viewport widths and Settings. Assertions are in `tmp/codex/mic-browser.cjs`, with results in
  `output/playwright/mic-fixes/results.json`. QA artifacts are intentionally uncommitted.

## Limits

The owner still needs to test the actual USB and C920 devices in packaged Electron. A preliminary
browser check using an oscillator-generated stream still hit a real AudioContext/output-service
stall of about 20 seconds; the new measured warning and log appeared. Subsequent deterministic
UI checks used simulated contexts/worklets, tracks and backend IPC. This is not evidence of
successful live hardware transcription. No real model was downloaded and no installer was built.

Web Speech provides no input track/PCM graph to inspect and always uses the system default.
A synchronous AudioContext constructor blocks JavaScript; its warning renders after it returns.
The QA server and browser processes started for these checks were stopped. No Electron was started.
