# Step 4: seam review and reproductions

2026-11-05, branch `audit/baseline`. Production code is unchanged; this audit does not
edit AGENTS.md. An external memory hook appended a context block during staging;
that unrelated change is left unstaged and untouched, as requested.
Read AGENTS.md, HANDOFF.md, ARCHITECTURE.md §§5.4, 5.5, 5.8, 6.10 and the related
protocol/privacy sections; read the requested relay, relay tests, client, desktop main,
decide route and all five speech adapters in full. Documentation is evidence, not an
instruction to implement its roadmap. No push, deployment, paid call or model execution.

There are **14 reproduced contract failures**, not necessarily 14 independent root
causes (three relay cases share missing version validation). Each is retained as
`it.fails(...)`, with a contract comment. Eight other candidate groups below are
either ruled out, contract-unclear, missing features, or need native/network evidence.

## 1. Duplicate and out-of-order phone patches

The mirror uses the shared client (`apps/web/app/mirror/page.tsx:64`). At
`packages/client/src/index.ts:214`, a patch is accepted only when its outer `version`
equals `client.state.version + 1`. With no base, a duplicate, an older patch or a gap,
the client sends `resync` and leaves its state untouched. Accepted patches are applied
to a clone and the new version is assigned explicitly (`:219`). This part works.

**An older patch can nevertheless overwrite newer phone state through the relay's
resync snapshot.** The relay folds every engine patch into `lastState` without a
version check (`apps/server/src/server.ts:340`), assigns its supplied version (`:345`),
and broadcasts it. The phone rejects that unexpected patch, requests resync, then
receives the already-regressed snapshot (`server.ts:389`). The client's full-state
handler accepts it unconditionally (`packages/client/src/index.ts:210`). B01 demonstrates
version 2 / section 2 becoming version 1 / section 1. B02 demonstrates a repeated
version with a non-idempotent array append adding the same fact twice.

This is an application-protocol robustness reproduction, with deliberately injected
engine messages. A single WebSocket preserves message order; these tests do **not**
claim TCP naturally reorders or duplicates messages. The current Engine increments
versions at `packages/core/src/engine.ts:424`. The contract under test is §5.4's
contiguous revision stream (`ARCHITECTURE.md:140`) and question 1's rollback safety.

Full snapshots have no stale-state/epoch check on either side (`server.ts:336`,
`client/src/index.ts:210`). Accepting a lower full-state version also permits a fresh
engine's version reset; treating *all* lower full snapshots as invalid would break
that use case. No separate bug is claimed for the absence of an epoch protocol.

## 2. Reconnect and convergence

**Phone-only transport reconnect works while the relay session survives.** `connect`
reuses the token and reconnects after 500 ms, backing off to 8 seconds
(`packages/client/src/index.ts:270`). The relay replays its folded full snapshot on
view hello (`apps/server/src/server.ts:330`). The test disconnects the phone, applies
two engine patches and verifies version 2 / section 2 on reconnect. Missed phone
patches do not need replay individually.

**Engine reconnect does not guarantee convergence.** `publishState` and `publishPatch`
drop sends while the socket is not open (`packages/client/src/index.ts:126`). On
welcome, the client only updates connection status and resolves its open promise
(`:192`); it does not resend state or invoke the engine's resync callback. The actual
web hook sends its initial full state once, registers `onResync`, then publishes
changes (`apps/web/components/useSession.ts:125`). Its `onStatus` only updates the UI
(`:113`). B03 executes that hook with fake React lifecycle and transports: state
changes during disconnection, but no full snapshot is sent after reconnection.

A later engine patch can skip versions. The relay applies it anyway (B04), so a phone
resync can return a snapshot with the latest version but missing older changes to
unrelated fields. Eventual full publication happens when an update has more than 40
ops or a version divisible by 50 (`useSession.ts:128`), or a patch cannot be applied
and the relay asks the engine to resync (`server.ts:348`). None guarantees immediate
convergence if the engine becomes idle or subsequent patches remain applicable.

