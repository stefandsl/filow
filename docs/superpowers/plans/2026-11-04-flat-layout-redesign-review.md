# Independent flat-layout review

Reviewed 2026-11-04, baseline `9332c12`, implementation through `0801b69`.
Read AGENTS.md, HANDOFF.md, design, plan, commit stats and source diff independently.
The inventory below uses baseline Teleprompter line numbers on the left and final source line numbers on the right.

## Verdict and fixes

All original actions have a reachable replacement. Three confirmed UI defects fixed:

1. **P1: report required three clicks** (More, Log, Report). Added a direct Report menu item, retaining the log panel and its existing report button. `apps/web/components/Teleprompter.tsx:508`.
2. **P1: unload required three clicks with saved collapsed resources** (status, resources, unload). Embedded resources now use the outer status disclosure only, ignoring the nested collapse preference without erasing it. `apps/web/components/ResourcesPanel.tsx:66`, `:112`, `:125`; composition `Teleprompter.tsx:530`. Standalone compact resources retain their old toggle.
3. **P1: Italian Screen Sense mode select exceeded the dark rail**. Browser measurement at 1280 x 820: content clientWidth 1280, scrollWidth 1293, select right edge 1293. Constrain the select to its available width: `apps/web/app/globals.css:279`.
4. **P2: new-key test omitted ctl.mode**. Added EN/IT assertions at `packages/core/src/i18n.test.ts:4`. Both translations already existed; dropping the Italian entry now fails the test.

No failing static token pairs required colour changes. No known confirmed defect left unfixed in this review's checks. This is not screenshot or packaged/native acceptance.

## Action inventory

`T` = `apps/web/components/Teleprompter.tsx`; `P` = `apps/web/components/prompter/`.
Click counts describe access from the page with the action's original availability conditions met. Native file selection, typing and a sequence of choices inside an already-open workflow are not counted as extra navigation layers. A select itself is reachable within the count; picking an option follows native control behavior. Automatic dialogs are counted from their appearance. Disabled conditions (offline, unavailable backend, first/last section, busy import/translation) remain unchanged.

| Baseline T line / control or handler | Final location and path | Within two clicks? |
|---|---|---|
| 354 PairPanel / newCode | T:351; PairPanel.tsx:73 opens pairing, :87 regenerates code | Yes, 1 / 2 |
| 361 disable public link / setRemoteShare(false) | T:517, status disclosure then chip; also PairPanel.tsx:156 | Yes, 2 |
| 379 header stop watching | T:431 Screen Sense Stop; duplicate consolidated with old :555 | Yes, 1 |
| 385 theme light/system/dark / onTheme | T:352; LangSwitch.tsx:26 | Yes, 1 |
| 386 EN/IT / onLang | T:352; LangSwitch.tsx:16 | Yes, 1 |
| 397, 464 screen observations Look now / Forget | T:392; packages/ui/src/OnScreenStrip.tsx:55, :60 | Yes, 1 |
| 409 double-click markStarted/reopen | T:391; P/PointsList.tsx:16 | Yes, double click |
| 414 Enter/Space point toggle | P/PointsList.tsx:17 | Yes, keyboard |
| 450 missed point reopen / 452 Enter/Space | T:398, :400 | Yes, 1 or keyboard |
| 482 Stop / stopTake | T:474, filled primary action | Yes, 1 |
| 486 disabled Starting indicator | T:479 | Preserved, intentionally disabled |
| 490 Cancel / cancelStart | T:482 | Yes, 1 |
| 495 Start / requestStart | T:487 | Yes, 1 |
| 499 backend select / setChoice, auto and available backends | T:492 | Yes, direct select |
| 507 Edit / setEditing | T:386, below heading | Yes, 1 |
| 510 Previous / prevSection | T:501 | Yes, 1 |
| 513 Next / nextSection | T:502 | Yes, 1 |
| 516 Reset / resetSection | T:506, More menu | Yes, 2 |
| 519 Reload / loadScript | T:357 sidebar; T:505 dark More menu | Yes, 1 light / 2 dark |
| 522 Import / fileRef.click | T:356, section navigation in both layouts | Yes, 1 |
| 530 file input / importDocument | T:358, :363, native file picker | Yes, via Import |
| 532 Settings link | T:353, topbar gear | Yes, 1 |
| 540 Restart / installUpdate | T:371, update banner | Yes, 1 |
| 543 Later / setUpdateDismissed | T:374, update banner | Yes, 1 |
| 555 Stop watching | T:431 | Yes, 1 |
| 561 Watch / watchScreen | T:437 | Yes, 1 |
| 568 screen mode / setMode | T:444 | Yes, direct select |
| 577 Look now / lookNow | T:453 | Yes, 1 |
| 584 Region / captureRegion | T:460, desktop only as before | Yes, 1 |
| 589 Forget / forget | T:465 Screen Sense More; T:392 observations | Yes, 2 or 1 |
| 594 Export notes / exportNotes | T:466 Screen Sense More | Yes, 2 |
| 602 resources expand/collapse | P/StatusStrip.tsx:3 outer details replaces nested disclosure | Yes, 1 |
| 602 model unload callback | T:530; ResourcesPanel.tsx:106 | Yes, 2 after fix |
| 607 transcript display | T:409; P/Transcript.tsx:6 dark toggle; T:503 light toggle | Yes, 1 (new disclosure) |
| 622 Report / reportProblem | T:508 direct More item; T:415 retained log button | Yes, 2 after fix |
| 618 log display | T:507 More opens log; T:412 panel, :413 new close | Yes, 2 |
| 640 pair request Allow control / decidePair(controller) | T:545 automatic request modal | Yes, 1 |
| 643 Allow view / decidePair(viewer) | T:548 | Yes, 1 |
| 646 Reject / decidePair(reject) | T:551 | Yes, 1 |
| 658 start dialog cancel | T:563; T:613 backdrop, :655 Cancel | Yes, Start then Cancel |
| 659 start mode callback / setStartMode + startTake | T:564 | Yes, Start then mode |
| 716 auto recommendation / onPick(auto,remember,true) | T:621 | Yes, 2 |
| 728 Cloud / onPick(cloud,remember) | T:633 | Yes, 2 |
| 738 Local / onPick(local,remember) | T:643 | Yes, 2 |
| 745 remember checkbox / setRemember | T:650 | Yes, 2 |
| 747 fix setup Settings link | T:652 | Yes, 2 (also direct gear) |
| 708,709 backdrop cancel / stopPropagation | T:613, :614 | Preserved |
| 666 editor modal onCancel/onSave | T:571; saveScript at T:171 | Yes, Edit then action |
| 667 source chooser / chooseSource | T:572 | Yes, Watch then source |
| 763 chooser backdrop cancel / 764 stopPropagation | T:668, :669 | Preserved |
| 770 source buttons / onPick(source) | T:675 | Yes, 2 |
| 780 source Cancel / onPick(null) | T:685 | Yes, 2 |
| 673 imported editor cancel | T:578 | Yes, 1 once import completes |
| 674 imported editor save | T:579 | Yes, 1 once import completes |
| 829 editor backdrop cancel / 830 stopPropagation | T:734, :735 | Preserved |
| 838 script textarea / setText | T:743 | Yes, Edit then field |
| 840 Save / onSave(text) | T:745 | Yes, 2 |
| 843 Cancel | T:748 | Yes, 2 |
| 847 translation target select / setTo | T:752 | Yes, Edit then select |
| 854 Translate / translate | T:759; async handler T:712 | Yes, 2 to access; choosing target is workflow input |

