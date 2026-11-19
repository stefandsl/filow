# Owner decisions and historical evidence

Use the [PLAN Defaults Sheet](PLAN.md#defaults-sheet) for current product and release decisions and [METHODOLOGY.md](METHODOLOGY.md) for decisions about agent work.

## Release decision, 19 November 2026

D33 exception for 0.9.43: published as a preview before legal review of the children and classroom section; the policy states that this review is pending.

D33 applies to subsequent releases.

## Measurements and implementation facts

- **D23.** Six alternating packaged launches per variant measured a 0.33 s first visible splash window instead of about 1.1 s. The change delayed the logo and main window by about 0.15 s. The main window still appeared in 2.6 to 2.9 s. Chromium took about 780 ms to paint the 3.8 KB page. In the dark theme, Windows initially used `#202020` before the page painted `#121212`.
- **D24 and D25.** Public phone pairing can ask once because the page and relay use two tunnel hosts. LAN pairing no longer asks that question. Installing the Android companion requires a fixed HTTPS address. LAN use gives a home-screen shortcut. See [platform evidence](PLATFORMS.md).
- **D26 and D34.** On an 8 GB GPU with Clef Flash using 5.2 GB, local picture answers took 60 to 300 s. Point 3 ticked within one loop in four of five live takes and a loop late (100 s) once. Its same-party scores were 0.49 to 0.54 against 0.5. Six alternate phrasings and a lower threshold were rejected; false cases reached 0.46. See the [gauntlet baseline](gauntlet/BASELINE.md).
- **D28, D31, D35 and D36.** The cloud tracking prompt used the old wording and its measurement required paid calls. At this baseline the public link began at launch without its own outbound notice or signal. Consent given in the desktop UI was asked again in the PowerPoint and browser panes. OpenRouter maker pinning covered Google, OpenAI and Anthropic. See the [outbound inventory](okfilow/OUTBOUND.md).
- **D37 and D38.** SenseVoice measured 4.7% CER at 163 MB and carries custom FunASR terms. ReazonSpeech measured 8.2% at 713 MB under Apache-2.0. Romanian Parakeet measured 16.9% WER with phrase updates. Nemotron measured 29.9% with word updates. See [language evidence](stt/LANGUAGES.md).
- **D39 to D43.** Next credits the last six seconds of speech through `ANCHOR_RECENT_MS`. PageUp and PageDown navigate sections. One-use pairing codes can be spent when phones reconnect. Ctrl+Win dictation omits roughly the first 250 ms. On a failed paste, dictated words stay on the clipboard and replace its previous content.
- **D32, D33 and D45.** `com.intelliprompter.app` binds Windows installer and taskbar identity and macOS permissions, keychain and updates. The settings folder follows the package name. The privacy draft uses public GitHub issues and has unfilled policy fields. Releases 0.9.30 and 0.9.31 were copied by hand. The mirror workflow uses the `RELEASES_TOKEN` secret name. See the [release checklist](RELEASE-CHECKLIST.md) and [privacy draft](PRIVACY.md).
- **D13, D14 and D29.** The November 9 TRK-2 run moved nightly autoloop into its own branch and worktree. Roughly 60 old release directories were recorded in the November inventory. Historical WSL builds used 2.3 GB for build output and 850 MB for packaging output, plus the installed package.

## Tool setup

Pin external dependencies before enabling them. Record the source review and its outcome. Changes to the broader development environment require project-owner approval.
