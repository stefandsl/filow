# Offline fixes, 2026-11-05

Branch: `audit/baseline`. No branch switch, push, tag, release or dependency change.
Read AGENTS.md, HANDOFF.md, ARCHITECTURE.md (especially section 6.10), and
`step4-seams.md`. C: had 267,489,173,504 bytes free before work. TEMP/TMP and
npm cache were redirected under `G:/FILOW/tmp`; real-provider GAUNTLET was disabled.

Every regression below ran as ordinary `it` against unfixed production code and
failed at the stated assertion (exit 1), then passed after the production change
(exit 0). Full outputs are in [offline-fixes](offline-fixes/), named
`<ID>-before.txt` and `<ID>-after.txt`. Terminal output is retained as UTF-8 text,
with trailing display whitespace removed. Grouped bugs share their requested commit.

| ID | Commit | Test / fail-before assertion | Pass-after |
|---|---|---|---|
| B06 | b6df634 | offline translation must not upload the script to OpenRouter / `offline translation must make no cloud request`: expected no calls, got 1 | 1 passed; unavailable/disabled, zero requests |
| B07 | 9c484bb | strict PII translation must not send unguarded personal text / `strict PII must refuse cloud translation when Rizzo is unavailable`: expected length 0, got 1 | 2 passed, including regex redaction and local placeholder restoration |
| B08 | 4426f59 | offline ElevenLabs token minting must not contact the cloud / `offline token minting must make no cloud request`: expected no calls, got 1 | 2 token cases passed; unavailable/disabled |
| B09 | 4426f59 | offline OpenAI token minting must not contact the cloud / same assertion, got 1 OpenAI request | Same grouped run |
| B10 | db79ff1 | profile env offline must survive desktop startup / `startup must retain FILOW_OFFLINE=1 loaded from profile`: expected '1', got '' | 3 passed, including process/legacy env and explicit off toggle |
| B11 | a8200a2 | enabling offline must stop an already running public tunnel / `offline transition must stop existing cloudflared transport`: expected 1 kill, got 0 | 1 passed; process list and public URL cleared |
| B12 | 32c7dc9 | offline must block the desktop STT model downloader / `offline must not enter the network model downloader`: expected no calls, got 1 | 2 download cases passed; explicit localized error status |
| B13 | 32c7dc9 | offline must block the Ollama installer downloader / `offline must not enter the network installer`: expected no calls, got 1 | Same grouped run |
| B14 | 05e2c4e | offline report must not place take log text in an external browser URL / `offline report must not hand private log text to an external URL`: expected no calls, got 1 | 2 passed; copy preserves report, cancel preserves clipboard |
| B15 | d21f834 | offline local status must not probe a remote PII server / `offline status must not contact the remote PII sidecar`: expected length 0, got 1 | 1 passed; sidecar health probe skipped |

Each fix commit includes the affected seam test and its before/after outputs.
Production files: B06/B07 `apps/web/app/api/script/translate/route.ts`;
B08/B09 both `apps/web/app/api/stt/*-token/route.ts`; B10/B11
`apps/desktop/main.js`; B12/B13/B14 `apps/desktop/main.js` and
`packages/core/src/i18n.ts`; B15 `apps/web/app/api/local/status/route.ts`.
Final evidence/documentation commit also adds passing route controls, synchronizes
README.md/README.it.md and updates HANDOFF.md.

## Remaining server route scan

`rg` was unavailable; used `git grep` across tracked apps/web for `fetch(`,
`openRouterChat`, HTTP URLs and HTTP client entry points, then followed each server caller.
Renderer relative-URL requests are distinguished from server-side provider calls.

| Route / call path | Offline result |
|---|---|
| `/api/script/generate` -> generate providers | Fine with local Ollama: forces `/api/chat`, including images; PII/cloud path skipped. Added control proves a missing local provider returns an error without cloud fallback. |
| `/api/import` -> import/parse | Fine: text parsed in process; PPTX/DOCX use local ZIP/XML; PDF uses local unpdf bytes, scanned pages produce warnings, no cloud OCR. Added multipart Markdown route control; other formats source-reviewed. |
| `/api/local/pull` POST/DELETE | Fine under the requested local-Ollama exception: only configured `/api/pull` or `/api/delete`; existing offline test preserved. Daemon downloads are outside Filow's HTTP boundary. |
| `/api/local/status` | Fixed B15: skipped PII probe; version/tags still local Ollama. |
| `/api/local/plan` | Fine: version/tags and optional Clef probe local; OpenRouter probe explicitly excluded offline. Added probe=true control with cloud key present. |
| `/api/local/test`, `/api/local/warmup`, `/api/local/unload`, `/api/local/resources` | Fine with local Ollama: System One, generate/unload, or ps; system metrics use local OS calls. |
| `/api/decide` | Fine: forces local Clef even for explicit OpenRouter or Cloudflare selection; bypasses PII sidecar. Both overrides covered. |
| `/api/vision` | Fine: unavailable/disabled before provider/PII calls; existing control retained. |
| `/api/script/translate`, cloud STT token routes | Fixed B06-B09 above. |
| `/api/script`, `/api/stt/status` | No outbound fetch. |
| OpenRouter helper / Cloudflare helper / PII analyze | Reached only via online branches in this scan; no other server route callers found. |

Local means the configured loopback Ollama in these tests (`http://127.0.0.1:11434`),
as allowed in the task. Existing explicit-remote-Ollama characterization is retained:
setting OLLAMA_URL to a remote server still sends there. This is not a new host allowlist.
Selecting only the decision provider locally does not enable FILOW_OFFLINE for other
capabilities; the existing characterization of that distinction is retained.

## Verification and limits

| Command | Exit | Result |
|---|---|---|
| Targeted ordinary regressions before each fix | 1, intentional | Every assertion above reproduced; no fixture exceptions used as evidence |
| Targeted regressions after each fix | 0 | All ten regression cases fixed |
| Additional route controls | 0 | 5 passed (generation success/failure, import, plan, Cloudflare override) |
| `npm.cmd test` | 0 | 43 files passed / 1 skipped; 277 passed, 5 expected failures, 1 skipped (283 total) |
| `npm.cmd run typecheck` | 0 | All six checks passed: root/core, web, server, PowerPoint, browser, desktop |

`full-test.txt` and `typecheck.txt` record the full checks before the final evidence
commit. Both required commands are also rerun after all commits; final rerun output
is kept in `tmp/offline-final-test.txt` and `tmp/offline-final-typecheck.txt`.

Phone-sync and Sherpa-stop it.fails are unchanged. New tests mock all fetches, desktop
filesystem/network/Electron, and GPU discovery; they do not transmit synthetic text.
No real microphone, models, paid providers, cloudflared process, native dialogs or
clipboard, native renderer filtering, packaged build, packet capture, or in-flight
request/updater/download cancellation was verified. No web page layout changed.
The remaining opt-in provider gauntlet is skipped.

PowerShell blocks script files: npm.cmd was used, and the local test runner was
evaluated as a script block without changing execution policy. Initial unprivileged
git staging failed on `.git/index.lock`; scoped elevated staging/commits succeeded.
An external memory hook appended to AGENTS.md during work; that change is left
untouched and unstaged, as requested. Existing untracked tmp contents are preserved.
