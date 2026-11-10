# Onboarding V2: first run to first take (track T3, 2026-11-10)

Goal (owner): a first-time user on a fresh install reaches a successful first take (speaking and seeing
script points tick) in a few minutes, without reading anything long, in Italian or English, by keyboard
or mouse, with clear recovery when something fails.

Measured with `tools/autoloop/e2e/onboarding.mjs` (packaged QA build, new empty profile per run, CDP
screenshots, native dialogs read and answered through UI Automation by `native-dialog.ps1`, axe-core
WCAG 2.0 to 2.2 A/AA, a keyboard-only pass, prefers-reduced-motion, 125 % and 150 % zoom). Screenshots:
`G:/FILOW/tmp/t3-shots/<round>/`. Speech model copied into the profile, Ollama with Clef Flash installed,
fake microphone playing T1's `take.wav`.

## 1. Baseline (main at e587213, build release-t3-aq, rounds r0-en, r0-it-kb)

| step | what the user meets | words | decisions |
|---|---|---|---|
| 1 | Welcome window: language drop-down plus 3 switches (startup, theme, accent), Get started | 71 | 4 |
| 2 | Splash, then native box "Run AI on this computer?": 22.8 GB, five model names (Nemotron, Whisper, Clef, Gemma, Qwen3-VL), Ollama. **It opens behind the splash** (screenshot r0-en/04) | 87 | 1 |
| 3 | Fresh PCs only (no "Filow" firewall rule): native box about Windows Firewall and phones, asked before the user has seen the app; admin prompt | 40 | 1 |
| 4 | Native box "Add Filow to PowerPoint?" with certificate jargon | 60 | 1 |
| 5 | Native box "Add your OpenRouter key": English even on an Italian system, tells the user to edit `.env` and restart; shown on **every** launch without a key | 24 | 0 |
| 6 | Main window: demo script about "decision models" (English in both languages), Screen Sense row, 13 controls in the bottom bars | 193 | 0 |
| 7 | Start take, then the Cloud / Local / Auto dialog ("keys in .env") | 127 | 1 |
| 8 | **The take fails**: "Failed to load worklet module script: blob:..." (CSP on main blocks the audio worklet; T1 has the fix in its worktree) | | |

- Clicks to start a take: 6 (7 on a fresh PC). Decisions: 7 (8). Words read before the take: 369 (409).
- Microphone: never checked before the take; a missing or blocked microphone shows up only as a take error.
- 3 of 6 baseline runs never reached the main window: after the local-AI answer the app sat on the splash for
  over 120 s (startup.log stops at "servers answering"; the next step is `offerFirewall`, which runs `netsh`
  synchronously). Cause not proven; 0 of 5 runs that went past the welcome stalled once the first-start firewall question was removed.
- Welcome at 125 % and 150 % zoom: the primary button is below the fold (page scrolls). Keyboard: focus
  visible on every stop. axe: 0 violations on welcome, main, start dialog. Reduced motion: 0 animated elements.

## 2. Patterns applied

One decision per screen with a working default; progressive disclosure (appearance options and the model
list behind "show more"); a visible progress indicator (rail stepper plus "Step n of 3"); try it before it
matters (a live microphone check in the welcome, not a failed take later); ask in context (firewall in the
pairing panel, which already offers it); plain words, no model names up front; every failure has a next
action (Try again, Open privacy settings, set up later from Settings); keyboard first (Enter continues).

## 3. Target flow (implemented, build release-t3-eq, rounds r4-*)

