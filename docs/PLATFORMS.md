# Filow platforms: status with evidence

Owner: track T4 (docs/GOAL.md). "Done" for a platform means built, installed and checked on that
platform. This page says what was checked, how, and what still needs a machine or an account we do not
have. Updated 2026-11-10.

| platform | built | run and checked | status |
|---|---|---|---|
| Windows x64 | yes (nsis, portable, dir) | yes, every autoloop probe (docs/autoloop/JOURNAL.md) | released (0.9.30) |
| Linux x64 | yes, AppImage + deb, built in WSL2 (Ubuntu 22.04, Node 22) | under WSLg only, with the first version of tools/autoloop/e2e/linux.mjs; the stricter version (hotkey, keys at rest, speech) has not run on Linux yet | builds and starts; not verified on a real Linux desktop, see "Linux, not yet verified" |
| macOS x64 + arm64 | no (needs a Mac) | no | config reviewed and fixed; checklist below |
| Android (companion) | the web app served by the desktop | Edge 157 headless as a 390x844 Android phone over CDP: tools/autoloop/e2e/pwa.mjs | installable from localhost (a secure origin) in that check; not from the LAN address; no real phone tried, see "Phones" |
| iOS (companion) | same | meta tags and icons checked over CDP; no iPhone here | needs a real iPhone |

## Linux

How to build (on Linux, or in WSL2 on an ext4 disk, so npm installs the Linux native packages): `npm ci`,
`npm run build`, then in apps/desktop `npm run vendor` and
`npx electron-builder --linux AppImage deb --x64 --publish never`. Keep the build and its caches off the
Windows system disk: the T4 run built inside the WSL distro, whose disk image lives on C: (it left
/root/filow-t4 and /root/filow-t4-release there; owner decision on removing them, docs/OWNER-DECISIONS.md).

How to check: `node tools/autoloop/e2e/linux.mjs <Filow.AppImage | /opt/Filow/Filow> --models <models dir>
--wav <16 kHz mono wav> --expect "<words said in it>" [--keyring yes|no|auto] [--work <dir>]`. It runs the
app as the desktop user (uid 1000, never root), on its own profile and ports (FILOW_E2E_PORT, default
4841, and the next port; DevTools FILOW_E2E_DEVTOOLS, default 9355). The rules that decide PASS or FAIL for
keys at rest, speech to text and the hotkey are unit-tested (tools/autoloop/e2e/verdicts.mjs, 7 tests,
each rule shown able to fail). It checks:

| check | result on 0.9.30 + T4 fixes (AppImage and installed deb, first script version) |
|---|---|
| window | "main window shown" at 1.9-2.9 s |
| local servers | web 200, /mirror 200, relay /health 200 |
| main page | renders (1093 chars of text, desktop bridge present), screenshot tmp/t4/linux-main.png |
| axe-core (WCAG 2.2 A+AA) | 0 violations on 6 pages x 2 themes, no wrong pages |
| speech to text | sherpa-onnx worker loads Nemotron in 1.9-3.5 s and transcribes a real recording ("Where is the window start button"); the old check passed on any word of 3 letters, the new one needs 3 words and, with --expect, 60% of the expected words |
| keys at rest | reported by the T4 run: no key ring in WSL, the key stays in .env, nothing half-encrypted; its result file was not kept. The old check passed either branch; the new one needs the app's own log line to match the files, and --keyring pins the branch |
| OK Filow hold-to-talk | not checked by that run; the new script waits for "hold-to-talk hook started" in startup.log |
| process name | the main process is listed as Filow (was "next-server (v15.5.28)") |
| clean quit | closing the window quits: exit code 0, 0 processes left, ports 4841/4842/9355 closed |

Fixed on the way (each one seen failing first):
- **deb could not start on a minimal system**: the package installed, then Filow died with
  "libasound.so.2: cannot open shared object file". electron-builder 26 dropped libasound2 from its
  default deb dependencies (Ubuntu 24.04 renamed it libasound2t64). apps/desktop/package.json
  `deb.depends` now lists the defaults plus `libasound2 | libasound2t64` and `libgbm1`; reinstalling
  with apt pulled libasound2 and the app started.
