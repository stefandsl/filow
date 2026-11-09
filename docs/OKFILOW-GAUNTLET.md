# OK Filow - HeyClicky parity gauntlet

Sources studied on 2026-11-07: heyclicky.com (features, FAQ, pricing), toolfolio.com/tools/heyclicky,
r/heyclicky_ and r/macapps threads, and the HeyClicky for Windows install on this PC
(`%LOCALAPPDATA%\HeyClicky`: settings.json, logs, agents/defaults.json, proactive.json).

## Milestones (2026-11-08)

Each milestone ends with every test passing, a check in the packaged app, and a commit on its own
branch, made only when the user says commit.

| Milestone | Scope | Status |
|---|---|---|
| M1 core verified | screenshot setting, answer log (opt-in, off by default, delete button), drawings that stay until Escape/Clear/next question, packaged check of 2D drawings; BUDDY-PLAN gaps: pointing accuracy on 20+ fixed targets, coordinate mapping tests at scale 1.25 and 1.5, offline blocks cloud ask/TTS/photo, OK Filow section in main Settings, gauntlet row 7 (circling while asking) verified | in progress |
| M2 | loop 5 fixes | planned |
| M3 | phases A and B | planned |
| M4 | phases C, D (with the local Ollama agent backend) and E | planned |
| M5 | phases F, G and H | planned |
| M6 | whiteboard I1 to I6 (docs/OKFILOW-WHITEBOARD.md) | designed |

Reviews use Claude subagents or local Ollama models, not Codex (quota nearly used up).

## Parity matrix

| # | HeyClicky behaviour (evidence) | OK Filow today | Target |
|---|---|---|---|
| 1 | Hold **Ctrl+Alt** and talk; it sees the screen (log: `talk Ctrl + Alt`) | done | keep |
| 2 | **Ctrl pressed twice** opens a text box near the cursor (log: `text Ctrl, pressed twice`) | typed box only inside the tray panel | double-tap Ctrl opens a quick-ask box at the cursor |
| 3 | **Ctrl+Win** dictation: talk, text is typed into the focused app; custom words, language (log: `Dictation] session started`, `dictation_custom_words`) | missing | hold Ctrl+Win, release -> transcript pasted into the focused app, clipboard restored |
| 4 | **Ctrl+Win twice** hands-free mode (log: `hands-free Ctrl + Win, pressed twice`) | missing | toggle: listens continuously, sends each question after a pause |
| 5 | Draws on screen while it talks: lines, circles, arrows, cards, timed to speech (log: `Drawing] line N`, `circle`, `timeline beat`) | single point with label | POINT + CIRCLE + ARROW + BOX + UNDERLINE, stroked in step with the answer |
| 6 | Drawing clears when the screen changes under it (log: `the screen changed under the drawing (click): clearing it`) | fades after 5.5 s | clear on click/keypress/app switch, otherwise keep while speaking |
| 7 | You can **circle something while asking** and it sees what you marked (welcome-page copy, log: `[Highlight] stroke`) | missing | drag with the mouse while holding the hotkey: blue highlighter stroke, sent to the model as "the user circled this" |
| 8 | Reads highlighted text (log: `highlight text: 226 chars`) | missing | selected text from the focused app goes with the question |
| 9 | Buddy cursor follows the mouse, colour setting (`cursor_color_hex`) | arrow buddy, amber | colour setting |
| 10 | Status "notch" at top-centre: thinking / listening (log: `notch present live:ActivityThinking 360x32`) | bubble near cursor | add a small top-centre status pill |
| 11 | Voice answers, speed setting, typed turns answer silently by default (`speech_speed`, `typed_turns_respond_with_voice:false`) | voice on/off | speed setting, typed asks silent by default |
| 12 | Memory: history and summaries across sessions (`HeyClickyHistory`, `OneBrain`) | in-memory 6 turns | persist history to disk, survive restarts, clear button |
| 13 | **Agents**: say "agent, ..." and a background job runs, writes files, reports back with artifacts (`agents/defaults.json` jobs, codex-home) | missing | "agent ..." starts a Codex/Claude CLI job in its own folder, progress in panel, artifacts opened when done |
| 14 | Onboarding tour that draws on screen | missing | first-run 3-step drawn tour |
| 15 | Launch at login, taskbar toggle, mic picker | Filow-level | mic picker exists; inherit Filow launch at login |

