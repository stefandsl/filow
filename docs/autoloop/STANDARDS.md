# Filow industry-standards scorecard

Source: Claude research agent, 2026-11-08 (last30days on Reddit/YouTube/HN, plus web search of
store reviews, review sites and the official standards linked below). Humans edit this file; the
autoloop agent reads it and never changes it. Weights: 3 = must have (blocks release), 2 = expected
standard, 1 = polish. "Budget" means a number Filow sets for itself, because no external standard
fixes it. Items with an automatic check are mirrored in `standards.json` and scored by
`tools/autoloop/score.mjs`; the rest are checked by hand in the weekly review and marked in `MANUAL.md`.

## What users want (competitor findings)

1. **Tracking that never runs ahead** and finds you again after an ad-lib, skip or jump back, on long scripts too. This is the top PromptSmart/VoiceTrack complaint ([App Store](https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756), [review](https://teleprompter.works/blog/promptsmart-pro-review/)). BIGVU-style prompters hear *that* you speak, not *what* you say ([VoicePrompter](https://voiceprompter.app/blog/top-10-teleprompter-software.html)).
2. **Real rooms and real mics:** noise, Bluetooth and USB headsets, swapping devices mid-talk (a PromptSmart weak spot).
3. **Help during the real talk, not only practice.** This is the gap Yoodli ([review](https://www.finalroundai.com/blog/yoodli-review-pros-cons)) and PowerPoint Speaker Coach ([MS](https://support.microsoft.com/en-us/powerpoint/rehearse-your-slide-show-with-speaker-coach)) leave open, and Filow's opening.
4. **Never lose work:** autosave, no hangs (a PromptSmart editor hang cost a user 2 hours of edits; Orai doesn't save progress).
5. **Fair pricing:** no surprise paywalls or nag popups (Orai, Speakflow, Yoodli complaints).
6. **Privacy for anything that watches or records:** local-first, a visible indicator, a clear list of who receives what. HeyClicky sends screen and voice to 4 cloud vendors ([The Rundown](https://www.therundown.ai/tools/clicky)); Omi raises always-on recording worries.
7. **Windows-native.** HeyClicky, Atticus and most voice prompters started on macOS. Direct Windows rivals: VoiceSync AI ([MS Store](https://apps.microsoft.com/detail/9pngzvfqlvnh)) and clicky.foo (offline with Ollama).

## Scorecard

| id | check | verify | w | source |
|---|---|---|---|---|
| SEC-01 | Every window has contextIsolation on and nodeIntegration off; no webSecurity:false, allowRunningInsecureContent, experimentalFeatures or enableBlinkFeatures | `web-contents-created` hook asserts prefs; static grep returns 0; electronegativity has 0 high findings | 3 | [Electron checklist](https://www.electronjs.org/docs/latest/tutorial/security) |
| SEC-02 | `sandbox: true` on every renderer | hook asserts sandbox; grep every `new BrowserWindow` | 3 | [checklist #4](https://www.electronjs.org/docs/latest/tutorial/security#4-enable-process-sandboxing) |
| SEC-03 | Strict CSP on every app page: no unsafe-eval, no remote scripts | Playwright reads CSP per URL; no Electron CSP warning | 3 | [checklist #7](https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy) |
| SEC-04 | will-navigate allowlist and setWindowOpenHandler deny-by-default on every webContents | E2E: location change and window.open are both blocked | 3 | [checklist #13-14](https://www.electronjs.org/docs/latest/tutorial/security#13-disable-or-limit-navigation) |
| SEC-05 | Every ipcMain handler validates the sender | handler count equals assertSender count; a forged sender is rejected in a test | 3 | [checklist #17](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) |
| SEC-06 | shell.openExternal only after URL parsing and an allowlist (https, mailto) | unit test rejects file:, javascript:, ms-msdt:, UNC paths | 3 | [checklist #15](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content) |
| SEC-07 | Preloads expose a narrow API, never raw ipcRenderer or generic channel wrappers | review of exposeInMainWorld; window has no ipcRenderer | 3 | [checklist #20](https://www.electronjs.org/docs/latest/tutorial/security#20-do-not-expose-electron-apis-to-untrusted-web-content) |
| SEC-08 | Permission request and check handlers on every session; only mic and display-capture, only for our origin | E2E: geolocation, notifications and midi are denied | 2 | [checklist #5](https://www.electronjs.org/docs/latest/tutorial/security#5-handle-session-permission-requests-from-remote-content) |
| SEC-09 | Local server listens on 127.0.0.1 only, uses a per-launch token, rejects foreign Host headers | Get-NetTCPConnection; `Host: evil.test` returns 403; no token returns 401 | 3 | [checklist #18](https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols) |
| SEC-10 | Electron is one of the 3 newest supported majors, pinned exactly | electron --version against the release timeline | 3 | [timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) |
| SEC-11 | Fuses: RunAsNode, NodeOptions and inspect args off; cookie encryption, ASAR integrity and OnlyLoadAppFromAsar on; file protocol privileges off | `npx @electron/fuses read --app Filow.exe`; `--inspect` opens no port | 3 | [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) |
| SEC-12 | ASAR integrity enforced; no executable code outside the ASAR unless it has a signed hash manifest (today the Next standalone app and server ship outside) | list *.js and *.node outside app.asar; tamper test | 3 | [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) |
| SEC-13 | No test hooks reachable in packaged builds (`okfilow-qa.flag` next to the exe currently enables QA switches) | create the flag and set the fake-mic env on a packaged build: nothing happens | 3 | [OWASP ASVS V14](https://owasp.org/www-project-application-security-verification-standard/) |
| SEC-14 | API keys stored with safeStorage (DPAPI), never in plain text | grep the profile for key patterns returns 0 | 3 | [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) |
| SEC-15 | Downloaded models and binaries over HTTPS with a pinned SHA-256; executables Authenticode-checked before spawn | a corrupted model is rejected and deleted | 3 | [OWASP A08](https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/) |
| SEC-16 | No interpolated shell or PowerShell commands; elevation only on explicit action; public tunnel opt-in, authenticated, time-limited, indicated | review every spawn; injection test with `'; calc; '`; no cloudflared on a fresh install | 2 | [OWASP command injection](https://owasp.org/www-community/attacks/Command_Injection) |
| SIGN-01 | Every shipped PE file Authenticode-signed (SHA-256 plus timestamp), with SmartScreen reputation | Get-AuthenticodeSignature on every file is Valid; clean-VM download shows no SmartScreen block | 3 | [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) |
| SIGN-02 | Updates over HTTPS, sha512 checked, same publisher required | an unsigned or foreign-signed update is refused | 3 | [electron-builder auto-update](https://www.electron.build/auto-update) |
| SIGN-03 | Staged rollout with a tested rollback | stagingPercentage drill | 2 | [staged rollouts](https://www.electron.build/auto-update#staged-rollouts) |
| SIGN-04 | An update never interrupts a live session | fake update-downloaded mid-session: no prompt | 3 | [electron-updater](https://www.electron.build/auto-update) |
| CR-01 | Native and JS crashes captured in all processes, with release tags and uploaded (not shipped) source maps | process.crash() leaves a minidump; no sourceMappingURL in the release | 3 | [crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter) |
| CR-02 | Recovery from a renderer or worker crash restores script position and ticks within 3 s (budget) | forcefullyCrashRenderer mid-session; state is identical after | 3 | [render-process-gone](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone) |
| CR-03 | Crash reports need consent and are scrubbed (no transcript, script, screenshots or username) | marker strings seeded before a crash appear 0 times in the payload | 3 | [GDPR Art 25](https://gdpr-info.eu/art-25-gdpr/) |
| CR-04 | Crash-free sessions of 99.5% or more per release | release-health numbers | 2 | [Sentry release health](https://docs.sentry.io/product/releases/health/) |
| PR-01 | Listening, tracking, overlay and slideshow all work fully offline | firewall-block the exe; a 10-minute corpus rehearsal passes | 3 | [GDPR Art 25](https://gdpr-info.eu/art-25-gdpr/) |
| PR-02 | In local mode the only connection is the update check; no telemetry before consent | pktmon capture; every host is on the allowlist | 3 | [GDPR Art 5](https://gdpr-info.eu/art-5-gdpr/) |
| PR-03 | Visible listening indicator whenever the mic is live | E2E: indicator matches the track's readyState | 3 | [W3C media capture](https://www.w3.org/TR/mediacapture-streams/#privacy-indicator-requirements) |
| PR-04 | OK Filow capture: consent naming each recipient, an indicator, and a local-only mode | Deny means no desktopCapturer call | 3 | [GDPR Art 13](https://gdpr-info.eu/art-13-gdpr/) |
| PR-05 | One control deletes all data; bounded retention; JSON/MD export | after Delete all, only settings remain | 3 | [GDPR Art 17, 20](https://gdpr-info.eu/art-17-gdpr/) |
| PR-06 | Prompter, overlay and OK Filow hidden from screen share (content protection) | Teams/OBS capture does not show the overlay | 3 | [setContentProtection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows) |
| A11Y-01 | Contrast 4.5:1 for text and 3:1 for UI and states, in every theme and in forced-colors mode | axe color-contrast finds 0 violations | 3 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| A11Y-02 | Full keyboard operation with no traps; single-key shortcuts can be remapped | keyboard-only Playwright run | 3 | [WCAG 2.1.1, 2.1.2, 2.1.4](https://www.w3.org/TR/WCAG22/) |
| A11Y-03 | Focus visible, not obscured, in a logical order | screenshot of every Tab stop | 2 | [WCAG 2.4.3, 2.4.7, 2.4.11](https://www.w3.org/TR/WCAG22/) |
| A11Y-04 | Every control has a name, role and value; Narrator reads checklist states | axe name and label rules; Accessibility Insights FastPass | 3 | [WCAG 4.1.2](https://www.w3.org/TR/WCAG22/) |
| A11Y-05 | Ticks announced through an aria-live polite region | DOM test plus Narrator | 2 | [WCAG 4.1.3](https://www.w3.org/TR/WCAG22/) |
| A11Y-06 | Reduced motion respected; auto-scroll can be paused | emulateMedia reducedMotion | 2 | [WCAG 2.2.2, 2.3.3](https://www.w3.org/TR/WCAG22/) |
| A11Y-07 | 200% zoom and reflow at 320 px lose nothing; targets at least 24 px | setZoomFactor(2) screenshots; axe target-size | 2 | [WCAG 1.4.4, 1.4.10, 2.5.8](https://www.w3.org/TR/WCAG22/) |
| PERF-01 | Cold start to interactive median 3 s or less; splash within 500 ms (budget) | 10 launches, median and p95 | 3 | [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) |
| PERF-02 | Memory grows 10% or less after a 10-minute warm-up over 45 minutes (budget) | getAppMetrics every 30 s, slope check | 3 | [getAppMetrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics) |
| PERF-03 | Idle CPU under 1%; listening 25% of one core or less (budget) | Get-Counter over 5 minutes; powercfg /energy | 3 | [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) |
| PERF-04 | Input to paint 100 ms or less, no long task over 50 ms, overlay at 60 fps | PerformanceObserver long tasks | 2 | [RAIL](https://web.dev/articles/rail) |
| STT-01 | Speech to partial transcript p50 300 ms or less, p95 700 ms or less (budget) | corpus with word timestamps | 3 | [Moonshine](https://arxiv.org/abs/2410.15608) |
| STT-02 | WER 10% or less clean, 18% or less at 10 dB SNR, per language (budget) | jiwer on the corpus | 3 | [Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard) |
| STT-03 | RTF 0.5 or less on a minimum-spec CPU; no queue growth over 45 minutes | audio seconds against processing seconds | 3 | [Open ASR Leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard) |
| STT-04 | Any mic (USB, Bluetooth, array); hot-plug recovers within 2 s | unplug mid-session; simulated devicechange | 3 | [W3C devicechange](https://www.w3.org/TR/mediacapture-streams/#event-mediadevices-devicechange) |
| STT-05 | Silence and fan noise give 0 ticks and fewer than 5 words over 5 minutes | negative-control corpus file | 3 | [Careless Whisper](https://arxiv.org/abs/2402.08021) |
| TRK-01 | Precision of point completion 0.95 or more | corpus runner against labels | 3 | competitor "jumps ahead" complaints |
| TRK-02 | Recall 0.90 or more, including paraphrased delivery | paraphrase corpus subset | 3 | [VoicePrompter](https://voiceprompter.app/blog/top-10-teleprompter-software.html) |
| TRK-03 | At most 1 false completion per 45 minutes; 0 for points never mentioned | negative-control script | 3 | [Slashdot reviews](https://slashdot.org/software/p/PromptSmart/) |
| TRK-04 | Tick within 2 s p95 of the covering words (budget) | corpus timestamps against the tick log | 2 | [Speakflow](https://www.speakflow.com/compare/bigvu) |
| TRK-05 | Recovery after a 60 s ad-lib, skip or jump back within 5 s; never runs ahead | scripted corpus scenarios | 3 | PromptSmart reviews |
| TRK-06 | Manual tick, untick and jump by hotkey, plus undo of the last automatic tick | E2E keyboard test | 2 | PromptSmart reviews |
| TRK-07 | Slideshow follower catches a slide change within 1 s (PowerPoint, PDF) | COM-driven E2E | 2 | [Speaker Coach](https://support.microsoft.com/en-us/powerpoint/rehearse-your-slide-show-with-speaker-coach) |
| I18N-01 | Every locale has every key with matching placeholders | key/placeholder diff script | 3 | [MS globalization](https://learn.microsoft.com/globalization/) |
| I18N-02 | No hard-coded strings; layouts survive 35% text growth | pseudo-locale screenshots | 2 | [pseudo-localization](https://learn.microsoft.com/globalization/methodology/pseudolocalization) |
| I18N-03 | Dates and numbers via Intl; STT language follows the script | unit tests; E2E with an Italian script | 2 | [ECMA-402](https://tc39.es/ecma402/) |
| INST-01 | Per-user install without admin; silent /S returns 0; no reboot | exit code on a clean VM | 2 | [MS package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements) |
| INST-02 | Quit leaves no child processes; uninstall removes files, keys, handlers, autostart and firewall rules, and asks about user data | registry and firewall diff before and after | 3 | [MS package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements) |
| INST-03 | Upgrades keep data; downgrade blocked or safe; appId decided on purpose (still `com.intelliprompter.app`) | install N-1, then N | 2 | [NSIS](https://www.electron.build/nsis) |
| INST-04 | No silent third-party installs (Ollama `/VERYSILENT`); consent dialog naming size and license | Decline means no child installer runs | 3 | [MS PUA criteria](https://learn.microsoft.com/defender-xdr/criteria) |
| TST-01 | Coverage 75% or more on core and tracking, 60% or more overall | vitest --coverage thresholds | 2 | [Google testing blog](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) |
| TST-02 | E2E against the packaged exe: onboarding, fake-mic session, ticks, overlay, slideshow, OK Filow | Playwright `_electron` suite | 3 | [Playwright Electron](https://playwright.dev/docs/api/class-electron) |
| TST-03 | Flake rate under 1% over 20 runs; quarantined tests have an owner | repeated runs | 2 | [Flaky tests at Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) |
| TST-04 | Corpus regression gate on every change: fail on a drop of more than 2 points | gauntlet against BASELINE.md | 3 | [ML Test Score](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) |
| TST-05 | Lint and typecheck with 0 errors and 0 warnings | typecheck plus eslint --max-warnings 0 | 2 | [TS strict](https://www.typescriptlang.org/tsconfig#strict) |
| SUP-01 | Lockfile installs; no `*` or `latest` ranges (`esbuild: "*"` in apps/desktop); registry signatures verified | grep plus `npm audit signatures` | 3 | [npm ci](https://docs.npmjs.com/cli/commands/npm-ci) |
| SUP-02 | 0 high or critical advisories in production dependencies | `npm audit --omit=dev --audit-level=high` | 3 | [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) |
| SUP-03 | Licenses compatible with GPL-3.0-or-later; notices shipped, including model licenses | license-checker failOn list | 3 | [GNU license list](https://www.gnu.org/licenses/license-list.html) |
| SUP-04 | CycloneDX SBOM and provenance on every release | cyclonedx-npm; gh attestation verify | 2 | [NTIA SBOM](https://www.ntia.gov/report/2021/minimum-elements-software-bill-materials-sbom) |
| SUP-05 | No secrets in the repo, history or artifacts | gitleaks detect and gitleaks dir | 3 | [gitleaks](https://github.com/gitleaks/gitleaks) |

## Known starting gaps (from a quick grep, confirm before acting)
- OK Filow's 3 windows lack an explicit sandbox (SEC-02).
- No fuses (SEC-11), no crash reporter (CR-01), no safeStorage (SEC-14).
- The Next app and server ship outside the ASAR (SEC-12).
- `okfilow-qa.flag` turns on test switches in packaged builds (SEC-13, `main.js:19`, `okfilow.js:43`).
- PowerShell commands built by string interpolation (`main.js:574`, `main.js:818`); a cloudflared spawn (`main.js:690`); a silent Ollama install (`localai.js:212`) (SEC-16, INST-04).
- `esbuild: "*"` (SUP-01); the legacy appId (INST-03).
