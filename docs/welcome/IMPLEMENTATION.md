# Welcome implementation and verification — 2026-11-03

Implemented the product contract in SPEC.md using `welcomeCompleted`, not `welcomeSeen`.
No commit, version bump, dependency installation, installer execution, startup registration,
or real-profile modification was performed.

## Behavior

- Local packaged Welcome precedes splash, servers, model offers and network/PowerPoint prompts.
  Get started and normal X/Alt+F4 wait for queued edits and durable completion. Failed saves leave
  it open. Shutdown, renderer failure and unexpected destruction do not complete onboarding.
- Filow > Welcome... reuses a nonmodal singleton without restarting the app or setup sequence.
- Automatic/English/Italiano, system/explicit theme, OS accent and supported startup choices use
  one serialized preference service. Existing preferences and unrelated profile keys are preserved;
  installer locale no longer overwrites them. Empty installer model selections still suppress the
  recommendation offer because the existing choices object remains distinct from no file.
- New bounded IPC validates tracked main-frame senders and local file/app origin. Welcome has
  a separate sandboxed preload, restrictive CSP, no engine credentials, no navigation or popups.
- Desktop React roots subscribe before fetching, reject older revisions, mirror browser storage,
  and hydrate before displaying page content. Broadcasts do not echo updates. Legacy browser
  values migrate only for previously absent, uncommitted fields. Browser-only tabs remain separate.
- OS accent is RGBA-parsed and never persisted. Primary foreground, text accents and focus colors
  use tested contrast calculations, including bounded glass compositing and glow. Off removes
  all overrides. Shared theme tokens retain the original Filow palettes and artwork.
- Startup is never changed just by opening the app. Installed Windows uses matching executable/
  args for registration and readback; macOS approval remains pending. Development, portable and
  Linux builds hide startup; Linux also hides accent following. OS listeners are disposed on quit.

## Completed verification

- `npm run typecheck`: passed for all existing workspaces.
- `npm run typecheck -w apps/desktop`: passed for the new Welcome TypeScript and its imports.
- `npm test`: **164 passed, 1 skipped** (the pre-existing gauntlet skip), up from 110 passing tests.
  Coverage includes pure defaults/locale/contrast/string parity, startup failures/readback,
  requested-vs-actual state, disk failure after OS success, queued edits and migration races,
  singleton/close/failure lifecycle, sender validation, revision ordering, subscription cleanup,
  no IPC echo, Automatic storage semantics and accent override removal.
- `npm run build -w apps/web`: passed.
- Full `npm run build`: passed, including PowerPoint, Next standalone, relay and extension.
- `npm run vendor -w apps/desktop`: passed; generates Welcome JS/CSS and shared CJS translation/
  preference modules. Package file patterns include the HTML, both preloads, service and vendor CSS.
- `node --check` passed for main, both changed/new preloads and the preference service.
- `git diff --check`: no whitespace errors. Build-generated PowerPoint manifest/theme source
  were restored from task-local backups; no unrelated generated source changes retained.

## Exact Windows runtime observations and limits

The first launch under the command sandbox failed before app startup with Electron's Windows
AppContainer distribution ACL error. The same `npx --no-install electron .` command then launched
outside the command sandbox, with Electron sandboxing retained. Environment:

```text
FILOW_USER_DATA_DIR=G:\FILOW\tmp\welcome-qa
FILOW_PORT=4799
FILOW_SESSION_PORT=4800
FILOW_OFFLINE=1
TEMP=G:\FILOW\tmp
TMP=G:\FILOW\tmp
npm_config_cache=G:\FILOW\tmp\npm-cache
NEXT_TELEMETRY_DISABLED=1
```

The process remained running. Windows window inventory returned one `Filow` window owned by
`G:\FILOW\node_modules\electron\dist\electron.exe`. The newly created QA settings file contained
`lang: ""`, `theme: "system"`, and no `runAtStartup` or `welcomeCompleted` key. No screenshot or
control interaction succeeded: the computer-use tool reported **"Computer Use was not approved
to use electron"**. A subsequent app-selection request was rejected by automatic approval review
as a retry without explicit computer-access approval. Approval was requested from the user and
no workaround was used. The launched QA command was subsequently stopped; the profile was kept.

Therefore **no claim is made that the window's rendered layout, live language/theme switching,
toggle persistence across relaunch, main-window maximize/fullscreen, or actual acrylic appearance
has been visually verified**. The launch occurred before the final lifecycle refactor, so the final
source must be relaunched after approval. Required Windows manual acceptance remains pending.

Also unverified: packaged Windows login registration/sign-in, external disable/update/path with
spaces; Windows 10 opaque fallback; real Windows accent/theme change notifications; transparency
off/high contrast/Narrator/scaling; macOS login approval, accent notifications and vibrancy; Linux
runtime behavior. Adapter tests do not substitute for these device checks.

C: had about 277 GiB free before and after the task. Task-created profiles, caches, backups and
editing scripts are under `G:\FILOW\tmp`; generated build outputs stay inside the repository.
An externally added `AGENTS.md` memory block was observed during work and left untouched.

## Changed product/documentation files

- `apps/desktop/main.js`
- `apps/desktop/package.json`
- `apps/desktop/preload.js`
- `apps/desktop/ui-preferences.js` (new)
- `apps/desktop/ui-preferences.test.ts` (new)
- `apps/desktop/welcome.html` (new)
- `apps/desktop/welcome.ts` (new)
- `apps/desktop/welcome.css` (new)
- `apps/desktop/welcome-preload.js` (new)
- `apps/web/app/globals.css`
- `apps/web/app/theme-tokens.css` (new)
- `apps/web/app/layout.tsx`
- `apps/web/components/LangSwitch.tsx`
- `apps/web/components/UiPreferencesProvider.tsx` (new)
- `apps/web/lib/prefs.ts`
- `apps/web/lib/sessionUrl.ts`
- `apps/web/lib/applyUiPreferences.ts` (new; DOM application shared with Welcome)
- `apps/web/lib/ui-preferences.test.ts` (new)
- `packages/core/src/i18n.ts`
- `packages/core/src/index.ts`
- `packages/core/src/ui-preferences.ts` (new)
- `packages/core/src/ui-preferences.test.ts` (new)
- `apps/powerpoint/scripts/theme.js` (inline extracted tokens for the copied CSS)
- `apps/browser/scripts/theme.js` (same)
- `vitest.config.ts`
- `README.md`
- `README.it.md`
- `HANDOFF.md`
- `docs/welcome/IMPLEMENTATION.md` (this record)

Generated, ignored outputs include `apps/desktop/vendor/*`, `.next`, relay/add-in/extension build
artifacts and `release/Filow-extension-0.9.18.zip`. SPEC.md and the pre-existing research checkout
were not changed. No files outside the repository were intentionally written by task commands.