Out of scope (cloud account features): billing, Gmail/Notion connectors, proactive cards, remote tasks.

## Gauntlet loop prompt

```
You are bringing OK Filow (G:\FILOW, apps/desktop/okfilow.js + apps/web/app/okfilow + apps/web/lib/buddy)
to parity with HeyClicky, row by row from docs/OKFILOW-GAUNTLET.md.

Loop until every in-scope row is "done":
1. Pick the lowest-numbered row that is not done.
2. Write or extend a unit test for its pure logic (parser, hotkey state machine, geometry) first.
3. Implement it with the smallest change that fully solves the row. Local-first: nothing leaves
   the PC unless the user picked cloud. No paid API calls in tests. No em dash anywhere.
4. Gate: `npx vitest run apps/web/lib/buddy apps/desktop` green, `npx tsc --noEmit` in apps/web clean,
   `npm run build` in apps/web, `npx electron-builder --win --dir` in apps/desktop (never while
   another build runs on .next), packaged app starts and logs "okfilow: hold-to-talk hook started".
5. End-to-end check as the user would: drive the real packaged app; what cannot be seen
   (content-protected windows, microphone) goes on the user test list with exact steps.
6. Adversarial review of the diff by a fresh agent: hunt for hotkey collisions, clipboard loss,
   stuck listening state, overlay that blocks clicks, privacy leaks. Fix every confirmed finding.
7. Mark the row done in this file with the evidence (test name, log line, screenshot) and loop.
Stop only when all rows are done or a row is blocked on the user; then report the user test list.
```

## Status log

Loop 1 (2026-11-07):

| # | State | Evidence |
|---|---|---|
| 1 | done | `okfilow-gestures.test.ts` talk tests; log `okfilow: hold-to-talk hook started` |
| 2 | done | gesture `text:open` (test "tapping Ctrl alone twice"), panel opens at the cursor with the box focused |
| 3 | done | gesture `dictate:*`; `typeText` waits for all modifiers up, pastes, restores the clipboard |
| 4 | done | gesture `handsfree:toggle`; `createVad` test "hands-free VAD ends the question after a pause" |
| 5 | done | CIRCLE/ARROW/BOX/UNDERLINE tags, `buddy.test.ts` "drawing tags"; strokes animate one after another |
| 6 | done | uiohook mousedown/keydown clear drawings; overlays stay up while drawings show (45 s cap) |
| 7 | pending | code done (overlay takes the mouse while talking, strokes burnt into the screenshot); a real drag is not verified yet: the test tool hides Filow while it drags |
| 8 | done | UI Automation TextPattern (`okfilow-selection.js`), read when the talk starts; real check returned the Notepad selection verbatim |
| 9 | done | colour swatches, `--okf-ink` drives buddy, drawings, highlighter |
| 10 | done | top-centre status pill: Listening / Dictating / Hands-free / looking |
| 11 | done | voice speed 0.75-1.5x; typed questions answer silently unless turned on |
| 12 | done | history persisted (12 turns) in the panel's storage; "Forget this conversation" |
| 13 | done | `okfilow-agents.test.ts` incl. end-to-end run with a stand-in CLI; jobs list, open, stop |
| 14 | done | first-run welcome circles the tray icon and speaks once (QA log: `mode speaking`, settings `onboarded: true`) |

Adversarial review (fresh agent): 9 findings + 5 low, all fixed: start/stop race (pending stop), agent
output opened only if it is a document, "agent" trigger needs a wake word or a comma/colon, modifier
resync from event flags, session-safe resets, clipboard formats kept (restore skipped for files),
quoted CLI paths, IPC checks the page URL + navigation lock, provider defaults to local, mic closed
on errors, disable stops hands-free, noise-adaptive VAD, half strokes flushed, voice timer cleared.

End to end on the packaged QA build (`FILOW_OKF_QA=1`): hook starts, welcome plays once, Ctrl double
tap logs `gesture text:open` and the box takes keyboard focus (F24 foreground fix found and fixed in
this loop). Local model: Qwen3-VL 8B is now preferred; it hit the Back button at 800,180 (target
~789,190) where Gemma 4 e4b answered 827,27, and it drew `[CIRCLE:...]` unprompted.

