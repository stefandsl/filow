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
(`GET /api/buddy/recipients`), never from fixed text. OpenRouter forwards to the model's maker,
so both are named ("OpenRouter and then to Google, the maker of the model you chose").

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
| 10 | Script from slides, cloud (`/api/script/generate`) from the PowerPoint add-in and the browser extension | slide text and slide pictures | OpenRouter, then the maker | `script` | **gap**: those clients have no notice yet, so a cloud generate is refused (403) until they do. See "Open" |
| 11 | PowerPoint add-in take (`/api/decide`, stt token routes, then Web Speech) | spoken words, microphone audio | as rows 5 to 7 | `transcript`, `audio` (Web Speech cannot be gated by the server) | **gap**: no notice. The cloud decider and the ElevenLabs / OpenAI tokens are refused, so the add-in's automatic engine choice moves on to Web Speech where the browser has it (PowerPoint for the web): the microphone then goes to the browser maker with no notice and no signal. This was already so on main for every cloud engine; see "Open" |
| 12 | Browser extension, Screen Sense (`/api/vision`) | a picture of the tab | as row 8 | `screen` | **gap**: same as row 10 |
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
- `apps/desktop/okfilow-outbound.js`: the signal state in the main process (minimum visible time,
  linger), sent to the overlay and the panel.
- `apps/web/app/okfilow/outbound-ui.tsx`, `outbound.css`: the notice, the pill, the consent list.
  The pill has its own colour (never the ink of listening, thinking or speaking), its arrow moves
  only without `prefers-reduced-motion`, and it sits in a polite live region.

## Open (owner decisions)

- Row 13: the public link is on by default and starts without asking. Script, transcript and slide
  state then pass through Cloudflare. Either make it opt-in, or show the outbound notice the first
  time it starts and the pill while it is on.
- OpenRouter picks the host that serves a model (`provider: { sort: "throughput" }` in
  `lib/openrouter.ts`). For Google's Gemini models the host is Google, as the notice says; for other
  makers it can be another company (OpenAI models on Microsoft Azure, open-weight models such as
  Llama, Qwen or DeepSeek on third-party hosts). The notice names OpenRouter and the maker only.
  Either pin the host to the maker (`provider.only`), or change the sentence to "OpenRouter and the
  company it picks to run the model".
- Coding agents: the recipient is the CLI's maker (OpenAI for Codex, Anthropic for Claude Code). A
  CLI set up for Bedrock, Vertex or Azure sends elsewhere; Filow cannot see that.
- Rows 10 to 12: the PowerPoint add-in and the browser extension call gated routes but have no
  notice of their own. Until they get one (or the server learns to read the desktop's stored
  choices), their cloud paths are refused and only their local paths work. They show the server's
  refusal as it is, and it is a sentence that names the recipient and says to use Local mode
  ("Not sent: this would go to OpenRouter and Google, ...").