The Engine starts at version 0 (`packages/core/src/engine.ts:86`); ordinary start/stop
and script load continue the monotonic update sequence (`:125`, `:283`, `:295`, `:424`).
Welcome's version is not used to reset the client. A full snapshot replaces its
version, including a reset to zero; this is covered by a positive test.

Session expiry is separate: the relay keeps state in a closure-local Map (`server.ts:91`),
expires sessions at 2 h disconnected / 12 h absolute (`:143`), and rejects an unknown
session upgrade (`:264`). There is no implemented crash-recreation/resume handshake;
§10's relay-crash recovery is broader than the implementation. That missing feature
is not counted as a reproduced bug here. App restarts are explicitly non-resumable
in §5.3 (`ARCHITECTURE.md:108`).

## 3. Stop during an utterance

The take UI calls backend `stop()` before `engine.stop()`
(`apps/web/components/Teleprompter.tsx:197`). The `SttBackend` interface has a synchronous
`stop(): void` and no drain/finalization acknowledgement (`packages/stt/src/types.ts:25`).
The Engine stops its decision interval and invalidates in-flight decisions
(`packages/core/src/engine.ts:295`); it does not flush a recognizer. `feed()` still
accepts text while stopped (`:141`). Ordinary Stop does not cancel the startup attempt
identity; the transcript callback checks that identity, not recording state
(`Teleprompter.tsx:321`, compare Cancel at `:353`). Consequently a queued backend event
can still change the transcript after Stop. It does not restart the decision interval.

| Adapter | Stop behavior and evidence | Fake-only result |
|---|---|---|
| Browser | Calls `abort()`, not recognizer `stop()` (`packages/stt/src/browser.ts:84`). `onresult` has no running check (`:49`). | Abort called; a simulated already-queued final event still reaches the handler. No claim that a real recognizer emits that event after abort. |
| ElevenLabs | Stops microphone and closes WS without a final `commit:true` (`packages/stt/src/elevenlabs.ts:119`; chunks always use `commit:false` at `:109`). `onmessage` remains attached (`:45`). | Audio chunk sent to fake socket; Stop sends no commit; queued final text is delivered. Real provider close/VAD finalization is unverified. |
| OpenAI | Periodic commit every 4 s (`packages/stt/src/openai.ts:87`), but Stop clears timer and closes without committing remainder (`:96`). Message handler remains (`:53`). | With 1 s of buffered PCM, no final commit; queued completed event still delivers. Real close semantics unverified. |
| Whisper | Stops timer and mic, terminates worker, clears PCM and pending map (`packages/stt/src/whisper.ts:86`). | One submitted recognition plus a second buffered chunk: only the first is posted, worker terminated, no final text. No final flush occurs. |
| Sherpa | Removes result subscription **before** bridge stop (`packages/stt/src/sherpa.ts:52`). Main relays stop (`apps/desktop/main.js:1195`); worker explicitly flushes and emits committed text (`apps/desktop/stt-worker.js:70`). | B05 runs the real worker protocol with a fake recognizer. `inputFinished()` and final emission happen, but the take handler receives zero calls. |

Already delivered partial text is not necessarily lost: Engine stop does not erase
the transcript. The losses above concern unrecognized buffered audio, in-flight
recognition, and the final commitment/correction. Sherpa's implemented flush contract
is demonstrably broken at the subscription seam. A universal graceful-stop guarantee
for the other four adapters is not specified; their behavior is characterized in
passing tests, not labelled as four missing-feature bugs.

## 4. Offline and local-provider egress

**Offline mode is not a complete no-egress boundary. A local provider selection is
also not a global offline switch.** The following distinguishes content, configuration
traffic and downloads. New API tests replace *all* fetch calls, use fake keys, and
exercise the real routes/providers/PII guard. Authentication is allowed with the
documented no-password configuration; no authorization bypass is claimed.

