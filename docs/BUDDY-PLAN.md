# OK Filow - plan (Clicky features in Filow)

Source: github.com/farzaa/clicky (MIT, macOS Swift). We port the behaviour, not the code: Filow is Electron + Next.js.
Owner choices (2026-11-06): full Clicky feature set; local AI by default, cloud only when turned on.

## What Clicky does, and the Filow equivalent

| Clicky | OK Filow |
|---|---|
| Menu bar app, floating panel (status, hotkey help, model picker, permissions, quit) | Tray icon + small frameless panel window: status, hotkey, provider picker (local / cloud), "Show buddy" toggle, quit |
| Full-screen transparent overlay with a blue cursor that follows the mouse | Click-through transparent `BrowserWindow` per display (`setIgnoreMouseEvents(true)`, always on top, all workspaces); buddy dot follows `screen.getCursorScreenPoint()` |
| Push-to-talk: hold Ctrl+Option, release to send | Hold Ctrl+Alt (configurable). Electron `globalShortcut` has no key-up, so we add `uiohook-napi` for press/release |
| Live waveform and spinner next to the cursor | Same, in the overlay, from the mic level |
| STT: AssemblyAI streaming (OpenAI, Apple fallback) | Local: Nemotron/sherpa streaming or Whisper (already in Filow). Cloud: existing ElevenLabs/OpenAI STT providers |
| Screenshot of every monitor (ScreenCaptureKit) | `desktopCapturer` at native size per display, labelled screen1..N with size and scale |
| Claude vision, streamed, with conversation history | Local: Gemma 4 vision via Ollama (`/api/chat`, streamed). Cloud: OpenRouter multimodal (existing client). Short history kept in memory only |
| Spoken answer via ElevenLabs | Local: OS voices via Web Speech `speechSynthesis` (offline on Windows/macOS). Cloud: ElevenLabs TTS if a key is set |
| `[POINT:x,y:label:screenN]` tags: cursor flies along a bezier arc and points | Same tag grammar in the system prompt; parser strips tags from the spoken text; overlay animates the dot along a quadratic bezier to the mapped point (DIP coords per display) with a label |
| Transient mode: when "show buddy" is off, the overlay appears only during an interaction and fades 1 s after | Same |
| Text bubble with the answer next to the cursor | Same, streamed |
| Analytics (PostHog) | Not ported (Filow has no telemetry) |
| Cloudflare Worker proxy for keys | Not needed: keys stay in Filow's local settings as today |

## Privacy rules (unchanged Filow rules)
- Local provider: screenshot, audio and text never leave the PC; Offline mode blocks everything non-local.
- Cloud provider: explicit opt-in, no silent fallback; on error the bubble shows the error.
- Screenshots are kept in memory only. The one exception is the answer log, which is opt-in and off by default: it writes to a folder the user picks (never C:), or to G:\FILOW\tmp\okf-answers in test builds, and the panel can delete it. Overlay and panel use content protection so they are not in the screenshot sent to the model.

## Build steps
1. `apps/desktop/buddy/`: overlay window(s), panel window, tray entry, uiohook push-to-talk, multi-display capture (main process).
2. `apps/web/app/buddy/overlay` page: dot, follow, waveform, bubble, bezier pointing, fade logic.
3. `apps/web/lib/buddy/`: prompt + `[POINT]` parser (unit tested), provider layer `ask(images, transcript, history)` for Ollama Gemma and OpenRouter, TTS adapter.
4. `/api/buddy/ask` streaming route reusing the vision + PII guard code paths.
5. Settings: Buddy section (hotkey, provider, voice, show buddy), IT + EN strings.
6. Tests: parser, coordinate mapping (multi-monitor, scale 1.25/1.5), provider selection and no-fallback rule, offline block.
7. E2E on the packaged app: hold hotkey, ask "where is the Start button", check the answer is spoken and the dot lands on it.

## Risks
- Pointing accuracy with local Gemma is lower than Claude's; coordinates are asked on a downscaled image and scaled back. We will measure on a fixed set of screenshots before release.
- `uiohook-napi` is a native module: needs rebuild per Electron version and Linux X11; macOS needs Accessibility permission.
- Speed: Gemma 4 E4B on CPU may take several seconds per answer; GPU recommended.