PairPanel's nested actions were also audited: new code `:87`, network interface select/useInterface `:122`, allowFirewall `:139`, enable/disable/retry public link `:156`, close `:165`, backdrop dismissal `:77` and propagation guard `:78`. All are unchanged, reached by opening Pair then using the control (two clicks). Pair button unavailable while connecting or on relay error is pre-existing, not a redesign removal.

All non-UI handlers in the old composition are retained: script load/save/import, notes export, readiness/autoPick/requestStart/startTake, microphone probe, stop/cancel and teardown, transcription onTranscript/onError/onReady/onLog, update status, slideshow dispatch, offline notifications, engine stop/cost-cap cleanup, and logging. Only the intentionally retired attachSheen/dock pointer effect was removed. `git diff 9332c12 -- apps/web/components/Teleprompter.tsx` shows the business handler bodies unchanged.

## Requirements with source evidence

| Requirement | Evidence / verdict |
|---|---|
| One component tree | T:346 composition, SectionNav :355, PointsList :388, NextSection :429, ScreenSense :430, ActionBar :472, StatusStrip :510. CSS placement at globals.css:331 and :333. No duplicated dark/light page. |
| Resolved theme and system | layout.ts:2 maps dark to rail, light to sidebar. applyUiPreferences.ts:8 calls applyLayout alongside data-theme. LangSwitch.tsx:19 useUiTheme uses shared preference store; :31 subscribes to OS changes and :37 usePrompterLayout resolves the same state. UiPreferencesProvider.tsx:17 applies resolved theme; :26 handles matchMedia changes. Wiring is through the root provider, rather than an effect inside useUiTheme itself. Browser verified both explicit themes and both emulated system themes. |
| No glass remnants | Tracked production source scan of apps/web found no backdrop-filter, data-glass or filter:url effects. Only flat-css.test.ts:57 contains the forbidden spellings as negative assertions. Generated/ignored artifacts are not source. |
| Opaque native windows | main.js:283 welcome and :1596 main use uiTheme-selected #121212/#f6f7f9; uiTheme :1086 resolves saved/system. No backgroundMaterial/vibrancy/--filow-glass anywhere in main.js; preload.js and welcome-preload.js expose no glass property. |
| Three point states | pointState.ts:3; PointsList.tsx:10 percentage, :11 icons clock/circle/check, :12 translated labels, :13 state class, :20 label + icon. globals.css:259 active accent, :261 done muted, :262 strike-through; waiting empty progress. |
| Full point text | PointsList.tsx:19 renders entire text. globals.css:252 anywhere wrapping, min-width 0 and normal whitespace. No text-overflow declaration on point rules; mutation confirms gate. |
| Menu keyboard | OverflowMenu.tsx:5 Escape, :6 arrows/Home/End, :17 close restores trigger focus, :20 initial item focus, :25 blur closure, :32 menu, :33 menuitem. Browser confirms keyboard opening and Escape focus return in both themes. |
| Status collapsed initially | StatusStrip.tsx:3 details has no open attribute. Browser checked after fresh load. |
| EN/IT parity | i18n.ts:10 and :462 define all 14 additions, including ctl.mode; i18n.test.ts:4 includes omitted key after review fix. |
| No visible em dashes | No U+2014 matches in dictionary or prompter components; flat-css.test.ts AST scan covers main composition and shared UI strings. Dynamic user scripts/log/server errors are user/external content, not authored UI copy. |
| Tabular live numbers | globals.css:10 inherited tabular-nums; :209 reapplies to native fields/buttons; :256 point percentage; :284 statistics strip. Covers counters, confidence, model/resource metrics and costs. |