- **hold-to-talk libraries**: the uiohook linux-x64 prebuild links libX11.so.6, libXrandr.so.2, libXt.so.6
  and libXtst.so.6 (read from the binary's dynamic section). `deb.depends` names libx11-6, libxrandr2,
  libxt6 and libxtst6, so a minimal system installs them.
- **process shown as "next-server"**: Next's standalone server renames the process. On Linux and macOS
  ps, pkill and System Monitor could not find Filow. main.js restores the title right after loading it.
- **window association on Wayland**: `desktopName` and `linux.syncDesktopName` set, so the .desktop
  file, StartupWMClass and Electron's app_id agree (electron-builder warned about it).
- **builds for the wrong CPU**: apps/desktop/after-pack.js (electron-builder afterPack) fails the build
  when the package lacks sherpa-onnx-<os>-<cpu> with the libraries its addon loads (onnxruntime and the
  sherpa C API, per platform), or the uiohook prebuild for its target. npm installs only the host's
  optional packages, so this protects every cross build (tests: after-pack.test.ts, 5 tests).

Linux, not yet verified:
- The AppImage ran only self-extracted (`APPIMAGE_EXTRACT_AND_RUN=1`): WSL has no libfuse2. On a desktop
  without libfuse2 users would see an AppImage error; Ubuntu 22.04 and later do not ship it by default.
- Ubuntu 24.04 and later restrict unprivileged user namespaces with AppArmor. The deb installs an
  AppArmor profile (electron-builder postinst) and should start; the AppImage will likely need
  `--no-sandbox` or a profile. WSL here is 22.04.
- Native Wayland sessions: under WSLg Electron chose X11 (XWayland). uiohook (OK Filow hold-to-talk) and
  global shortcuts are X11 features; on GNOME Wayland they will not see keys typed into Wayland apps.
- A desktop with GNOME Keyring or KWallet (keys move to secrets.json encrypted): not exercised in WSL.
- Microphone capture from a real device (PulseAudio/PipeWire), screen capture through the desktop portal,
  auto-update (AppImage self-replace, deb via pkexec), ufw blocking the phone on the LAN.
- In WSL only, Chromium logs D-Bus errors (no session bus); harmless there.

## macOS (reviewed, not built)

Changes in apps/desktop/package.json "build.mac":
- `extendInfo`: NSMicrophoneUsageDescription and NSAppleEventsUsageDescription (slideshow.js asks
  PowerPoint through osascript). Without a usage string macOS kills the app when the permission is
  requested. Screen recording has no Info.plist key; macOS shows its own prompt. No camera key: Filow
  never uses the camera.
- `hardenedRuntime: true` with build/entitlements.mac.plist for the app and its helpers: allow-jit,
  allow-unsigned-executable-memory (V8, WebAssembly), device.audio-input, automation.apple-events. No
  camera entitlement. allow-unsigned-executable-memory is electron-builder's default and stays until a
  Mac run shows the app works without it. Library validation stays on: electron-builder signs every
  native module with the same team.
- `identity: null` removed: it switched signing off even on a Mac that has a Developer ID certificate.
  Now electron-builder signs when it finds one (keychain, or CSC_LINK + CSC_KEY_PASSWORD) and skips
  signing otherwise. `electronFuses.resetAdHocDarwinSignature: true`: flipping the fuses breaks the
  ad-hoc signature, and an unsigned arm64 build would not launch at all.
- `zip` target next to `dmg`: electron-updater on macOS installs from the zip (latest-mac.yml). The
  updater (Squirrel.Mac) refuses an update whose signature does not match the running app, so unsigned
  builds cannot update themselves even with the zip: auto-update on macOS needs D7 (Developer ID).
  Published releases up to 0.9.30 carry only the dmg; the first release built from this config adds the zip.
- Notarization hook: electron-builder notarizes after signing when these are set in the environment,
  nothing to change in the config: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER (App Store Connect
  API key, preferred), or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
- Per-arch builds (x64 and arm64 dmg/zip), not universal: native modules come per arch. Build each arch
  on a Mac of that arch, or install the other arch's optional package first
  (`npm install --no-save --os=darwin --cpu=x64 sherpa-onnx-darwin-x64`); after-pack.js stops a build
  that would ship the wrong one.

darwin branches in apps/desktop/*.js:
- localai.js, Ollama install: `codesign --verify --deep --strict` accepted any valid signature, ad-hoc
  included, and the app was unpacked straight into ~/Applications, where ollamaExe() would find and start
  it even after a failed check. Now `installMacApp` unpacks to a staging folder, requires Apple's
  Developer ID chain with Ollama's Team ID 3MU9H2V9Y9 (integrity.js macDeveloperIdRequirement), and only
  then swaps it into ~/Applications. An Ollama already installed is kept until the new one is in place
  and is put back if the swap fails; the download and the staging folder are always removed
  (localai.test.ts, integrity.test.ts).
- main.js: default route via `route -n get default`, Office add-in folder
  ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef, localhost certificate via openssl +
  `security add-trusted-cert`: read, plausible, not run.
- slideshow.js: osascript polls PowerPoint every 500 ms through System Events: needs the Apple Events
  prompt (now described in Info.plist).
- ui-preferences.js: login item and accent colour notifications: read, plausible.

Checks that need a Mac (in order):
1. Build both arches; open each .app. `codesign -dv --verbose=4 Filow.app` (ad-hoc when unsigned),
   app launches on Apple Silicon unsigned.
2. With the owner's Developer ID: `codesign --verify --deep --strict --verbose=2 Filow.app`,
   `spctl -a -vvv -t exec Filow.app` says "Notarized Developer ID", `xcrun stapler validate` on the dmg.
3. First take: microphone prompt shows our text; the sherpa worker loads (library validation on).
4. Screen Sense and OK Filow: Screen Recording permission prompt, and what the app shows when it is denied.
5. OK Filow hold-to-talk (mac-permissions.js, 2026-11-10): before the hook starts, okfilow.js checks
   `systemPreferences.isTrustedAccessibilityClient(false)`; if Accessibility is missing, or the hook's own error says
   so (UIOHOOK_ERROR_AXAPI_DISABLED: Accessibility; UIOHOOK_ERROR_CREATE_EVENT_PORT: Input Monitoring), hold-to-talk
   stays off, the Cmd+Option+O toggle works, the panel shows the toggle hint with the hotkey list disabled,
   and a plain-words dialog (en, it) opens the right pane (Privacy_Accessibility or Privacy_ListenEvent).
   The hook is retried every 30 s, so it should start once the permission is given. On a Mac, check: the
   dialog shows once per launch; "Open System Settings" lists Filow under Accessibility (prompt=true) and
   opens the right pane; whether macOS needs Input Monitoring too for this tap (it is an active tap,
   kCGEventTapOptionDefault) and whether the retry picks it up without a restart (macOS often asks to
   quit the app after an Input Monitoring change; the dialog tells the user to reopen Filow if needed);
   dictation typing (keyTap Cmd+V) after Accessibility is granted. Unit tests: mac-permissions.test.ts
   (logic only; nothing here ran on macOS).
6. PowerPoint: the Apple Events prompts (System Events, PowerPoint); no "Where is Microsoft PowerPoint?"
   dialog when it is not installed; add-in sideload; `openssl req -addext` with macOS LibreSSL;
   `security add-trusted-cert -d` on a standard (non-admin) account.
7. Ollama install: confirm the Team ID with `codesign -dvvv ~/Applications/Ollama.app 2>&1 | grep -E 'Authority|TeamIdentifier'`
   (expected TeamIdentifier=3MU9H2V9Y9).
8. Keychain prompt when a key moves from .env to secrets.json; auto-update from a signed build: install
   version N from the dmg, publish N+1 with its zip and latest-mac.yml, check that "Restart to install"
   replaces the app (unsigned: expected to fail with a code-signature error).
9. Try removing allow-unsigned-executable-memory from the entitlements: keep it only if the app or the
   speech worker fails without it.
10. Single instance: open Filow twice (Dock, then Finder); the second launch must bring the first window
   forward and start no servers (requestSingleInstanceLock, verified on Windows only).
11. About and privacy, Report a problem: the window opens from the Filow menu and Settings, the policy
   shows offline, "Save to a file" writes to ~/Documents (verified on Windows only).

## Phones (Android and iOS companion)

The phone opens the mirror (/mirror) served by the desktop, from the QR code or by typing the code.
Install support, in apps/web:
- app/manifest.ts (replaces public/manifest.webmanifest): id, start_url and scope are /mirror, so only the
  mirror installs and the home-screen icon opens the code screen; standalone; 192 and 512 px icons, both
  "any" and "maskable"; theme and background #121212, the dark page background (manifest.test.ts reads it
  from theme-tokens.css).
- app/layout.tsx: theme-color per light/dark scheme, apple-mobile-web-app-capable, title "Filow",
  status bar style, apple-touch-icon (180 px), and format-detection telephone=no (iOS turned the 6-digit
  pairing code into a phone link).
- No service worker, on purpose: Chrome no longer needs one to install, iOS never did, the mirror is
  useless offline, and a worker could serve stale pages after an update or sit between the phone and the
  live session (/api/session*, /ws/session). The CSP (apps/desktop/csp.js) is unchanged: it applies to
  the desktop windows and already allows the manifest (default-src 'self').
- Pairing fix: scanning the desktop's QR code always asked "This link connects to <ip>:4748, not to the
  page you opened. Continue?", because the relay listens on the next port. The mirror now trusts a relay
  at the page's own origin, or on the same host with the same scheme one port up; anything else still
  asks (apps/web/lib/mirrorServer.ts, tests in mirrorServer.test.ts). Over the public link the QR names two
  different trycloudflare hosts, so pairing there still asks once; pwa.mjs does not cover that case.

Evidence (tools/autoloop/e2e/pwa.mjs against the packaged Windows app, Edge 157 headless as an Android
phone at 390x844, 2026-11-10): installable over localhost with no installability errors; manifest id,
start_url and scope /mirror, standalone, 4 icons; iOS meta tags and a 180 px touch icon; no service worker;
0 axe violations and 0 px horizontal overflow on the code screen and the live mirror in both themes; the
live mirror shows the stage (not the code or waiting screen) after opening the QR link, with no confirm().
Screenshots in tmp/t4/phone-*.png. Four runs in a row passed after the script stopped using whichever tab
Edge lists first.

The limit that only the owner can lift: Chrome installs only from a secure origin. Over the LAN address in
the QR code (plain http) it reports `not-from-secure-origin`, so on Android the mirror can be added to the
home screen as a shortcut but not installed as an app. Over the public link (https) it should be
installable, but that was not checked, and the quick tunnel's address changes on every launch, so an
installed app would point at a dead address the next day. A fixed https address (a named Cloudflare
tunnel on the owner's domain, or a trusted certificate for the LAN) is a product and account decision
(relates to SEC-09). iOS "Add to Home Screen" works over http; full-screen launch not checked on a real
iPhone.

## What only the owner can do

- Apple: Developer Program account, Developer ID Application certificate, notarization credentials
  (env vars above), a Mac of each arch to build and run the checklist.
- Windows: code-signing certificate (SmartScreen reputation).
- Linux: nothing required to ship; a repository or Flathub/Snap listing if wanted; a real Linux desktop
  (or a VM on G:) to run tools/autoloop/e2e/linux.mjs.
- Android and iOS: real phones for the companion checks; Google Play and the App Store only if a native
  wrapper is ever wanted (today the companion is a web app and needs neither).
- A fixed https address for the phone (named tunnel or certificate), see Phones.
