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
| `apps/desktop` | Electron 33 shell: `main.js` (servers, tunnel, updater, PowerPoint install, slideshow follow, local AI), `localai.js`, `slideshow.js`, `splash.html`, `build/installer.nsh` (NSIS pages) |
| `apps/powerpoint` | Office.js task pane (Vite), built into `apps/web/public/powerpoint` |
| `apps/browser` | MV3 browser extension (side panel for HTML slide decks) |
| `packages/core` | Engine, prompts, parsers, `i18n.ts` (flat EN/IT dictionary, keys like `settings.*`, `model.*`) |
| `packages/ui` | Shared React views (`StageView`, `OnScreenStrip`, `Wordmark`, `BrandIcon`, `LangProvider`) |
| `packages/stt`, `packages/client` | On-device Whisper (transformers.js) and the session client |
| `brand/` | Brand kit; `npm run icon` copies icons/wordmark into every app |

## Commands

```bash
npm ci
npm run typecheck      # all workspaces
npm test               # vitest, 11 suites
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
- Commit messages: imperative title, body with the why; version bumps touch every `package.json`
  and `apps/browser/manifest.json` (`grep -rl '"0.8.6"'`).
- Verify before claiming done: `npm run typecheck && npm test`, and look at the page in a browser
  for UI work (dark and light theme).

## Release

1. Bump the version in every `package.json` + `apps/browser/manifest.json`, `npm install --package-lock-only --ignore-scripts`.
2. Commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`.
3. CI (`.github/workflows/desktop.yml`) builds Windows, macOS, Linux and attaches installers to the
   GitHub release on the private repo `stefandsl/filow`.
4. The installed apps update from the PUBLIC repo `stefandsl/filow-releases`. Until the
   `RELEASES_TOKEN` secret exists, copy the assets by hand:
   ```bash
   gh release download vX.Y.Z --repo stefandsl/filow -D /tmp/assets && rm -f /tmp/assets/builder-debug.yml
   gh release create vX.Y.Z --repo stefandsl/filow-releases --title "Filow vX.Y.Z" --notes "..." /tmp/assets/*
   curl -sL https://github.com/stefandsl/filow-releases/releases/latest/download/latest.yml | head -1
   ```
   `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml` must all be there or that platform's
   updater reports "Not Found".