User test list (needs a microphone and eyes on protected windows): hold Ctrl+Alt and circle
something while asking; hold Ctrl+Win and dictate into Notepad; tap Ctrl+Win twice for hands-free;
say "agent, make a one page PDF about X" and watch the Agents list.

Loop 2 (2026-11-07): voice paths end to end in the packaged app, without a person talking.
Test-build switches (off in normal runs): `FILOW_OKF_FAKE_MIC=<wav>` feeds a recording to the
microphone (Chromium fake capture), `FILOW_OKF_QA_SHOTS=<dir>` logs overlay state + saves overlay PNGs,
`FILOW_OKF_QA=1` makes the windows capturable. Recordings made with the Windows voice.

| Path | Result | Bugs found and fixed in this loop |
|---|---|---|
| Hold talk chord, ask by voice | heard, 2 screens captured, answered, buddy flew to the Start button (19,1058) with its label | `GENERATE_LOCAL_MODEL` was used as the vision model; overlay missed state sent while loading; Qwen "thinking" took minutes and returned empty (`think:false`, now 7-11 s warm); answers without tags (prompt examples + a narrow grounding follow-up); grid 1000 mapped one pixel off screen; overlays were cut to the work area so taskbar points were dropped; label clipped at screen edges |
| Hold Ctrl+Win, dictate | "Hello from okay Phillo" typed into a Notepad test file | Windows' keycode-0 mask key cancelled the chord; last words arrived after the 150 ms wait; `clipboard.availableFormats`/`readHTML` do not exist in this Electron (guarded) |
| "Agent, ..." by voice | job started, finished, announced (stand-in CLI, no credits) | speech has no commas: the singular "agent"/"agente" + request now counts, questions do not |
| Ctrl+Win twice, hands-free | listened, ended the question on the pause, asked, listened again | slow empty answer (same `think` fix) |
| Drawing | circle + label + bubble rendered in the real overlay (PNG checked) | circle label overlapped the bubble: now above the circle |
| Hook robustness | Windows refused hooks system-wide for a while (0x7E, even for plain Node) | retries, then Ctrl+Alt+O fallback, then a quiet retry every 30 s that restores hold-to-talk |

Known clash on this PC: HeyClicky itself (and Handy) also dictate on Ctrl+Win.
| Final build v9 | fallback Ctrl+Alt+O (hooks blocked system-wide): heard, answered, circle on the Start button with its label above and on screen | - |

Loop 3 (2026-11-08), after the user's own test ("I can't draw", "2D/3D drawings do not show", many "I didn't catch that"):
| Fix | Evidence |
|---|---|
| Speech language is detected (`auto`), answers come in the spoken language (was forced to the UI language) | HeyClicky 1.1.5 made the same change for the same symptom |
| Mouse highlighter: transparent pixels let clicks through even with mouse capture on; the overlay gets a 1/255 tint while the talk keys are held | needs the user's real drag to confirm |
| Row 16 new: cards with a real photo `[CARD:x,y:Title|text|photo]` (Wikipedia thumbnail, subject name only, never in offline mode) | packaged app: Piston card with photo + Crankshaft card stacked; `visuals.test.ts` |
| Row 17 new: 3D models (`model3d` block, 6 shapes, up to 40 parts) in a draggable, resizable window; outer parts turn see-through when parts sit inside; click a part = spoken question about it | packaged app: 8-part engine rendered as a cutaway; clicking the block asked and answered "The cylinder block is the main housing..." |