| Path | Offline / local handling | What can leave |
|---|---|---|
| Decide | `apps/web/app/api/decide/route.ts:21` forces `clef-local` offline. `:39` bypasses guard for local, otherwise uses guard unless off. Positive tests cover forced-local, explicit-local, strict failure and regex fallback. | Local call posts raw request to configured `OLLAMA_URL` (`apps/web/lib/decide/clef.ts:3`, `:12`), default loopback. There is no hostname enforcement. Cloud providers post guarded text to OpenRouter / Workers AI (`decide/openrouter.ts:12`, `decide/clef.ts:62`). |
| Screen Sense / vision | `apps/web/app/api/vision/route.ts:26` returns disabled offline, before guard/provider. The hook posts frame plus point context to this route (`apps/web/components/useScreenSense.ts:86`, `:105`). Hotkey/capture paths also end here. | With only local **decision** selected, vision still uses OpenRouter (`vision/route.ts:41`). Text is guarded; image is explicitly not anonymized (`:11`). Local vision is a known missing feature (`HANDOFF.md:479`), not a bug. |
| STT token routes | Engine auth exists, offline checks do not (`apps/web/app/api/stt/elevenlabs-token/route.ts:5`, `openai-token/route.ts:5`). B08/B09. Status reports configured keys without offline filtering (`stt/status/route.ts:5`). | Token requests send credentials and, for OpenAI, transcription configuration. They do **not** upload captured audio. They can enable later browser audio upload. |
| STT audio | PCM goes directly from page to cloud WS (`packages/stt/src/elevenlabs.ts:31`, `:105`; `openai.ts:25`, `:84`), with no PII layer. `availableBackends(...offline)` offers only local adapters (`stt/src/index.ts:67`). | That availability list is not an adapter-level enforcement boundary. `Teleprompter.tsx:299` honors explicit stored `choice`; local mode changes the automatic choice at `:301`, not every explicit choice. The web deployment has no Electron request filter. Browser Web Speech is also classified as cloud (§6.10). Actual microphone egress, stored-choice UI combinations and already-open WS behavior remain native/browser verification items. |
| Translate | `apps/web/app/api/script/translate/route.ts:42` always calls OpenRouter; `:47` sends raw script. It checks neither offline/local provider nor PII mode. | Raw script text can leave even with `FILOW_OFFLINE=1` (B06), or strict PII (B07). The wrapper at `apps/web/lib/openrouter.ts:20` has no independent offline/PII guard. |
| Generate | `apps/web/lib/generate/providers.ts:73` forces Ollama offline; otherwise request choice, env, then local-decision env implication. Guard only for cloud (`apps/web/app/api/script/generate/route.ts:41`). | Local posts slide text and optional images to configured Ollama (`generate/providers.ts:43`). Cloud anonymizes title/text/notes (`generate/route.ts:55`) but sends eligible images unchanged. Browser decision localStorage is not the server's `DECISION_PROVIDER`; Auto can set generation env separately (`api/local/plan/route.ts:83`). No global local-only guarantee from a decision preference. |
| PII sidecar | `apps/web/lib/pii/guard.ts:16` is configurable, default loopback. Health check precedes raw-text `/analyze` (`:131`, `:79`), then regex; strict throws on unavailable/failure (`:152`, `:159`). | A remote configured sidecar sees original text before regex. Local decide/generate skip it; offline vision exits first. Local status still probes its health (`api/local/status/route.ts:34`), metadata only. Translation bypass is B07. No blanket guarantee of PII removal from images/audio. |
| Auto planning / local management | Offline excludes OpenRouter probe (`apps/web/app/api/local/plan/route.ts:70`); probe text is a fixed sample (`:12`), not the user's transcript. Inventory/status/resources/warmup/unload use configured Ollama. | `/api/local/pull` still posts model name to Ollama offline (`api/local/pull/route.ts:15`); whether the daemon then downloads requires the actual daemon. No user audio/text is in that pull. |
| On-device worker models | Whisper and embedding inference are local (`packages/stt/src/whisper.worker.ts:54`, `apps/web/lib/gate/embed.worker.ts:48`). Workers enable browser cache and remote model loading (`whisper.worker.ts:6`, `gate/embed.worker.ts:6`); WASM runtime comes from `/ort/`. | Cold caches can require model downloads. Electron blocks new external renderer requests while offline; a web server env variable alone does not install that browser filter. Download/cache behavior is not evidence that audio or embedded text is uploaded. |

