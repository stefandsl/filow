# Working on Filow (for Codex, Claude Code or any coding agent)

Read `HANDOFF.md` first: it says where the project stands, what is pending and how a release is made.
`ARCHITECTURE.md` explains the engine, the session relay and the views. `README.md` / `README.it.md`
are the user manuals (English and Italian; keep both in sync when you change behaviour).

## Repository

npm workspaces monorepo, Node 22, TypeScript 5.8, scope `@filow/*`:

| Path | What |
|---|---|
| `apps/web` | Next.js 15 app: prompter UI, Settings, API routes (`/api/decide`, `/api/stt/*`, `/api/vision`, `/api/local/*`, `/api/script/generate`) |
| `apps/server` | WebSocket session relay (pairing codes, engine tokens, phone mirror) |
| `apps/desktop` | Electron 45 shell: `main.js` (servers, public-link tunnel, updater, PowerPoint install, slideshow follow), `localai.js` (Ollama), `slideshow.js`, `tunnels.js` (stale tunnel cleanup), `stt.js` + `stt-worker.js` + `stt-download.js` (speech on this PC), `tts.js` + `tts-worker.js` (natural voice), `okfilow*.js` (OK Filow screen helper), `welcome*` (first run), `about*`, `secrets.js`, `download.js`, `integrity.js`, `single-instance.js`, `splash.html`, `build/installer.nsh` (NSIS pages) |
| `apps/powerpoint` | Office.js task pane (Vite), built into `apps/web/public/powerpoint` |
| `apps/browser` | MV3 browser extension (side panel for HTML slide decks) |
| `packages/core` | Engine, prompts, parsers, `i18n.ts` (flat EN/IT dictionary, keys like `settings.*`, `model.*`) |
| `packages/ui` | Shared React views (`StageView`, `OnScreenStrip`, `Wordmark`, `BrandIcon`, `LangProvider`) |
| `packages/stt`, `packages/client` | Speech-to-text backends (ElevenLabs, OpenAI, Web Speech, on-device Whisper through transformers.js, the bridge to the desktop's sherpa model) and the session client |
| `brand/` | Brand kit; `node scripts/make-icon.js` copies icons/wordmark into every app |

## Commands

```bash
npm ci
npm run typecheck      # all workspaces
npm run lint           # eslint, no warnings allowed
npm test               # vitest (about 110 tracked *.test.* files)
npm run dev:web        # web app on :4747 (use `npx next dev -p 4799` inside apps/web when 4747 is taken by the installed app)
npm run build          # powerpoint, web (standalone), server, browser extension
npm run desktop        # build + start the Electron app from source
```

Local Windows installer builds (`npm run desktop:build:win`) usually fail on this PC at the
winCodeSign cache extraction (symlink privilege); let CI build installers (see Release below).
To syntax-check `installer.nsh` locally, compile a small Unicode harness with the cached
`makensis.exe` under `%LOCALAPPDATA%\electron-builder\Cache\nsis\` (see `HANDOFF.md`).

## Conventions

- Keep every user-facing string in `packages/core/src/i18n.ts`, English and Italian; the UI language
  toggle is `prefs:lang`, theme is `prefs:theme`.
- Desktop settings live in `%APPDATA%\@filow\desktop\settings.json`; env in `.env` next to it.
  Legacy `INTELLIPROMPTER_*` env names are aliased; do not remove the aliases.
- Spend endpoints need the engine token (`requireEngine`); pages other than the prompter get one via
  `ensureEngineToken()` in `apps/web/components/useSession.ts`.
- OpenRouter calls go through `apps/web/lib/openrouter.ts` (fallback models, 429 retry). Do not call
  the API directly from new code.
- Never commit `.env`, keys, `design/` (ignored), `release/`, `apps/web/public/powerpoint`.
- Give commits an imperative title and explain why in the body. When bumping the version,
  search for the current version (for example, `grep -rl '"0.9.30"'`) and follow the release checklist below.
- Verify before claiming done: `npm run typecheck && npm run lint && npm test`, and look at the page in a browser
  for UI work (dark and light theme).

## Release

Follow the [release checklist](docs/RELEASE-CHECKLIST.md) for version bumps, pushing main and the version tag, all three CI builds, and copying the verified source assets to the public updater feed with all three manifests.
