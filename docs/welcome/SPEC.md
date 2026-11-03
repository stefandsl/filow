# Filow first-run Welcome — implementation specification

Status: research and proposed implementation only. Researched 2026-11-03. No product code changed.

Workspace audit: this task wrote this document and downloaded the reference repository under `tmp/sharex`. At final inspection, `AGENTS.md` also had an externally added `<claude-mem-context>` block; this task did not write or revert it. No commit, application launch, installer execution, typecheck or product build was performed.

Filow baseline: `a62a6a40814ac9a9006a86fff31ed8702e4ae526`, package version 0.9.18. The installed dependency is Electron **45.2.1**, despite the older Electron 33 description in AGENTS.md. Preserve the unreleased acrylic work described in HANDOFF.md. This document deliberately does not update HANDOFF.md: this task permits writes only under `docs/welcome/` and `tmp/`.

## 1. ShareX evidence

Source cloned shallowly into `G:\FILOW\tmp\sharex`. Reviewed commit **8ed375c7b4046fe5263bddc7ae893e58cb044d83**. Links below pin that revision, not a moving branch.

| Source | Finding |
|---|---|
| [ShareX/Presentation/StartScreen/StartScreenWindow.axaml](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/Presentation/StartScreen/StartScreenWindow.axaml) | Actual welcome window: 1000 × 720, minimum 840 × 580; grid `340,*`. Brand panel, three feature lines, platform footer; settings panel, footnote, Get started. This is not the image editor's similarly named start screen. |
| [ShareX/Presentation/StartScreen/StartScreenViewModel.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/Presentation/StartScreen/StartScreenViewModel.cs) | Language choices enumerate `SupportedLanguage`, including Automatic. Changing language updates application settings and current/default UI culture and refreshes labels. Startup uses `StartupManager.State`, then rereads actual state. Theme and accent write `Settings.ThemeOptions`. |
| [ShareX/Presentation/StartScreen/StartScreenWindow.axaml.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/Presentation/StartScreen/StartScreenWindow.axaml.cs) | `ShowAsync()` completes on Closed. Get started simply closes. **Any normal close**, including the title-bar X, sets `ShowStartScreen=false` and calls `SettingManager.SaveApplicationConfigAsync()`. Unsubscribes theme listener and disposes view model. |
| [ShareX/Program.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/Program.cs) | `StartApplicationAsync()` awaits the start screen if `ApplicationState.Settings.ShowStartScreen`, before initializing hotkey host and main window. |
| [ShareX/ApplicationConfig.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/ApplicationConfig.cs) and [ShareX/SettingManager.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/SettingManager.cs) | `ShowStartScreen` defaults true; `Language` defaults Automatic. Configuration inherits `SettingsBase<ApplicationConfig>` and is loaded/saved as `ApplicationConfig.json` under `AppPaths.PersonalFolder`; sandbox mode has no configuration path. Loading config also configures ThemeManager. Language/theme/accent changes mutate this configuration; startup registration is separate OS state. A crash before the close/save can show Welcome again. |
| [ShareX/StartupManager.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX/StartupManager.cs) and [ShareX.HelpersLib/Helpers/ShortcutHelpers.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX.HelpersLib/Helpers/ShortcutHelpers.cs) | Normal Windows build creates/removes `ShareX.lnk` in the current user's Startup special folder, targeting `Environment.ProcessPath` with `-silent`; Steam targets `../ShareX_Launcher.exe`. State checks shortcut target plus HKCU `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder`, value `ShareX.lnk`: first byte 3 means disabled by user. Microsoft Store build uses `Windows.ApplicationModel.StartupTask`, `RequestEnableAsync()` and `Disable()`. Disabled-by-user/policy and enabled-by-policy states alter label and disable the switch. |
| [ShareX.Avalonia/Theming/ApplicationThemeOptions.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX.Avalonia/Theming/ApplicationThemeOptions.cs) | Defaults at this revision: dark theme, accent `#09AAFF`, **both system-follow switches false**. The screenshot's on states are not proof of defaults. Persisted properties include Theme, UseSystemTheme, AccentColorHex and UseSystemAccentColor. |
| [ShareX.Avalonia/Theming/ThemeManager.cs](https://github.com/ShareX/ShareX/blob/8ed375c7b4046fe5263bddc7ae893e58cb044d83/ShareX.Avalonia/Theming/ThemeManager.cs) | ShareX delegates Windows color discovery to Avalonia `Application.Current.PlatformSettings.GetColorValues()`, listens to `ColorValuesChanged`, maps ThemeVariant to ShareXLight/ShareXDark and uses `AccentColor1` when its alpha is positive. Otherwise uses configured values. Updates app/windows and dynamic color/brush resources, including a 10%-darker gradient endpoint and foreground contrast choice. No direct Windows theme registry read is implemented in this ShareX class. Avalonia is pinned to 12.1.4 in `Directory.Packages.props`; its Windows backend is outside this repository. |

The source offers **more than the four visible rows**: turning system theme off reveals a Dark/Light selector; turning system accent off reveals a color picker. Filow will retain the explicit theme selector but use its own yellow when accent-follow is off, with no custom color picker. ShareX text comes from `ShareX/Localization/Strings.resx` and locale variants, including shared ApplicationSettings labels. Use the layout and interaction pattern, not ShareX artwork or copy.

## 2. Existing Filow behavior and integration constraints

* `apps/desktop/main.js`: `settings` defaults include `lang: ""` and `theme: "system"`. `loadSettings()` merges JSON; its existing remoteShare migration can immediately write a file, so file existence **after** load is not a first-run test. `saveSettings()` synchronously writes the entire settings object to `settingsFile` under Electron userData (normally `%APPDATA%\@filow\desktop`). Retain all unrelated keys and legacy environment aliases.
* `menuLang()` accepts explicit en/it, otherwise resolves `app.getLocale()` with Italian-prefix matching and English fallback. `ui:lang` currently rejects the automatic sentinel; `ui:theme` accepts system/light/dark and sets `nativeTheme.themeSource`. These IPC channels currently persist one-way notifications from the page.
* `apps/web/lib/prefs.ts`: `prefs:lang` currently stores en/it; absence resolves `navigator.language`. `prefs:theme` stores system/light/dark, default system. Setters notify preload; getters do not read desktop settings. `useUiLang`/`useUiTheme` in `apps/web/components/LangSwitch.tsx` initialize once from localStorage. Theme hook sets `data-theme`, listens to matchMedia, and sets `data-glass` from preload. There is no cross-window preference subscription.
* `apps/desktop/preload.js` exposes `filow.setLang`, `setTheme`, `glass` and many engine/network capabilities. `apps/web/lib/sessionUrl.ts` describes DesktopBridge. The welcome page does not need microphone, engine token, accessPassword, network setup or model APIs.
* `showSplash()` and `apps/desktop/splash.html`: local 460 × 440 frameless loading window, theme/language query values, icon, black/white wordmark, localized tagline and progress. It is a loading surface, not onboarding. Keep it separate.
* `main()` currently reads/deletes installer choices, opens splash, starts servers, creates hidden main window, waits for health, offers local AI when no installer choices and `!localAiOffered`, offers firewall once, starts requested downloads and loads main/settings page, waits for tunnel, reveals main, then offers PowerPoint/API-key guidance. Serialize Welcome before these prompts.
* `offerLocalAi()` uses hardware recommendations and a native dialog; `localAiOffered` is persisted separately. `readInstallChoices()` currently sets `settings.lang` to installer en/it and deletes `install-choices.json`. Preserve model choices and intentional empty-model selections; an installer file with no models must still suppress a second recommendation prompt.
* `apps/desktop/build/installer.nsh`: welcome, license, directory, hardware/model selection, install and finish pages; finish has Run now and desktop shortcut controls. `customInstall` writes `install-choices.json` with models/lang/ollama/hardware. **Run now is not run at login.** The installer has 11 languages, while app UI supports EN/IT. Do not replace these pages or add an overlapping startup checkbox.
* `main.js` enables acrylic on Windows build >=22000 with `backgroundMaterial: "acrylic"`, alpha-zero background, and **no `transparent:true`**; macOS uses `vibrancy:"under-window"`, `visualEffectState:"active"`. Preload receives `--filow-glass`. Preserve this behavior and Windows maximize/fullscreen support.
* `apps/web/app/globals.css`: dark ink #08090b, light #f7f7f5; dark accent #ffb600 and light readable accent #c27f00; brand gradient #ffe000 → #ffb600 → #ff6500. Glass uses translucent surfaces, saturation/18px blur, subtle borders/glows. Correct transparency selector is `:root[data-glass], :root[data-glass] body`.
* `brand/KIT-NOTES.txt`, `brand/svg/`, `brand/windows-small/`: source artwork. Actual shipped desktop assets are `apps/desktop/build/icon.ico`, `icon.png`, `wordmark-white.svg`, `wordmark-black.svg`; current generated compact icon supersedes older notes about mixed icon sizes. `packages/ui/src/Brand.tsx` exports the inline currentColor `Wordmark`. Never redraw or stretch it.

## 3. Product contract

### Window and lifecycle

Implement a **local packaged HTML welcome window**, independent of Next.js/server/tunnel readiness. It shares generated CSS tokens and translations with the app. This keeps first launch usable even when server startup is slow and avoids granting engine privileges to Welcome.

1. After `app.whenReady`, migrate/load profile and read installer choices. Capture whether a valid settings file existed **before** migrations that save. Normalize UI preferences. Set `nativeTheme.themeSource` before creating any visible window.
2. If `welcomeCompleted !== true`, await a singleton `showWelcome({firstRun:true})` **before** showSplash/startServers/offerLocalAi. The welcome window itself is the visible first-start surface. An existing profile without the flag gets Welcome once on upgrade, preserving its choices. This is once per profile, not once per version or install directory. Reinstallation retaining the profile does not repeat it.
3. Language, theme and accent edits apply and persist immediately, with live preview; startup changes call the OS only after an explicit user toggle. Each save failure is visible and leaves the prior committed state. Get started waits for queued edits, persists `welcomeCompleted:true`, then closes and resolves the gate. X / Alt+F4 performs the same completion with already-applied choices; it does not silently enable startup. App shutdown/crash or a renderer load failure does not mark completion.
4. Prevent a `window-all-closed` exit during the successful welcome-to-splash handoff: maintain an explicit startup-transition flag until the splash exists. Quit commands still quit; never resolve the gate into server startup after quitting. Clear window references on destruction.
5. After the gate, run the existing startup sequence and its independent first-run flags. Recompute localized dialog text after Welcome. Retain installer model choices in memory during the gate. Welcome never starts AI downloads or network sharing itself.
6. Add `Filow > Welcome...` / `Filow > Benvenuto...`. Reopening focuses the existing welcome window or creates one using current persisted values and current OS startup state. No completion reset, no server restart, no repeat AI/firewall/PPT prompts. Main stays open and usable; no reload or lost take. The menu window has main as parent but is nonmodal. Close returns focus to main.
7. Native framed window, title Filow, appIcon(), 1000 × 720 initial size, minimum 760 × 540, resizable, centered and clamped to display work area, show only after initial preference/text hydration. Use existing acrylic/vibrancy capability rule, contextIsolation:true, nodeIntegration:false, sandbox:true, restricted preload. On Windows 10/Linux use an opaque theme background. No always-on-top or custom title-bar implementation.

### Preferences and defaults

| Storage key | Type/default | Rule |
|---|---|---|
| `settings.welcomeCompleted` (new) | boolean, false | Only durable completion suppresses automatic display. Never increment with app versions. |
| `settings.lang` (existing) | `"" \| "en" \| "it"`, default `""` | Empty means Automatic; resolve OS locale through the same rule as menuLang. No separate resolved-language setting. |
| `settings.theme` (existing) | system/light/dark, default system | Follow switch on means system. Off captures currently resolved light/dark. Show Light/Dark segmented choice below this row while off. No second follow-theme boolean. |
| `settings.followSystemAccent` (new) | boolean, default false | Off retains Filow yellow palette. On uses validated OS accent where supported. False also preserves appearance on upgrade. |
| `settings.runAtStartup` (new) | boolean, absent until first successful explicit edit | Records user's requested startup state, not OS truth. UI always queries OS on open/focus; never re-enables an externally disabled entry during startup. |

Language dropdown is exactly Automatic / English / Italiano (Automatic label localized). On a new profile ignore the installer's inferred `choices.lang` as an explicit choice: default Automatic. For existing valid profiles preserve `settings.lang`, including empty. Modify readInstallChoices accordingly; it must not override a later welcome choice on reinstall/update. Installer model choices remain intact. If there is only legacy browser storage, migrate valid en/it and theme once before normal page hydration **only when those fields were absent in the pre-load desktop JSON and Welcome has not committed them**; never overwrite the fresh welcome choice with old localStorage.

Default startup is the actual OS state, ordinarily off. Do not copy the screenshot's on state by silently registering Filow. Default system theme is on; default accent-follow is off, retaining Filow identity. These are deliberate Filow defaults.

### Platform startup contract

Use Electron's main-process APIs; no shell command or hand-written registry edits. On installed Windows builds call `app.setLoginItemSettings({openAtLogin:on, enabled:on, name:"Filow", path:process.execPath, args:[]})`, and query with matching path/args. This is NSIS, so **do not use the Squirrel parent-directory stub example**. Launch the normal app, with no new silent/tray mode. Inspect this entry in `launchItems` and its enabled status as well as openAtLogin; executableWillLaunchAtLogin can include other argument sets. Catch errors, reread state, and persist the requested key only when registration succeeded. Report external disablement rather than replacing it on launch. Only an explicit toggle may re-enable it. [Electron login-item API](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows)

Hide startup on Linux, unpackaged development runs and Windows portable builds (`PORTABLE_EXECUTABLE_FILE`/`PORTABLE_EXECUTABLE_DIR`); never register a temporary extracted executable. macOS packaged app uses `app.setLoginItemSettings({openAtLogin:on})` and status readback, with label “Open Filow at login”. Display requires-approval as pending, not successful activation. Unsigned current macOS packages may fail or require OS approval; retain readable failure feedback and verify on a real signed build before promising reliable support. No Linux autostart implementation in this scope. Electron 45 removed openAsHidden; do not use it. [Electron platform behavior](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows)

## 4. One preference authority and IPC

Desktop settings are authoritative for desktop renderers. Browser-only sessions retain localStorage behavior. Do not synchronize these preferences to phones or hosted browser users.

New main-process module `ui-preferences.js` owns normalization, OS queries, validated updates, serialized save operations and subscriptions. Inject app/nativeTheme/systemPreferences/persistence adapters so pure logic and failure paths can be tested without launching Electron. `saveSettings()` must accept/commit a candidate settings object, preserve unrelated keys and report write errors; use a temporary sibling and rename for the new transactional save path. Memory state changes and broadcasts follow successful persistence. Do not stringify or return the full settings object to renderers.

Expose a bounded snapshot:

```ts
type UiSnapshot = {
  revision: number; // process-local monotonic counter, including OS changes
  lang: "" | "en" | "it";
  resolvedLang: "en" | "it";
  theme: "system" | "light" | "dark";
  resolvedTheme: "light" | "dark";
  followSystemAccent: boolean;
  accentColor: string | null; // validated opaque #rrggbb; null = brand fallback
  startup: { supported: boolean; requested: boolean; enabled: boolean;
    status: "enabled" | "disabled" | "blocked" | "requires-approval" | "unsupported" };
  accentSupported: boolean;
};
```

IPC: `ui:getPreferences` invoke → snapshot; `ui:updatePreferences` invoke accepts only a partial object of lang/theme/followSystemAccent/runAtStartup → `{ok:true,state}` or `{ok:false,code,state}`; `ui:preferencesChanged` broadcasts snapshots; `welcome:complete` invoke persists completion and closes that window. No path, arbitrary channel or CSS text arguments. Reject unknown fields, wrong types and unsupported platform operations. Validate sender's main frame and tracked webContents: Welcome must be the exact local welcome file; main UI must match the configured APP_URL origin; exclude remote navigation, subframes and unrelated windows. Completion is welcome-only. Deny navigation and popups in Welcome.

`welcome-preload.js` exposes only get/update/subscribe/complete and glass capability under `filowWelcome`; subscriptions return unsubscribe functions and strip Electron event objects. Existing `preload.js` adds get/update/subscribe for normal pages. Existing `ui:lang`/`ui:theme` handlers delegate to the same validated service for compatibility (allow empty lang); do not maintain two persistence implementations. Updated page setters use invoke so failure can roll back; broadcasts never call a setter that echoes IPC.

Add `UiPreferencesProvider` at the web root. Subscribe **before** fetching initial snapshot; reject older revisions to avoid a late response overwriting an event. Hydrate before showing desktop page content to avoid wrong-language/theme flashes. Cache effective desktop snapshot in prefs.ts; mirror en/it into `prefs:lang` or remove it for Automatic; mirror theme into `prefs:theme`. Existing hooks consume this shared state and update immediately on Welcome or menu changes, including multiple mounted consumers. All listeners clean up. Web-only initialization remains synchronous from localStorage, and storage events synchronize browser tabs. Failure UI uses translated error codes, not raw exceptions.

## 5. System accent pipeline and appearance

Main reads `systemPreferences.getAccentColor()` on Windows/macOS after ready. Its value is RGBA hex (`rrggbbaa`), not ARGB. Accept exactly eight hex digits; reject malformed/fully transparent results; normalize usable RGB to opaque `#rrggbb`. The CSS variable is **`--system-accent`**. Do not persist a sampled OS color. On disabled following, unsupported platform or query failure, emit null and remove all accent overrides so theme-specific brand defaults resume. Hide the accent-follow row on Linux for this version. [Electron system preferences](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetaccentcolor)

Windows: subscribe once to `accent-color-changed` and reread the API; `nativeTheme.updated` refreshes resolved theme. macOS: subscribe to `AppleColorPreferencesChangedNotification` and `AppleAquaColorVariantChanged` via systemPreferences; reread on window focus on both platforms as a recovery path. Unsubscribe on shutdown, deduplicate unchanged snapshots. An OS event never writes user preference keys. [Electron notification and color events](https://www.electronjs.org/docs/latest/api/system-preferences)

Shared renderer application function sets data-theme, data-glass, document.lang and accent variables from snapshots. Keep artwork unchanged: wordmark white on dark, black on light; compact icon retains original yellow. Accent following changes UI controls, focus rings and subdued panel glow across Welcome and normal desktop web pages, including Settings and overlay. Phone/browser pages retain Filow defaults.

Extract the existing root dark/light and glass tokens into `apps/web/app/theme-tokens.css`, imported by globals.css and bundled into welcome.css. Introduce `--action-background` defaulting to `--brand-gradient`, and `--action-foreground` defaulting to #08090b. Primary buttons use these, not a hardcoded gradient/foreground; update the light-theme override too. With a system accent set, action background is that solid color and foreground is whichever of black/white gives greater WCAG contrast. Use a pure luminance/contrast helper. For text links/eyebrows choose the closest mix of the OS color toward black (light theme) or white (dark theme) that meets 4.5:1 against the opaque base surface; focus boundaries target 3:1. Set `--accent`, `--accent-ring` and `--glow-a/b` consistently from this derived palette, while `--system-accent` remains the exact normalized source. Test actual glass compositing as well as opaque token contrast. Off removes overrides, restoring #ffb600 dark / #c27f00 light and original gradient: both are Filow's yellow family.

Layout: left 34%, right 66%, 32px padding; left has wordmark, welcome heading, existing tagline, three concise bullets and open-source/platform footer at bottom. Use a subtle yellow/amber glow over ink or light neutral glass, not ShareX blue. Right has heading/subtitle, four clearly separated 64px-minimum rows, explanatory footnote and bottom-right CTA. Conditional explicit theme selector sits within the theme row. At <760px content width stack panels and allow vertical scrolling; CTA remains reachable at 200% scaling. Native controls or semantic switches with labels, 44px hit targets, visible keyboard focus, accessible checked state and live error region. Respect reduced motion and forced colors; use opaque surfaces for high contrast/reduced transparency. Do not rely on color alone.

## 6. Shared EN/IT copy

All new strings belong to `packages/core/src/i18n.ts`, not independent HTML/menu dictionaries. Reuse `app.tagline`, `common.language`, `common.loading`, `common.close`, `LANG_LABELS`. Welcome's DOM uses textContent; compile the shared translator for the desktop shell. Exact proposed additions:

| Key | English | Italiano |
|---|---|---|
| menu.welcome | Welcome... | Benvenuto... |
| welcome.title | Welcome to Filow | Benvenuto in Filow |
| welcome.personalize | Make Filow yours | Personalizza Filow |
| welcome.subtitle | Choose how the app should look and feel. | Scegli l'aspetto e il comportamento dell'app. |
| welcome.featurePoints | Keep track of your talking points | Tieni il filo dei tuoi punti |
| welcome.featureSlides | Stay in sync with your slides | Resta al passo con le tue slide |
| welcome.featurePhone | Follow along on your phone | Segui i punti dal telefono |
| welcome.footer | Open source · Windows, macOS and Linux | Open source · Windows, macOS e Linux |
| welcome.note | You can change these options anytime from Filow > Welcome... | Puoi cambiare queste opzioni in qualsiasi momento da Filow > Benvenuto... |
| welcome.getStarted | Get started | Inizia |
| ui.automatic | Automatic | Automatico |
| ui.startupWindows | Run Filow when Windows starts | Avvia Filow all'avvio di Windows |
| ui.startupMac | Open Filow at login | Apri Filow all'accesso |
| ui.followTheme | Follow system theme | Segui il tema di sistema |
| ui.followAccent | Follow system accent color | Segui il colore principale di sistema |
| ui.theme | Theme | Tema |
| ui.light | Light | Chiaro |
| ui.dark | Dark | Scuro |
| ui.system | System | Sistema |
| ui.saveError | Could not save your preferences. Try again. | Impossibile salvare le preferenze. Riprova. |
| ui.startupError | Could not change startup settings. Check your system settings. | Impossibile modificare l'avvio automatico. Controlla le impostazioni di sistema. |
| ui.startupBlocked | Startup is disabled in system settings. | L'avvio automatico è disattivato nelle impostazioni di sistema. |
| ui.startupApproval | Allow Filow in your system's Login Items settings. | Autorizza Filow nelle impostazioni di sistema degli elementi di login. |
| ui.accentUnavailable | System color unavailable; using Filow yellow. | Colore di sistema non disponibile; viene usato il giallo Filow. |

Render CTA arrow as decorative, aria-hidden. Translate existing LangSwitch/ThemeSwitch aria labels and titles using the shared labels above. Automatic changes the interface immediately using OS locale; it does not change spoken-language/STT preferences. The footnote truthfully points to the menu that exposes all four settings; do not claim the current Local models settings page has controls it lacks.

## 7. Exact future implementation file plan

These are **future changes**, not files to modify during this research task.

| File | Required change |
|---|---|
| `apps/desktop/main.js` | Add preference service, welcome singleton and serialized first-run gate; merge/save handling; installer-language rule; Welcome menu using shared translator; OS listeners; sender validation; existing IPC delegation; safe close handoff. Add optional `FILOW_USER_DATA_DIR` absolute-path override before first userData access for isolated QA, and place sessionData there too before ready. Production default unchanged. |
| `apps/desktop/ui-preferences.js` (new) | Main preference service and injected OS/storage adapters; capability/readback/error logic and snapshot revision handling. |
| `apps/desktop/ui-preferences.test.ts` (new) | Adapter tests including startup OS failures, state reconciliation, sender checks and completion failures. |
| `apps/desktop/welcome.html` (new) | Two-pane semantic local document; references generated JS/CSS and shipped wordmark assets. Restrictive CSP: no network/connect/frame/object; scripts/styles self; images self/data only if actually needed. |
| `apps/desktop/welcome.ts` (new) | Typed DOM controller, hydration, dropdown/switch handlers, errors, focus behavior, shared t() and pure palette helpers; import welcome.css so esbuild emits its companion CSS; no Node APIs. |
| `apps/desktop/welcome.css` (new) | Layout and component styles, importing shared theme tokens; adaptive stack, accessibility, glass fallback. |
| `apps/desktop/welcome-preload.js` (new) | Minimal scoped bridge; no arbitrary IPC and no engine credentials. |
| `apps/desktop/preload.js` | Normal-page preference snapshot/update/subscription bridge. |
| `apps/desktop/package.json` | `build:welcome` uses existing esbuild to bundle welcome.ts and CSS to `vendor/welcome.js` and `vendor/welcome.css`, and `packages/core/src/i18n.ts` plus pure ui-preferences.ts to CJS `vendor/i18n.js` / `vendor/ui-preferences.js`. Run before start and as part of vendor invoked by all predist hooks. Include new HTML, preloads, service and `vendor/*.css` in build.files (vendor/*.js already included). Avoid direct require of core TypeScript from Electron. |
| `packages/core/src/ui-preferences.ts` (new) | Pure types, language/theme normalization, accent parsing, contrast/palette generation, completion predicate. No Electron/DOM imports. |
| `packages/core/src/ui-preferences.test.ts` (new) | Pure tests listed below. |
| `packages/core/src/index.ts` | Export preference types/helpers for web code. |
| `packages/core/src/i18n.ts` | Add shared bilingual strings above; keep key parity. |
| `apps/web/app/theme-tokens.css` (new), `apps/web/app/globals.css` | Extract existing palette unchanged, add accent/action tokens and override selectors; retain correct acrylic root selector. |
| `apps/web/lib/prefs.ts` | Automatic preference setter/getter distinction, desktop snapshot cache, storage mirroring/migration, observable change notification. Keep getLang returning resolved Lang. |
| `apps/web/lib/sessionUrl.ts` | Type new bridge methods and UiSnapshot; include setLang/setTheme compatibility methods. |
| `apps/web/components/UiPreferencesProvider.tsx` (new), `apps/web/app/layout.tsx` | Root client subscription/hydration and shared DOM palette application; web fallback. |
| `apps/web/components/LangSwitch.tsx` | Consume synchronized preferences; translate labels; en/it clicks deliberately exit Automatic; theme controls update shell and other windows. |
| `apps/web/lib/ui-preferences.test.ts` (new) | Snapshot ordering, storage migration and no-echo reducer tests. |
| `vitest.config.ts` | Add `apps/desktop/**/*.test.ts` to explicit include list. Existing discovery otherwise omits desktop tests. |
| `README.md`, `README.it.md`, `HANDOFF.md` | When implementing, document Welcome/menu/defaults/platform limitations and QA profile override in sync; record verified behavior. |

No required changes to NSIS pages, splash HTML, brand masters, app versions or release workflow. Splash automatically gets the chosen language/theme on creation. No new dependencies. Generated vendor artifacts must be present in packaged output and rebuilt from source; no committed generated translation fork. Use `build/wordmark-white.svg` and `wordmark-black.svg` in local HTML, and existing Wordmark component wherever React needs branding.

## 8. Verification plan

### Automated implementation checks

Run `npm run typecheck` and `npm test` after implementation; run the welcome asset build and full `npm run build` to confirm web/desktop packaging inputs. Do not run these for this documentation-only task: they can write outside the authorized folders.

Pure tests: undefined/malformed prefs normalize; it-IT/it-CH → it, other locales → en; empty lang stays Automatic through storage round trip; system-off captures resolved theme; false/missing completion shows, true skips; accent RGBA parses in correct order, transparent/invalid rejected; black/white/extreme/gray accents yield readable foreground; accent-off restores both theme palettes. Test key parity for new EN/IT strings.

Adapter/reducer tests: OS readback overrides stored requested startup; same path/args on Windows reads/writes; unsupported/portable/dev never calls OS setter; external disable is not silently undone; macOS requires-approval remains pending; storage failure does not report completion or broadcast success; OS success followed by disk failure reports error and re-queries OS (OS/file operations are not atomic); queued rapid toggles settle to last acknowledged state. Repeated show calls reuse one window; successful close hands off once; crash/load-failure/quit do not set completion; menu reopen cannot retrigger AI setup. Invalid sender/subframe/unknown field rejected. Subscription-before-get with revision ordering cannot regress state; broadcasts cannot echo writes; unmount removes listeners. Installer choices with empty models remain distinct from no file.

### Windows manual acceptance

Use a dedicated QA profile under `G:\FILOW\tmp\welcome-qa\` via the implemented FILOW_USER_DATA_DIR override. Set TEMP/TMP and tool caches under this task's tmp folder; do not rely on APPDATA alone (HANDOFF warns it does not isolate Electron userData). Check C: free space before running tools; stop below 20 GB. Do not delete a real user profile or files this task did not create. Startup registration must be tested with a packaged NSIS install in an isolated Windows test account; dev mode deliberately hides it.

1. Fresh profile: Welcome appears before splash, servers and native setup dialogs. Defaults Automatic, startup actual/off, theme on, accent off. No startup entry created merely by opening. All text and artwork load offline.
2. Select Italiano, English, Automatic on Italian Windows; check immediate labels and subsequent menu/splash/setup dialogs. On another OS language Automatic falls back to English. Selecting EN/IT in main updates reopened Welcome without resetting spoken language.
3. Get started and relaunch: no welcome. X then relaunch: no welcome. Kill before completion: welcome returns. Reopen repeatedly via menu: one window, no setup prompts; main take/navigation remains intact.
4. Toggle startup in packaged install. Inspect Windows Settings > Apps > Startup and Task Manager, then sign out/in to verify launch. Disable externally, reopen Welcome: show actual disabled state, never re-enable automatically. Explicit off removes registration. Verify after an application update and an installation path containing spaces. Portable and source runs hide the row.
5. Theme on follows Windows light/dark changes live in Welcome/main/title bar. Theme off freezes current appearance and exposes light/dark selection. Reopen/relaunch preserves choice. Test all theme × accent combinations.
6. Accent on follows two very different Windows colors live, even after focus returns; compare with API value. Accent off returns original yellow in both themes. Test very light/dark OS accents, button text, links, focus rings and invalid-color fallback using injected adapter tests.
7. Check Windows 11 acrylic against desktop content, then Windows 10 opaque fallback; main still maximizes and enters fullscreen. Test Windows transparency off/high contrast, keyboard-only operation, narrator labels, 100/150/200% scaling, small display and long Italian rows. No cut-off CTA.
8. Existing profile with completion absent: welcome once, current choices preserved. Profile with completion true plus new install-choices: skip welcome; preserve existing language while consuming model choices. Installer chosen models run after completion; no-choices portable gets one local-AI offer. No competing firewall/PPT dialogs behind Welcome.
9. Read-only QA settings file: save/complete reports localized error and does not claim success. Simulated renderer failure does not hang startup invisibly or mark done: show a native localized error and quit cleanly so next launch retries. Inspect packaged asset list and start without development servers.
10. Separately verify macOS packaged login approval/readback, accent notifications and vibrancy; Linux hides startup/accent, retains system theme and opaque fallback. Record untested platforms explicitly; Windows evidence is not macOS/Linux validation.

Acceptance requires the above behavior, synchronized existing preferences, no repeated onboarding after normal completion, and no changes to unrelated engine/STT/network decisions. Research establishes source behavior; it does not claim these proposed changes have been implemented or runtime-tested.