### Desktop networking, diagnostics and updates

`apps/desktop/main.js` contains no direct `fetch()` call. Its network and external
handoff paths are:

* **Renderer filter:** `applyOffline` sets `process.env.FILOW_OFFLINE` and registers
  `session.defaultSession.webRequest.onBeforeRequest` (`main.js:1398`). It allows
  localhost, 127.0.0.1, its literal IPv6 check, and `FILOW_LAN_IP` (`:1411`), not Node
  requests or external processes. A positive VM test verifies a new cloud renderer
  URL is blocked and loopback is allowed. The menu is at `:1480`; preload and the
  page receive offline state (`apps/desktop/preload.js:44`, `Teleprompter.tsx:113`).
* **Profile `.env` trap:** `offline` is initialized at module evaluation (`main.js:1397`),
  before `main()` loads `.env` and aliases legacy variables (`:1566`). Later
  `applyOffline(win, offline)` (`:1610`) writes the stale boolean back into the env.
  B10 reproduces `.env` value `1` being cleared. An OS-process `FILOW_OFFLINE=1`
  before module evaluation works in the positive test. This also affects legacy
  offline env loaded/aliased late.
* **Cloudflared:** HTTPS downloader at `:608` follows redirects and obtains official
  GitHub assets (`:634`). Child tunnels start at `:664`, with `--no-autoupdate`.
  `setRemoteShare` checks offline before starting (`:723`), as does startup (`:1646`).
  However `applyOffline` never invokes `stopTunnels` (`:691`): existing child
  processes and published URLs survive the toggle (B11). They carry mirror/session
  traffic, including script/transcript state sent to paired views. The reproduction
  proves the lifecycle omission; it does not execute cloudflared or measure packets.
* **STT download / Ollama install:** IPC and startup enter `sttDownload` (`:1161`,
  `:1176`) and `startOllamaInstall` (`:1215`, `:1640`) without offline checks. B12/B13
  execute the real `stt.js` / `localai.js` orchestration with absent models/installation,
  fake files and an HTTPS spy. Calls reach GitHub (`apps/desktop/stt.js:36`) and
  `ollama.com/download/OllamaSetup.exe` (`localai.js:205`) while offline. These are
  binary downloads, not transcript/audio uploads. Linux install only offers a shell
  command (`localai.js:197`); that branch was read, not executed.
* **Proxy / readiness:** `http.request` at `main.js:897` and `net.connect` at `:909`
  forward to loopback servers. `http.get` in `waitFor` (`:1378`) is called for local
  API/relay readiness at `:1628`. These do not directly send content to external hosts.
  The local HTTP API can still dispatch an external Node provider call, e.g. translation.
* **Updates:** `checkForUpdates` refuses offline before loading/invoking updater
  (`main.js:1056`), covered by a passing fake. Automatic check is scheduled at `:1671`;
  updates automatically download when found (`:996`). Offline toggling does not
  explicitly cancel an in-flight updater operation. Actual Electron updater transport
  and cancellation require native/network verification; no bug is claimed for that
  untested race. Selecting a local provider alone does not disable update checks.
* **Diagnostics / telemetry:** no application telemetry/analytics sender was found
  in the reviewed source or tracked app search. Crash handlers append local logs
  (`main.js:1078`, `:1421`). Reporting is user-triggered (`:1430`, `:1546`), consistent
  with `HANDOFF.md:312`, but `reportProblem` embeds take/startup logs in the GitHub
  query URL and hands it to the external browser regardless of offline (`:1461`,
  `:1463`), B14. Navigating that URL transmits query text before issue submission;
  the fake proves the URL handoff, not successful delivery. Generic new-window links
  also go to `shell.openExternal` without offline checks (`:1622`). No automatic
  transcript telemetry is claimed; dependency-internal/runtime traffic was not
  packet-audited.

## Candidate table

`B` = reproduced contract failure; `C` = not established as a bug. Question numbers
refer to the requested Step 4 audit. Expected behavior is scoped to the stated contract.