Loop 4 (2026-11-08), full re-test of build v15 on request ("test it for me, list what you can't"):
| Test | Result |
|---|---|
| Voice question, hold talk keys | PASS: heard, answered, circled the Start button with label |
| Card by request | PASS: card with a real Wikipedia photo |
| 3D model by request | PASS on function (10-part bicycle window opened); quality is weak with local Qwen3-VL 8B |
| Click a 3D part | PASS (earlier in loop 3): spoken answer about the part |
| Double-tap Ctrl | PASS: box opens with keyboard focus in "Or type a question" |
| Dictation, hold Ctrl+Win | PASS: text typed into a Notepad test file |
| Hands-free, tap Ctrl+Win twice | PASS: listens, ends on pause, answers, listens again; off again with a double tap |
| Agent by voice | PASS with a stand-in CLI (no credits) |
| Mouse highlighter | NOT TESTABLE by the assistant: the computer-control tool hides Filow (not granted) while it drags. Two real bugs found and fixed while trying: catching was applied before the overlays existed; overlays missed the state sent while their page loaded (now an overlayReady handshake) |

## Loop 5 - HeyClicky Windows 1.1.2 to 1.1.5 parity (2026-11-08)

Source: heyclicky.com/changelog?p=windows. Each row is reproduced in the packaged app before the fix.

| # | Fix | Status |
|---|-----|--------|
| 5.0 | 2D drawings (`drawing2d` block, validated shapes rendered as SVG in a card) | done: 5 tests; qwen3-vl:8b "draw a car in 2D" gave a valid 7-shape drawing (tmp/draw-car.png); packaged check pending |
| 5.1 | Answer style memory (shorter, yes/no first, simpler words), stored locally, shown and clearable in the panel | pending |
| 5.2 | Look at the current screen before the next step, never repeat done steps | pending |
| 5.3 | Captions at the bottom of the screen; closing the panel mid-answer keeps streaming as captions | pending |
| 5.4 | Speech-to-text never guesses the language; drop short noise in other languages | pending |
| 5.5 | Cloud safety refusal said plainly, offer to explain the idea | pending |
| 5.6 | Hide cursor: short goodbye and fade out, fade back in at the mouse | pending |
| 5.7 | Typing works in every OK Filow text box, also after overlay animations | pending |
| 5.8 | Settings switches do not look on when hovered | pending |
| 5.9 | Filow icon in Alt+Tab and taskbar; only real windows (panel, 3D) in Alt+Tab | pending |
| 5.10 | Chimes without crackle on Bluetooth and built-in speakers | pending |
| 5.11 | Voice never stuck on "speaking" (timeout and reset) | code + 2 tests: speechDeadline() caps both voice paths; missing end event not reproduced live yet |
| 5.12 | Decimal-comma locales (it-IT) and a clean fallback when WebGL is missing | pending |

## Loop 6 - full HeyClicky 1.1.1 to 1.1.5 feature set (plan, built one phase at a time)

Order: finish loop 5 and rebuild, then A to H. Every phase is reproduced, tested (suite + tsc + lint), rebuilt, checked in the packaged app, and drive mode, Chrome and agents also get an independent review. Local first, no silent cloud fallback, no paid calls in tests, nothing on C:.

| Phase | Scope | Status |
|-------|-------|--------|
| A | OK Filow window: resizable chat with full replies, documents, settings, agent-chat sidebar, light/dark, captions, live chat, no doubled long messages | planned |
| B | Memory: conversations across days and earlier screens in a conversation, stored locally under userData on G:, never uploaded in local mode | planned |
| C | Drive mode: asks first, acts on yes only; mouse, voice or Escape hands control back instantly; never types passwords, payment or IDs; confirms send/submit/delete/purchase; "Not now" remembered 30 min | planned |
| D | Agents/jobs: named jobs with own chat, Stop, steering, goal and rules notes, resume, history, screenshot on follow-ups, ride out brief errors, ask before doing more, arrow keys flip cards | planned |
| E | Chrome: agents in the user's browser in their own tab group; ask once, ask before uploading files, "always approve uploads" setting | planned |
| F | Routines by voice and in Settings > Routines; never drop the first words of a task | planned |
| G | Voices: multilingual speech, voice picker with previews, speech-to-text follows the user's languages | planned |
| H | Updates and onboarding: progress window, auto-install after 5 idle min, short tour, remaining-usage answer | planned |
| I | Desktop-wide smart whiteboard (docs/OKFILOW-WHITEBOARD.md, I1 to I6); agent drawings stay until dismissed via the same pinned-visuals state as OK Filow answers; board chord configurable (Ctrl+Shift+D is Chrome bookmark-all-tabs) | designed |
