# What leaves this PC, and how the user is told

Owner's requirement (2026-11-09): if information goes outside, the user gets a visible confirmation
at the moment it happens, and is told that the screenshot and the recorded voice go to other
servers such as Google.

Three rules, enforced in code:

1. **Notice before the first send.** The first time one kind of content would go to one recipient,
   a notice says what goes where, with "Send" and "Keep it on this PC". Nothing is sent before the
   answer. The answer is stored per kind and per recipient (`kind:recipient-id`, for example
   `ask:openrouter/google`) in OK Filow's settings, and is listed in the OK Filow panel's settings,
   where each one can be withdrawn. Windows send only the choices they changed and the main
   process merges them, so a yes withdrawn in one window is never brought back by another. A take
   re-reads the choices every two seconds and stops if the yes for its microphone or words is gone.
2. **A signal every time.** While a request carrying user content is in flight, the OK Filow
   pointer and panel (or the take page) show "Going outside - Sending to <names>". Local answers
   never show it. A streaming microphone shows it for as long as audio streams.
3. **The server refuses without the key.** Every route that forwards user content to a third party
   answers 403 `consent_required` unless the request carries `x-filow-consent: <kind>:<recipient-id>`
   for exactly the recipient the server would use now (`consentDenied` in `apps/web/lib/buddy/outbound.ts`).
   A changed model (another maker) is another recipient, so it needs a new yes.