| ID | File:line | Contract source | Trigger | Expected versus observed | Result |
|---|---|---|---|---|---|
| B01 | `apps/server/src/server.ts:344`; `packages/client/src/index.ts:210` | §5.4 `ARCHITECTURE.md:140`, `:145`; Q1 | Engine sends v1 after phone accepted v2 | Preserve newer state; relay folds v1 and phone resync installs section 1 | `it.fails` |
| B02 | `apps/server/src/server.ts:344` | Same; Q1 | Duplicate v1 array append | One application per version; resync contains two copies | `it.fails` |
| B03 | `apps/web/components/useSession.ts:113`; `packages/client/src/index.ts:192` | §5.4 `ARCHITECTURE.md:151`, §10 `:405`; Q2 | Engine changes state while disconnected, then welcomes again | Fresh full state; only hello is sent on reconnect | `it.fails` |
| B04 | `apps/server/src/server.ts:343` | §5.4 contiguous versions (`ARCHITECTURE.md:140`); Q2 | Relay gets v2 after v0 | Recover missing base from engine; applies patch without requesting resync | `it.fails` |
| B05 | `packages/stt/src/sherpa.ts:55` | Worker comment `apps/desktop/stt-worker.js:71`; Q3 | Stop mid-utterance | Deliver worker's flushed commitment; adapter listener already removed | `it.fails` |
| B06 | `apps/web/app/api/script/translate/route.ts:42` | §6.10 `ARCHITECTURE.md:337`; Q4 | Translate with offline flag and fake key | No cloud script upload; raw script goes to OpenRouter fetch | `it.fails` |
| B07 | `apps/web/app/api/script/translate/route.ts:42` | §6.10 `ARCHITECTURE.md:320`, `:339`; `pii/guard.ts:1`; Q4 | Translate with strict PII, unavailable Rizzo | Refuse cloud unguarded text; raw personal text sent without guard | `it.fails` |
| B08 | `apps/web/app/api/stt/elevenlabs-token/route.ts:11` | §6.10; `main.js:101` no outbound; Q4 | Mint token offline | No cloud request; ElevenLabs called | `it.fails` |
| B09 | `apps/web/app/api/stt/openai-token/route.ts:11` | Same | Mint token offline | No cloud request; OpenAI called | `it.fails` |
| B10 | `apps/desktop/main.js:1397`, `:1610` | §6.10 env offline; main.js `.env` config comment `:2`; Q4 | Offline set only in profile `.env` | Retain offline; startup writes empty string over `1` | `it.fails` |
| B11 | `apps/desktop/main.js:1398` | Menu no outbound `main.js:101`; §6.10; Q4 | Enable offline with active tunnel | Stop existing outbound child transport; kill not called | `it.fails` |
| B12 | `apps/desktop/main.js:1161`; `apps/desktop/stt.js:36` | Menu no outbound `main.js:101`; Q4 | Download missing STT model offline | No external GET; GitHub downloader entered | `it.fails` |
| B13 | `apps/desktop/main.js:1215`; `apps/desktop/localai.js:205` | Same | Install absent Ollama offline (Windows) | No external GET; Ollama installer download entered | `it.fails` |
| B14 | `apps/desktop/main.js:1463` | Menu no outbound `main.js:101`; Q4 text egress | User requests problem report offline | Preserve offline boundary; log-bearing external URL handed to browser | `it.fails` |
| C01 | `packages/client/src/index.ts:215` | §5.4; Q1 | Unexpected patch delivered directly to phone | Expected refusal/resync; observed refusal/resync | Ruled out in positive test; B01/B02 concern relay snapshots instead |
| C02 | `apps/server/src/server.ts:330` | §5.4; Q2 | Phone-only reconnect after missed patches | Expected current full snapshot; observed v2 state | Ruled out in positive test |
| C03 | `packages/stt/src/browser.ts:84`, `elevenlabs.ts:119`, `openai.ts:96`, `whisper.ts:86` | Q3; no drain guarantee in `types.ts:25` | Stop before final recognition / deliver already-queued result | Desired flush/no late callbacks versus immediate abort/close/terminate and surviving handlers | Behavior reproduced in four passing characterizations; bug contract unclear, real final-word outcomes need recognizers |
| C04 | `apps/web/app/api/vision/route.ts:41`; `Teleprompter.tsx:299`; `generate/providers.ts:78` | Q4; §6.10 per-capability providers; `HANDOFF.md:479` planned local vision | Only decision provider selected local | A global-local interpretation would prohibit cloud; vision/translation remain cloud and explicit STT may remain cloud | Route behavior characterized; global contract unclear and local vision missing feature, not a bug |
| C05 | `apps/web/lib/decide/clef.ts:3`; `apps/web/lib/pii/guard.ts:16` | Q4; §6.10 configurable server URLs | Configure external Ollama or Rizzo | Device-only interpretation versus configured service destination | Remote Ollama raw-text call characterized; approved topology/trust contract unclear, remote Rizzo actual reachability untested |
| C06 | `apps/desktop/main.js:1398`, `:996`; `packages/stt/src/elevenlabs.ts:105` | Q4 | Toggle offline during existing cloud WS, provider request or update | Desired immediate cancellation versus only new-request filtering/provider selection | Needs real Chromium/updater/network; fake filter validates new requests only, no packet claim |
| C07 | `apps/web/app/api/local/pull/route.ts:15`; `packages/stt/src/whisper.worker.ts:6`; `apps/web/lib/gate/embed.worker.ts:6` | Q4; §6.10 downloading local models | Pull model / cold browser cache offline | Strict no-download interpretation versus local-daemon pull/remote cache fill | Local pull characterized; daemon/cache network effects need runtime/network and download exception contract unclear |
| C08 | `apps/server/src/server.ts:91`, `:264` | §10 `ARCHITECTURE.md:406`; §5.3 `:108`; Q2 | Relay process restart loses in-memory session | Draft describes recovery; no recreate protocol exists | Positive characterization creates a fresh in-process relay and confirms prior code returns 404; missing feature, not claimed bug; no real process-crash recovery test |

