# Scorecard status (items without an automatic check yet)

Updated 2026-11-10 by the autoloop. Status: `auto` = scored by score.mjs; `verified` = checked by hand
with evidence in JOURNAL.md; `open` = not done; `handoff` = in files owned by another session;
`needs user` = only the user can do it (money, accounts, hardware, a clean VM).
The stop condition needs every row `auto`-passing or `verified`.

| id | status | next step |
|---|---|---|
| SEC-01 | auto (SEC-1) + open | add electronegativity run as a check |
| SEC-02 | auto, passing 8/8 | - |
| SEC-03 | auto, passing | stronger: CDP probe for violations across pages (tmp/autoloop/csp-probe.mjs) as a check |
| SEC-04 | auto (SEC-5, weak) + verified 2026-11-10 | the static check passed while 4 of 5 main.js windows had no will-navigate guard; fixed (guardNavigation, unit test counts the windows). E2E by hand (tmp/autoloop/probe-sec04.mjs): promote it to a scored check |
| SEC-05 | auto, passing 48/48 | - |
| SEC-06 | auto, passing | - |
| SEC-07 | auto, passing (4 preloads, 140 functions, 94 fixed channels) | open note: `accessPassword` is exposed to the app pages by preload.js and okfilow-preload.js (safe only while SEC-04 keeps those windows on the app origin); `onOffline` returns no unsubscribe |
| SEC-08 | auto (file-contains, weak) + open | E2E 2026-11-10: geolocation and midi denied, but camera and notifications are granted (the handler allows all of "media"); the standard says only mic and display-capture |
| SEC-09 | open / needs user | Next server listens on 0.0.0.0 (LAN phone mirror by design): needs Host-header check and token on every route; design decision with the user for the LAN mode |
| SEC-10 | auto, passing (Electron 45.3.0) | check runs against the npm registry daily |
| SEC-11 | auto (SEC-4), 6 of 7 fuses | GrantFileProtocolExtraPrivileges needs splash/welcome/picker on a custom protocol first |
| SEC-12 | open | Next standalone + server bundle outside app.asar: hash manifest or move inside |
| SEC-13 | auto, passing | QA builds use -c.extraMetadata.filowQa=true |
| SEC-14 | auto, passing | - |
| SEC-15 | auto, passing 5/5 | macOS codesign path untested (needs a Mac) |
| SEC-16 | auto, passing | - |
| SIGN-01 | needs user | code-signing identity (Azure Trusted Signing, OV or EV) costs money |
| SIGN-02..03 | open | depend on SIGN-01 |
| SIGN-04 | verified 2026-11-10 (unit + packaged wiring) | no dialog or notification while a take or a slideshow is live; not covered: a take in the PowerPoint pane or an OK Filow voice question; a real update-downloaded needs an installed, signed build |
| CR-01 | auto, passing | - |
| CR-02 | auto (weak check), verified by CDP crash test | stronger check proposed |
| CR-03 | verified by design | dumps never uploaded; add a consent screen if uploads are ever added |
| CR-04 | needs user | release health needs real users |
| PR-01 | auto (take.mjs --offline), passing | offline take in the packaged app: 0 outbound from the app's process tree and from Ollama (netstat every 500 ms) and 0 external requests or TCP connects in Chromium's net log. Still open: the firewall-blocked 10-minute rehearsal of the standard |
| PR-02..06 | open | PR-03 listening indicator E2E; PR-05 delete-all control |
| A11Y-01, 04 | auto, passing | axe-core WCAG 2.2 A+AA over every shipped page (read from apps/web/app) in both themes: 0 violations |
| A11Y-06 | auto, passing | reduced motion: 0 elements move with the setting, 121 without |
| A11Y-07 | auto, passing | reflow: 0 pages scroll sideways at 640 and 320 px; the 200 px control overflows on 3 pages |
| A11Y-02, 03 | auto, passing | keyboard walk in a11y.mjs: 67 tab stops over 6 pages, ring and name at each, no trap, Enter/Space/Escape work. Not measured: Shift+Tab, "not obscured", logical order, the OK Filow windows themselves |
| A11Y-05 | auto, passing | the points list announces each tick ("Detto: ..."); Narrator by ear is still open, and the phone mirror and PowerPoint pane (packages/ui StageView) tick silently |
| PERF-01 | auto, failing | splash ~1.0 s (budget 0.5); main window 8-14 s: servers ~6 s, then the public-link hold ~6 s (user decision pending); start the link in parallel with the servers |
| PERF-02 | auto (take.mjs --minutes N), partial | 20-minute looped local take measured; credit scales to the 45-minute standard: run `node tools/autoloop/e2e/take.mjs --minutes 45` weekly |
| PERF-03..04 | open | CPU while idle; bundle size |
| STT-01..05 | open | corpus with word timestamps; WER with a jiwer-equivalent in TS |
| TRK-01 | auto, passing | 0 false completions (P1 merged 2026-11-09) |
| TRK-02 | auto, failing (recall 0.80) | raise recall to 0.9 without new false completions |
| TRK-03..07 | open | see docs/gauntlet/BASELINE.md |
| I18N-01 | verified 2026-11-09 | tools/autoloop/checks/i18n-parity.mjs: 0 problems (en, it); kept as a manual re-run, not scored (already passing) |
| I18N-02..03 | open | 2026-11-10: main.js dialogs no longer carry English-only sentences (guard test). Left: okfilow.js, localai.js and stt.js texts, save/open dialogs, the startup failure box; pseudo-locale screenshots; Intl helpers |
| INST-01..04 | open / needs user | clean-VM installs need a VM; INST-04 silent Ollama install needs a consent dialog |
| TST-01 | auto, ratchet 38% | raise coverage to 60/75 |
| TST-02 | auto for the fake-mic take (take.mjs), passing; rest open | onboarding, overlay, slideshow and OK Filow E2E against the packaged exe |
| TST-03 | open | 20-run flake check weekly |
| TST-04 | auto (file exists) | wire the gauntlet into the score |
| TST-05 | auto (gate), passing | eslint.config.mjs: typescript-eslint, react-hooks, Next core-web-vitals; npm run lint at 0 errors, 0 warnings |
| SUP-01 | auto, passing | add `npm audit signatures` |
| SUP-02 | auto, passing | - |
| SUP-03 | auto, passing | notices regenerated by npm run notices before a release |
| SUP-04 | auto, passing | attach SBOM to releases (needs the release flow) |
| SUP-05 | auto, passing | - |