Recipient names always come from the provider and model configured right now
(`GET /api/buddy/recipients`), never from fixed text. OpenRouter forwards to the company that runs
the model. For makers that run their own models (`MAKER_HOSTS` in `outbound.ts`: Google, OpenAI,
Anthropic, without their open-weight families) every request is pinned to the maker's own hosts
(`provider: { only: [...] }`, an allowlist: a fallback stays among the maker's hosts; `openRouterProvider` in `lib/openrouter.ts`),
so both names are true ("OpenRouter and then to Google, the maker of the model you chose"). For any
other model OpenRouter picks the host, and the recipient says so (`picked`, id `openrouter/<maker>@any`:
"OpenRouter and then to a company OpenRouter picks to run the model made by Meta (it may be a company
other than Meta)"); a yes for a pinned model never covers it, and the signal then names OpenRouter only.

## Inventory

| # | Where | What leaves | To whom | Gate (server) | Notice / signal |
|---|-------|-------------|---------|---------------|-----------------|
| 1 | OK Filow question, cloud mode (`/api/buddy/ask`, `lib/buddy/providers.ts`) | the question and screenshots of the screens | OpenRouter, then the model's maker (`buddyCloudRecipient`) | `ask` | panel notice; pill in panel and next to the pointer |
| 2 | OK Filow voice, cloud (`/api/buddy/tts`) | the text of each answer | ElevenLabs | `voice` | panel notice; pill |
| 3 | OK Filow card pictures (`/api/buddy/photo`) | the name of the card's subject | Wikipedia | `photo` | panel notice; pill. A no is remembered silently (cards show without pictures) |
| 4 | OK Filow agent (`okfilow.js`, codex / claude CLI) | the task and the last answer | OpenAI (codex) or Anthropic (claude), through the CLI | desktop `agentGranted` before the CLI starts | panel notice; pill while the job runs |
| 5 | Take, cloud speech engine (`/api/stt/elevenlabs-token`, `/api/stt/openai-token`, then a WebSocket from the page) | live microphone audio | ElevenLabs or OpenAI | `audio` on the token route (no token, no stream) | take-page notice before the take starts; pill for the whole take |
| 6 | Take, Web Speech engine ("browser") | live microphone audio | the browser maker (Google for Chrome and Electron, Microsoft for Edge, Apple for Safari) | none possible (the browser sends it directly) | take-page notice before the take starts (client gate); pill for the whole take |
| 7 | Take, cloud decider (`/api/decide` with `openrouter` or `clef-cloudflare`) | the words spoken, anonymised by the PII guard | OpenRouter then the maker, or Cloudflare | `transcript` | take-page notice before the take starts; pill during each call |
| 8 | Take, Screen Sense (`/api/vision`) | pictures of the shared screen | OpenRouter, then the vision model's maker | `screen` | take-page notice at the first frame (a no stops watching); pill during each frame |
| 9 | Script editor, Translate (`/api/script/translate`) | the script text | OpenRouter, then the maker (`scriptRecipient`) | `script` | take-page notice inside the editor; pill in the editor |
| 10 | Script from slides, cloud (`/api/script/generate`) from the PowerPoint add-in and the browser extension | slide text and slide pictures | OpenRouter, then the maker | `script` | the pane's own notice before the slides are read (only when the server would write in the cloud: `defaults.generate` from `/api/buddy/recipients`); pill for the whole stream |
| 11 | PowerPoint add-in take (`/api/decide`, stt token routes, Web Speech) | spoken words, microphone audio | as rows 5 to 7 | `transcript`, `audio` (Web Speech cannot be gated by the server) | the pane's notice for the server's decider (`defaults.decide`) before the take starts; the automatic engine choice starts an engine on this PC first (`startLocalFirst`), and only when none is available or none could start offers the first cloud or browser-maker engine through the notice. A no starts nothing. Pill for the whole take and during each decide call; a yes withdrawn in the pane's list stops the take |
| 12 | Browser extension, Screen Sense (`/api/vision`) | a picture of the tab and the slide title | as row 8 | `screen` | the panel's notice at the first frame, before the tab is captured (a no turns vision off); pill during each frame |
| 13 | Public link (trycloudflare tunnel, `main.js`) | the mirror page and the session relay: script, transcript, slide state | Cloudflare (relay), and whoever opens the link | not content-gated. **On by default since 0.4.0** and started at launch without a dialog (the download of cloudflared is silent when automatic); the explaining dialog shows only when the user turns it on from the menu | only the "Public link on" chip on the take page; no notice, no per-send signal. See "Open" |
| 14 | Model router probe (`/api/local/plan` with `probe`) | a fixed sample request, no user content | OpenRouter, then the maker | none needed (no user content) | none |
| 15 | Downloads (Ollama installer, sherpa model, cloudflared, update check on GitHub) | no user content (the request itself only) | ollama.com, github.com | none needed | the download dialogs |

Everything else stays on this PC: local Clef / Ollama decisions and answers, sherpa and whisper
speech-to-text, the system voice, OK Filow's own speech-to-text (desktop `stt.js`, local only).

Dictation (`dictation.js`, docs/okfilow/DICTATION.md) is a local path with no cloud variant at all: the
microphone goes to the phrase models in desktop `stt.js` on this PC, and the text goes to the app that
has focus through the clipboard. It works with FILOW_OFFLINE=1. On Windows the dictated text carries the
markers that keep it out of clipboard history (Win+V) and cloud clipboard sync. One thing Filow does not
control: a third-party clipboard manager may still record it for the moment of the paste. Typing in
Filow's own windows never uses the clipboard.

## Where the rules live

- `apps/web/lib/buddy/outbound.ts` (pure): kinds, recipients (`askRecipient`, `routerRecipient`,
  `sttRecipient`, `decisionRecipient`, `takeOutbound`), the consent map, the notice text and queue,
  `consentDenied` for the server, and **the one local-or-cloud decision for OK Filow
  (`askRoute`, `voiceRoute`)**. When the per-machine setup decides the screen-helper mode, point
  `askRoute` at that value and nothing else changes.
- `apps/web/lib/buddy/outboundClient.ts`: the controller shared by the panel and the take page
  (`allow`, `decide`, `sending`). `sending` is the only way a request with user content is made.
- `apps/web/lib/buddy/outboundPage.ts` + `components/usePageOutbound.ts` + `components/PageOutbound.tsx`:
  the take page's copy of it (own pill, notice as a modal, choices shared with OK Filow's settings
  through the desktop bridge, or the browser's storage when there is no desktop).
- `apps/web/lib/buddy/outboundRemote.ts` + `components/RemoteOutbound.tsx`: the same controller for
  the PowerPoint add-in and the browser extension, which cannot reach the Filow window's settings:
  they keep their own choices (the pane's localStorage, the extension's `chrome.storage`), list them
  under "What may leave this PC" in the pane, and learn from `/api/buddy/recipients` (`defaults`)
  whether the server would decide or write in the cloud. They import these files through an `@`
  alias to `apps/web` (their `vite.config.ts` and `tsconfig.json`).
- `apps/desktop/okfilow-outbound.js`: the signal state in the main process (minimum visible time,
  linger), sent to the overlay and the panel.
- `apps/web/app/okfilow/outbound-ui.tsx`, `outbound.css`: the notice, the pill, the consent list.
  The pill has its own colour (never the ink of listening, thinking or speaking), its arrow moves
  only without `prefers-reduced-motion`, and it sits in a polite live region.

## Open (owner decisions)

- Row 13: the public link is on by default and starts without asking. Script, transcript and slide
  state then pass through Cloudflare. Either make it opt-in, or show the outbound notice the first
  time it starts and the pill while it is on.
- OpenRouter hosts: pinned to the maker for Google, OpenAI and Anthropic models (see above); other
  makers (Mistral, DeepSeek, Cohere and more run some of their own models too) are not pinned yet
  because not every one of their models is served by them, and a pinned request for such a model
  fails. Adding a maker to `MAKER_HOSTS` is one line once its models are checked.
- Coding agents: the recipient is the CLI's maker (OpenAI for Codex, Anthropic for Claude Code). A
  CLI set up for Bedrock, Vertex or Azure sends elsewhere; Filow cannot see that.
- Rows 10 to 12: the add-in's and the extension's choices are their own, not the ones listed in the
  OK Filow panel (the pane cannot reach the desktop's settings). A yes given in the Filow window is
  asked again in the pane, once.