## Reproduced tests and failing assertions

The names below are the exact test titles. For token tests the title is parameterized
at one source line. Failure text is the assertion message plus observed mismatch;
verbose argument dumps from Vitest are omitted. Every failure was checked in an
ordinary-test run against **unchanged production code**, then restored to `it.fails`.

| ID | Test and location | Failing assertion text / observed mismatch |
|---|---|---|
| B01 | `stale relay patch must not roll the phone back through resync` — `apps/server/src/seams.test.ts:99` | `stale patch must preserve section 2: expected 1 to be 2` |
| B02 | `duplicate non-idempotent patch must not be applied twice by relay` — `apps/server/src/seams.test.ts:106` | `one version must append the fact once: expected [ 'one fact', 'one fact' ] to deeply equal [ 'one fact' ]` |
| B03 | `engine reconnect must resend state changed while disconnected` — `apps/server/src/seams.test.ts:121` | `reconnect must publish the current transcript without waiting for another change: expected undefined to be 'missed during disconnect'` |
| B04 | `relay must request full state when engine skips a patch version` — `apps/server/src/seams.test.ts:134` | `relay must request the missing base instead of blessing an incomplete snapshot: expected "vi.fn()" to be called once, but got 0 times` |
| B05 | `Sherpa stop must deliver the worker's final committed utterance` — `packages/stt/src/stop.seams.test.ts:36` | `worker flush must reach the take before the result subscription is removed: expected "vi.fn()" to be called with arguments` `{ committed: "last utterance ", partial: "" }`; `Number of calls: 0` |
| B06 | `offline translation must not upload the script to OpenRouter` — `apps/web/app/api/seams.test.ts:45` | `offline translation must make no cloud request: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| B07 | `strict PII translation must not send unguarded personal text` — `apps/web/app/api/seams.test.ts:51` | `strict PII must refuse cloud translation when Rizzo is unavailable: expected [ [ …(2) ] ] to have a length of +0 but got 1` |
| B08 | `offline ElevenLabs token minting must not contact the cloud` — `apps/web/app/api/seams.test.ts:59` | `offline token minting must make no cloud request: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| B09 | `offline OpenAI token minting must not contact the cloud` — `apps/web/app/api/seams.test.ts:59` | Same assertion, one OpenAI call |
| B10 | `profile env offline must survive desktop startup` — `apps/desktop/main.seams.test.ts:63` | `startup must retain FILOW_OFFLINE=1 loaded from profile: expected '' to be '1'` |
| B11 | `enabling offline must stop an already running public tunnel` — `apps/desktop/main.seams.test.ts:71` | `offline transition must stop existing cloudflared transport: expected "vi.fn()" to be called once, but got 0 times` |
| B12 | `offline must block the desktop STT model downloader` — `apps/desktop/main.seams.test.ts:78` | `offline must not enter the network model downloader: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| B13 | `offline must block the Ollama installer downloader` — `apps/desktop/main.seams.test.ts:83` | `offline must not enter the network installer: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| B14 | `offline report must not place take log text in an external browser URL` — `apps/desktop/main.seams.test.ts:88` | `offline report must not hand private log text to an external URL: expected "vi.fn()" to not be called at all, but actually been called 1 times` |