1. **Language** (step 1 of 3). One line on what Filow does, three large radio choices ("Same as this
   computer (English)", English, Italiano). "Appearance and startup" collapsed below. Continue.
2. **Check your microphone** (step 2). Starts listening on entry; a level bar; "Filow can hear you." after
   0.4 s of speech in total. Recovery: no microphone, blocked by the OS (button opens the OS microphone
   privacy page on Windows and macOS), busy, or nothing heard after 6 s, each with Try again. Never blocks:
   Continue always works.
3. **We picked the best setup for this PC** (step 3, the T2 slot). A card: setup name, memory, "Your voice
   and your script stay here", then one of: already installed (single "Start Filow" button), "one-time
   download of about N GB, continues in the background" (+ Ollama line) with "Download and continue" /
   "Not now", offline, or could-not-check. Model names only under "What gets installed".
4. Main window, Start take, first point ticks.

Reopened later from Filow > Welcome..., the same window is a plain Preferences page (language and the
three switches, Done). When the installer already chose the models, step 3 is left out. Closing the
window before step 3 keeps the old behaviour: the (now splash-owned) native question comes later.

### Measured result (r4-en mouse, r4-it-kb keyboard; same machine, same models)

| | baseline | V2 |
|---|---|---|
| clicks to start a take (mouse) | 6 (7 fresh PC) | 7: 3 welcome + PowerPoint + OpenRouter + Start + mode |
| keyboard-only welcome | 1 Tab-and-Enter | Enter, Enter, Enter (r4-it-kb: 11 keys incl. the Italian choice) |
| decisions before the take | 7 (8 fresh PC) | 4 (language has a default, setup, PowerPoint, start mode) |
| words, longest single screen before main | 87 (local-AI box) | 76 |
| words read before the take | 369 (409) | 433 (the two old boxes still cost 84) |
| native boxes before the take | 3 (4 fresh PC), one behind the splash | 2 (both outside T3, see section 5) |
| microphone checked before the take | no | yes, heard in 1.8 s |
| launch to welcome | 1.7 to 2.1 s | 1.5 to 2.4 s |
| welcome closed to main window | stalled 3 of 6 runs | 10.3 to 15.9 s, 0 stalls in 5 runs |
| Start take to first point ticked | take failed (worklet CSP) | 18.3 s (EN), 22.2 s (IT) with T1's CSP fix applied to the measurement build only |
| launch to first ticked point | never | 50.6 s (EN), 49.7 s (IT), probe-driven (includes about 10 s of probe overhead on dialogs) |
| primary button visible at 125 % / 150 % | no / no | yes / yes on all 3 steps, no horizontal overflow |
| axe violations | 0 | 0 (3 steps, light theme, main, start dialog) |
| reduced motion, animated elements | 0 | 0 |

Error states checked in the packaged app: microphone blocked (r4-fresh), no microphone and offline
(r4-offline), Ollama missing with nothing installed (r4-fresh: 22.8 GB plus Ollama line), light theme.

## 4. Interface for T2 (setup profiles)

The step reads `welcome:setupOffer` and answers `welcome:chooseSetup(boolean)` (apps/desktop/main.js,
`welcomeSetupOffer`). The offer is built by `apps/desktop/welcome-setup.js setupOffer()`:

```
{ ask, ready, downloadGb, needsOllama, labels: string[], device: "pc" | "mac", ramGb, online,
  profile: string | null, unknown? }
```

To plug in profiles, replace `localAiInfo().recommended` in `welcomeSetupOffer` with
`resolveSetup("auto", machine)` and pass:
- `profile`: the display name of the active profile ("Lite", "Standard", "Advanced"); the card then reads
  "{name} setup".
- `rec.models`: `choices.models` names. `ready`: no missing model with `use: "take"` (today: the speech
  model and Clef; on Lite, the matcher needs no download, so Lite is ready once speech is installed).
  `downloadGb`: `missingModels()` sizes.
- A non-blocking hardware probe: `hardwareScan()` runs PowerShell synchronously on the main thread (up to
  8 s) while the welcome is open.

`setupChoice()` returns the install choices main() already understands (`{ models, ollama }`, then
`/settings/local?auto=...`), or null.

## 5. Open, outside T3 ownership (proposed patches for the orchestrator)

1. Take blocked by CSP: `script-src` needs `blob:` for the audio worklet (T1 has it).
2. "Add your OpenRouter key" box in main(): local-first means no key is needed; remove it, or show it only
   when the user picks Cloud, translated, without `.env`.
3. PowerPoint box at first start: ask when PowerPoint is first used, in plain words (no certificate talk).
4. Start the servers while the welcome is open: today the splash starts after it (10 to 16 s measured).
5. First take: skip the Cloud / Local / Auto dialog when the picked setup is ready (start on Auto).
6. Default script: a short practice script in the UI language; the demo talk is English only.
7. Main window density (193 words): hide Screen Sense controls until it is used.

Not verified: a real fresh Windows PC without the firewall rule (the rule exists here); the OS privacy
page opening; macOS and Linux welcome; the "Download and continue" path end to end (no 22.8 GB download
was started from a probe); a screen reader pass (Narrator).