## Independent contrast calculation

Calculated directly from hex tokens using sRGB linearization and WCAG relative luminance, independently of the existing contrast helper. Thresholds: text 7, muted 4.5, on-accent 4.5. These are intended foreground/background pairs: on-accent is used on accent, not on dark surfaces; ordinary text/muted are not used on accent.

| Background | Dark text | Dark muted | Light text | Light muted |
|---|---:|---:|---:|---:|
| --bg | 16.862 | 7.427 | 17.334 | 5.701 |
| --surface | 15.665 | 6.900 | 18.581 | 6.112 |
| --surface-2 | 14.320 | 6.307 | 16.401 | 5.394 |
| --sidebar | 15.665 | 6.900 | 16.401 | 5.394 |
| --row-current | 14.320 | 6.307 | 17.490 | 5.753 |
| --accent, using --on-accent | 10.739 | n/a | 10.739 | n/a |

All pass. Token source: theme-tokens.css:17 (dark) and :46 (light).

## Mutation and verification evidence

- Removed SectionNav aria-current expression: test process exit 1; two SectionNav assertions failed. Restored original bytes.
- Added `text-overflow: ellipsis` to `.point`: exit 1; two PointsList assertions failed, two passed. Restored original bytes.
- Removed Italian `ctl.mode`: exit 1; bilingual key assertion failed. Restored original bytes.
- Workspace typecheck passed; full vitest root run passed (186 passed, one existing skipped test).
- Production web build passed. Used npm.cmd/npx.cmd equivalents because PowerShell blocks the npm.ps1 wrappers.
- Browser exercised dark/light, system switching, closed initial status, point keyboard toggles, More keyboard opening and Escape focus return. Resource fixture with saved collapse preference exposed Unload after one disclosure click; direct Report item invoked a mock callback in two clicks. No actual report sent and no model unloaded.
- Browser initial page-width tests passed at 1280 x 820 and 760 x 540; additional Italian internal-scroll measurement found the fixed select defect. Page-wide overflow alone was insufficient to catch it.
- Final rebuilt-page confirmation passed all eight EN/IT x dark/light x 760/1280 combinations with a 95-character heading and 256-character point fixture. Content scrollWidth equals clientWidth throughout; dark 1280 select is 371px within its 371px controls area. Fixtures changed browser DOM only, not the stored script. Final full tests and rebuild pass after the CSS fix.
- Temporary logs and reproducible mutation/browser scripts are in `tmp/flat-review/` (not committed). All review caches/profiles/logs stayed on G:. C: had 282,935,705,600 free bytes at entry.

## Detector (one invocation)

Exact requested .agents detector invoked once with all four requested targets. Two findings, both warnings:

| Location | Finding | Judgment |
|---|---|---|
| globals.css:233 | side-tab accent border, 3px | Retain: current sidebar section rule is explicit in the owner's design; aria-current, bold text and numbered filled badge supplement colour. |
| globals.css:259 | side-tab accent border, 3px | Retain: active point rule is explicit in the design; state icon, label and progress supplement colour. |

No other detector findings. No detector rerun after the measured select-width fix.

## Limits

Owner retains Task 6 screenshot comparison at 1280/760/1920 and all visual placement/hierarchy acceptance. No screenshots compared here. No packaged Electron launch, native material rendering, actual microphone take, cloud translation/import, screen capture/region picker, updater installation, real model unload or report submission executed. These paths were source-mapped; desktop reporting/resources additionally used browser fixtures. Pairing integration is unverified because the existing relay returned HTTP 401 (access password required). Active confidence state is covered by render/state tests, not live speech. No full assistive-technology or all-modal focus-order audit claimed.

AGENTS.md received an external memory-context edit during the review; it was not edited, reverted or staged by this reviewer. Existing untracked tmp files were preserved.