## Verification and limits

New tests use real relay/client/engine-hook logic with EventEmitter transports and
fake timers; no sockets are opened by the new relay tests. Desktop tests evaluate
the complete original CommonJS source in VM contexts with startup held, fake Electron,
filesystem and network. Download tests execute the original download orchestration;
retry delay mechanics are stubbed to one attempt. The Sherpa test executes the real
worker stop handler with a fake recognizer. Other adapters use fake PCM, sockets and
workers. No private user data or real credentials are used.

`it.fails` can otherwise hide an unexpected exception, so the audit temporarily
changed only those test markers to `it`, ran the four files, inspected every failure,
and restored the files in `finally`. The diagnostic JSON is an uncommitted artifact
at `tmp/step4-failures.json`. Production code was never changed for this check.

Commands run with `TEMP=TMP=G:\FILOW\tmp`, npm cache under that directory, and
`GAUNTLET=0`. C: free space was checked before work: 267,485,999,104 bytes (above 20 GB).
`rg` was unavailable; subsequent searches used `git grep` / PowerShell. npm.cmd was
used without changing PowerShell policy.

| Command | Exit | Result |
|---|---:|---|
| Initial targeted `npm.cmd test -- apps/server/src/seams.test.ts packages/stt/src/stop.seams.test.ts apps/web/app/api/seams.test.ts apps/desktop/main.seams.test.ts` | 0 | 4 files; 12 passed + 14 expected failures (26), before additional controls |
| Ordinary-marker diagnostic, same four paths plus `--reporter=json --outputFile=tmp/step4-failures.json` | 1, intentional | 15 passed, 14 assertion failures (29); all matched the claimed reason, no fixture errors |
| `npm.cmd run typecheck` (initial and pre-report rerun) | 0 | All six checks passed: root/core, web, server, PowerPoint, browser, desktop welcome |
| `npm.cmd test` (pre-report) | 0 | 43 files passed / 1 skipped; 258 passed, 14 expected failures, 1 existing opt-in skip (273) |
| `npm.cmd test` (final) | 0 | 43 files passed / 1 skipped; **260 passed, 14 expected failures, 1 existing opt-in skip (275)** |
| `npm.cmd run typecheck` (final) | 0 | **All six checks passed** |

The final test set adds 31 cases: 17 positive/characterization cases and 14 expected
failures. No UI or production behavior was edited, so no visual acceptance is claimed.
Real phone reconnection/backgrounding, microphone timing, vendor VAD/close behavior,
native Sherpa accuracy, native Electron request interception, cloudflared traffic,
updater cancellation, remote service trust and dependency-level telemetry were not
verified. Existing suite tests may use loopback servers/closed-port sidecar probes;
the new reproductions are entirely in-process. The opt-in real-provider gauntlet is
disabled. Existing untracked `tmp/` contents were left alone and are not committed.
`git diff --cached --check` passed (exit 0). Initial unprivileged staging failed
(exit 1: `.git/index.lock` permission denied); explicitly scoped staging succeeded
with sandbox escalation (exit 0). No file permission or repository settings changed.
