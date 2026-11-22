# What leaves this PC, and how the user is told

The prepared Cloud Lab board displays a teacher-selected local photo. On Windows, the teacher can start a sandboxed Filow lesson window with an in-memory Electron session and approve one navigation to the displayed loopback URL. Filow serves the packaged HTML on its own loopback listener and checks a fresh instance identifier before reading the page. The local page server receives a random turn ID in the navigation referrer. The desktop observes the top-level navigation, selected temperature control and dew point in that lesson tab. A dispatch record in the Filow profile supports an explicit check after interruption. Stop or return clears the record. The board uses an installed local voice when one is available for its language.

The lesson session allows only its prepared blank page and the loopback lesson URL. Filow verifies the response instance and observes the window through Electron’s in-process debugger. A Windows packaged run at `d98ae6b1` attributed 0 non-loopback TCP/UDP payload bytes to each of 11 Filow process-tree PIDs from Prepare through Stop. Loopback payload totaled 19,951 bytes across the observed socket owners, including test traffic. Npcap captured IPv4 and IPv6 traffic and sampled Windows socket tables supplied PID attribution. Short-lived sockets between samples can escape attribution.

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
| 2 | OK Filow voice, cloud (`/api/buddy/tts`), in the panel and the whiteboard (`lib/buddy/cloudVoice.ts`, the same yes) | the text of each answer, and each sentence a whiteboard lesson says | ElevenLabs | `voice` | panel notice; pill |
| 3 | OK Filow card pictures (`/api/buddy/photo`) | the name of the card's subject | Wikipedia | `photo` | panel notice; pill. A no is remembered silently (cards show without pictures) |
| 3b | OK Filow gallery and slide pictures (`/api/buddy/photo`, `/api/buddy/media`, `lib/buddy/media.ts`) | the names of the subjects asked for (1 to 6, plus up to 3 on a slide) | Wikipedia when they are all photos (the same yes as row 3); Wikimedia (Wikipedia and Commons) when a GIF or a video is in the batch; a link the user typed goes to its own site (`link:<host>`); the user's own file and loopback links do not leave the PC | `photo` (one yes per batch, naming the one recipient) | panel notice; pill while the batch is looked up. A no is said ("Kept on this PC") |
| 4 | OK Filow agent (`okfilow.js`, codex / claude CLI) | the task and the last answer | OpenAI (codex) or Anthropic (claude), through the CLI | `agent` (desktop `agentGranted` before the CLI starts) | panel notice; pill while the job runs |
| 5 | Take, cloud speech engine (`/api/stt/elevenlabs-token`, `/api/stt/openai-token`, then a WebSocket from the page) | live microphone audio | ElevenLabs or OpenAI | `audio` on the token route (no token, no stream) | take-page notice before the take starts; pill for the whole take |
| 6 | Take, Web Speech engine ("browser") | live microphone audio | the browser maker (Google for Chrome and Electron, Microsoft for Edge, Apple for Safari) | none possible (the browser sends it directly) | take-page notice before the take starts (client gate); pill for the whole take |
| 7 | Take, cloud decider (`/api/decide` with `openrouter` or `clef-cloudflare`) | the words spoken, anonymised by the PII guard | OpenRouter then the maker, or Cloudflare | `transcript` | take-page notice before the take starts; pill during each call |
| 8 | Take, Screen Sense (`/api/vision`) | pictures of the shared screen | OpenRouter, then the vision model's maker | `screen` | take-page notice at the first frame (a no stops watching); pill during each frame |
| 9 | Script editor, Translate (`/api/script/translate`), only when the user picked "Cloud" next to the language or pressed "Use the cloud". The default, "On this PC", sends nothing (docs/TRANSLATE-LOCAL.md) | the script text | OpenRouter, then the maker (`scriptRecipient`) | `script` | take-page notice inside the editor; pill in the editor |
| 10 | Script from slides, cloud (`/api/script/generate`) from the PowerPoint add-in and the browser extension | slide text and slide pictures | OpenRouter, then the maker | `script` | the pane's own notice before the slides are read (only when the server would write in the cloud: `defaults.generate` from `/api/buddy/recipients`); pill for the whole stream |
| 11 | PowerPoint add-in take (`/api/decide`, stt token routes, Web Speech) | spoken words, microphone audio | as rows 5 to 7 | `transcript`, `audio` (Web Speech cannot be gated by the server) | the pane's notice for the server's decider (`defaults.decide`) before the take starts; the automatic engine choice starts an engine on this PC first (`startLocalFirst`), and only when none is available or none could start offers the first cloud or browser-maker engine through the notice. A no starts nothing. Pill for the whole take and during each decide call; a yes withdrawn in the pane's list stops the take |
| 12 | Browser extension, Screen Sense (`/api/vision`) | a picture of the tab and the slide title | as row 8 | `screen` | the panel's notice at the first frame, before the tab is captured (a no turns vision off); pill during each frame |
| 13 | Public link (trycloudflare tunnel, `main.js`) | mirror page and relay carrying script, transcript and slide state | Cloudflare and the paired device | LAN on launch, including upgrades. The pairing switch and desktop menu show the same Cloudflare notice on every start. Cancel is the default. If the tool is missing, Filow asks before downloading it. | "Public link" chip and pairing status. Cancel while connecting or turn it off in the panel or menu. Either closes both transports and keeps the LAN session. |
| 14 | Model router probe (`/api/local/plan` with `probe`) | a fixed sample request, no user content | OpenRouter, then the maker | none needed (no user content) | none |
| 15 | Downloads (Ollama installer, sherpa model, cloudflared, update check on GitHub) | no user content (the request itself only) | ollama.com, github.com | model and tool download choices, explicit update check | the download dialogs and update status |
| 16 | Report a problem, "Open an issue on GitHub" (`apps/desktop/about.js`, `issueUrl`, IPC `report:issue`) | what the user wrote, the Filow version, the system line and the end of the take and start-up logs, masked by `diag.redact` (public links, keys, e-mail addresses, LAN addresses, the user name in paths) and cut to a 6000-character link | GitHub (the page `github.com/stefandsl/filow/issues/new` in the user's own browser), and after the user posts it, anyone: issues are public | no server route: the only sender is the click, through `openExternalSafe`; opening the report window sends nothing | a notice right above the button, before the click, on every visit: issues are public, the text reaches GitHub as soon as the page opens, a GitHub account is needed. No stored consent: each report is its own click |
| 17 | OK Filow question, FreeLLMAPI mode (`/api/buddy/ask` with `provider: "freellm"`, `lib/freellm.ts`) | the question, screenshots, selected text and the conversation, as row 1 | the user's FreeLLMAPI router, then a free provider it picks (`freellmRecipient`, id `freellmapi`) | `ask` | panel notice; pill in panel and next to the pointer: "FreeLLMAPI (a free provider it chooses)" |
| 18 | Take, decisions through FreeLLMAPI (`/api/decide` with `freellm`) | the words spoken, anonymised by the PII guard, as row 7 | as row 17 | `transcript` | take-page notice before the take starts; pill during each call |
| 19 | Script translation and script from slides through FreeLLMAPI (`SCRIPT_CLOUD=freellm`, or `provider: "freellm"`) | the script text, slide text and slide pictures, as rows 9 and 10 | as row 17 | `script` | the same notices as rows 9 and 10, naming FreeLLMAPI; pill |
| 20 | "Check connection" in Settings > FreeLLMAPI (`/api/freellm/check`) | no user content (a model-list request with the unified key) | the user's FreeLLMAPI router only | none needed; refused in Offline mode | none |
| 21 | Account page and sign-in (`apps/desktop/account.js`, `/account`) | device sign-in code, session token, subscription status | Filow's account service (the account origin set at build time) | `account` (desktop live signal, no server gate) | notice on `/account` and the live signal |
| 22 | OK Filow "Remember things about me" (opt-in, off by default; `/api/buddy/ask` with `memory`, `/api/buddy/memory`, docs/okfilow/MEMORY.md) when the question leaves this PC (cloud, FreeLLMAPI or the user's own server) | your saved preferences (up to 5 short facts kept on this PC) with the question, and after the answer the question once more, to find new ones | the same recipient as the question (rows 1 and 17, or "your server <name>") | `memory` (second header `x-filow-consent-memory`, besides the question's `ask`) | panel notice that names "your saved preferences"; pill during the learning call. A no is remembered silently: questions go without them. On this PC nothing leaves |

Row 16 is not an OK Filow request, so it has no pill: Filow hands one link to the browser and the
browser does the sending. The link holds exactly the masked text the report window shows (shortened
when long), never the crash files. The user's own words at the top are not masked: they are the
user's to write and to read before the click.

## FreeLLMAPI

FreeLLMAPI (github.com/tashfeenahmed/freellmapi) is a router the user installs and runs on their own
PC or network; Filow never installs or bundles it. It is local, but it forwards every request to one
of about 34 providers' free tiers, chosen per request, which may keep or train on the content. So:

- It is one recipient, `freellmapi`, named "FreeLLMAPI (a free provider it chooses)" (shown in the
  window's language through `localNames`). A yes for OpenRouter never covers it, nor the reverse, and
  the notice adds that the provider is not known in advance and may keep or train on the content
  (`noticeBody`, `outFree` and `outFreeWarn`).
- It is used only where the user picked it: "Answers from" in the OK Filow panel, the takes
  switch and the scripts switch in Settings > FreeLLMAPI (a Cloud take is tracked by OpenRouter until
  the takes switch is on: `cloudProvider` in `components/Teleprompter.tsx`). Nothing selects it for them, and
  a Lite setup only points to it.
- Offline mode refuses it before anything is sent (`requireFreeLlm`), although the router is on
  localhost: the page-level offline filter lets localhost through, so the server refuses.
- The router's address is never left: a redirect is refused (`routerFetch`), and a 200 that is not a
  chat answer or a model list is a failure, not an empty success.
- A failure (router not running, wrong key, quotas used up, no model with vision) comes back with its
  own reason and next step (`FreeLlmError`); no route falls back from it to OpenRouter or anywhere else.
- The address must be http(s) on this PC or a private network address (`normalizeBaseUrl`, in the
  server and again in the desktop app before saving). The unified key is encrypted in `secrets.json`
  like the keys from `.env`, is never sent back to a page, and is masked in "Report a problem".

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

## The whiteboard's online model (owner decision, 11/11/2026)

A whiteboard lesson made online uses a model of its own, apart from OK Filow's answers. Measured
on the ten proof questions, two paid runs each, strict review: Claude Sonnet 5.5 passed 9 and 9
of 10, Gemini 2.5 Flash 6 and 6 (`docs/whiteboard/PROOF.md`). The owner chose Claude Sonnet 5.5
as the default.

- Default: `anthropic/claude-sonnet-5.5`. The user can pick `anthropic/claude-haiku-5.5` (Speed,
  added 14/11/2026: same maker, so the same yes) or `google/gemini-2.5-flash` in the
  whiteboard (when Cloud is chosen) or in Settings > Local models; the choice is kept in the
  profile. The labels say what was measured: "best measured quality", "faster, almost as good" and
  "cheaper, less reliable".
- The recipient is derived from the model, as everywhere: OpenRouter and Anthropic
  (`openrouter/anthropic`), or OpenRouter and Google. Each is its own yes. Someone who has said
  yes to Google for OK Filow is asked once for Anthropic the first time a whiteboard question is
  about to go online; before that yes nothing is sent (tested at the route).
- The server accepts only a model on the whiteboard's list (`lib/whiteboard/models.ts`); any
  other name falls back to the default, under the default's yes. `WHITEBOARD_CLOUD_MODEL`
  overrides the choice for a measured run.
- What is sent is unchanged: the question and, for a follow-up, the lesson so far. No picture.
- OK Filow's own answers keep their model (`BUDDY_CLOUD_MODEL`) and their notice.

## Online default models (owner decision, 14/11/2026)

From the paid P0 run (tmp/best-online-models/REPORT.md). Only the defaults changed: a model set in
`.env` or chosen in the whiteboard is kept. Model ids that an older `.env.example` wrote into the
profile's `.env` (`apps/desktop/env-defaults.js`) are read as unset, so the new defaults reach
existing installs; the file is not changed.

| Inventory | What | Default before | Default now | Recipient |
|------|------|----------------|-------------|-----------|
| row 1 | OK Filow screen answers (`BUDDY_CLOUD_MODEL`), 3D parts ride on it | `google/gemini-2.5-flash` | `openai/gpt-6-luna` | **OpenRouter and OpenAI** (was Google) |
| rows 7, 11 | take decisions (`OPENROUTER_DECISION_MODEL`) | `google/gemini-2.5-flash-lite` | `google/gemini-3.1-flash-lite` | OpenRouter and Google (unchanged) |
| rows 8, 12 | Screen Sense (`OPENROUTER_VISION_MODEL`) | `google/gemini-2.5-flash` | `google/gemini-3.1-flash-lite` | OpenRouter and Google (unchanged) |
| row 10 | script from slide pictures (`OPENROUTER_GENERATE_VISION_MODEL`) | `google/gemini-2.5-flash` | `google/gemini-3.1-flash-lite` | OpenRouter and Google (unchanged) |

- Row 1 changes maker. The yes is per recipient (`ask:openrouter/openai`), so a yes given to Google
  does not cover it: the first online question after the update shows the notice naming OpenAI and
  sends nothing before the yes; the server refuses it too (`consent_required`, tested in
  `app/api/buddy/consent.test.ts` and `lib/buddy/outbound.test.ts`). The pill names OpenRouter and OpenAI.
- Every new default is pinned to its maker's own hosts (`MAKER_HOSTS`: OpenAI, Google, Anthropic).
- Thinking is off or minimal for them, as P0 ran them (`reasoningFor` in `lib/openrouter.ts`).
## Names in whiteboard questions and OK Filow visuals (owner decisions)

The owner's OpenRouter account hides personal data in every prompt before a model sees it: "the
Krebs cycle" reaches the model as "the [PERSON_NAME] cycle", and the model then teaches some other
cycle. The owner keeps that filter on and asked Filow to get the topic through for whiteboard
questions only.

What Filow does, and only this:

- When the answer to a whiteboard question carries a placeholder the question did not contain, or
  never uses a proper name of the question, the same question is sent once more to the same
  recipient with that name spelled out letter by letter ("K r e b s"), followed by one line that
  tells the model a privacy filter hides names and that the letters are one word. From then on
  this profile spells the names of whiteboard questions out from the first call.
- In the answer, a name written spelled out is written normally again. Nothing else is altered.
- The page says so under the lesson, in the five languages: the account hides names, Filow spelled
  the name out, only the question was changed.
- If the spelled question is hidden too, the lesson is refused as before, with the reason and
  "Explain it on this PC".

Scope of name spelling: the text of a whiteboard question, sent under the consent already given for that
recipient. Never the user's script, the text of the screen, a screenshot, an OK Filow question or
any answer. Filow's own name masking (Rizzo-PII and the regex layer, for takes and scripts) is not
touched. The spelling is `WHITEBOARD_NAME_SPELLING` (`spaced`, `hyphen`, `dots`); which of them the
account's filter lets through is measured with `tools/whiteboard/echo.mjs`.
For OK Filow card titles and drawing labels (including 3D titles and part names), a provider
placeholder absent from the user's question is removed locally and surrounding spacing and
punctuation are tidied. Empty labels are omitted. A placeholder the user typed stays. This
also applies while an answer streams. Answer prose, card descriptions and the existing
redacted notice remain unchanged; no name is reconstructed, no question is rewritten and
no additional provider request is made for this cleanup.
This cleanup runs only when extracting OK Filow answer visuals. Shared drawing validation
preserves whiteboard sketch titles and labels, including literal tokens such as `[EMAIL]`.

Welcome, the practice workspace and the prompter lead to the same Talk or type panel. Opening it does not submit a question. The practice highlight and Save practice run locally. A spoken or typed question uses the panel’s configured route and consent.

The OpenRouter answer adapter omits the optional HTTP-Referer header so the desktop LAN address stays private. The words-only trial checks the named host, the content fields and the sending indicator against a held loopback response.

An unsuccessful OpenRouter answer returns its status without the raw provider body. The panel offers an explicit local choice or the local practice exercise. A refused microphone leaves typed questions available.

## Open (owner decisions)

- OpenRouter hosts: pinned to the maker for Google, OpenAI and Anthropic models (see above); other
  makers (Mistral, DeepSeek, Cohere and more run some of their own models too) are not pinned yet
  because not every one of their models is served by them, and a pinned request for such a model
  fails. Adding a maker to `MAKER_HOSTS` is one line once its models are checked.
- Coding agents: the recipient is the CLI's maker (OpenAI for Codex, Anthropic for Claude Code). A
  CLI set up for Bedrock, Vertex or Azure sends elsewhere; Filow cannot see that.
- Rows 10 to 12: the add-in's and the extension's choices are their own, not the ones listed in the
  OK Filow panel (the pane cannot reach the desktop's settings). A yes given in the Filow window is
  asked again in the pane, once.

The optional matching model requests missing files from Hugging Face only after you approve that download. Private practice works without it.
