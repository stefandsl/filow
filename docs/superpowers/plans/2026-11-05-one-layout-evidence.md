# One prompter layout, 2026-11-05

The owner's 2026-11-05 amendment replaces the two-theme layout design with the light
mockup's left sidebar in both themes. Dark uses the existing dark tokens. This change
does not alter the welcome window or mirror page and does not bump, tag or release.

## Implementation

- One tree: section sidebar, heading and points, transcript/log when open, next-section
  card, Screen Sense row, action bar, diagnostics. `layout.ts`, the resolved-layout hook,
  layout props, `data-layout`, the right aside, all theme-specific branches and selectors,
  `RailSplitter`, `railWidth` and their obsolete tests/strings are removed.
- Import and Reload always sit in the sidebar. Transcript always uses the action-bar
  toggle. Desktop region capture is in the Screen Sense menu. All other callbacks and
  availability conditions from `v0.9.26` remain in place.
- `NextSectionResize.tsx` resizes the card from its bottom edge with pointer capture,
  ArrowUp/ArrowDown by 16 px, and double click reset to 240 px. Cancellation/lost capture
  abandons the gesture. The focusable horizontal separator has translated EN/IT labels,
  `aria-controls` and current/minimum/maximum values. Content scrolls inside the card.
- `nextHeight.ts` clamps to 120 px and floor(content height * 0.7), giving the minimum
  priority if the available area is smaller than 172 px. `prefs:nextHeight` is local to
  the viewer and never published to the engine. Window/content resizes re-read and clamp
  the preference without overwriting it. Blocked storage retains an in-memory preference.
- Full point text, manual toggles, waiting/active/done states, the 24 px green done tick,
  green progress, pairing reopen, startup cancellation, import alerts and dialog/menu/log
  focus behavior are retained. Both README languages describe the new behavior.

## Function checklist against v0.9.26

Inventory source: `git show v0.9.26:apps/web/components/Teleprompter.tsx`, the tagged
`apps/web/components/prompter/` components, and the referenced PairPanel, ResourcesPanel,
LangSwitch and OnScreenStrip. Business handlers before the JSX and all workflow dialog
implementations are unchanged. Each checked row means source-preserved and reachable in
both themes. Runtime checks are distinguished below from source coverage.

Click counts describe access with the original availability conditions met. Scrolling,
typing, native file selection and choosing workflow values are not extra navigation
layers. Automatic dialogs are counted from their appearance. Native capabilities still
require their original desktop bridge, permissions, connectivity and configured backend.

| Checked | Function | Shared path and click count |
|---|---|---|
| [x] | Pair device; show current code/QR and countdown | Top bar Pair or code, 1 |
| [x] | New pairing code | Pair then New code, 2 |
| [x] | Network adapter selection | Pair then adapter select, 2 to access |
| [x] | Allow firewall | Pair then Allow, 2 |
| [x] | Public link enable/disable/retry and panel reopen after reload | Pair then link action, 2 |
| [x] | Stop public link from diagnostics | This computer then public chip, 2 |
| [x] | Close pairing panel/backdrop dismissal | 1 from open panel |
| [x] | Allow controller, allow viewer, reject pair request | Automatic request dialog, 1 |
| [x] | EN/IT language | Top bar, 1 |
| [x] | Light/dark/system theme cycling | Top bar, at most 2 to any choice |
| [x] | Settings | Top-bar gear, 1; Screen Sense menu, 2 |
| [x] | Direct section selection | Sidebar numbered/title button, 1 |
| [x] | Previous and next section | Action bar, 1 |
| [x] | Current section title/count, full points and point states/progress | Visible in main content |
| [x] | Point mark done/reopen | Double click, 2; Enter/Space keyboard equivalent |
| [x] | Missed points and reopen | Missed-point strip, 1 or keyboard |
| [x] | Next-section title, complete points and completed markers | Card below points |
| [x] | Resize next section; reset size | Bottom-edge drag/arrow keys; double click reset replaces old horizontal resizing |
| [x] | Import PDF/PPTX/DOCX/TXT/MD and import progress/errors | Sidebar Import, 1 to file workflow |
| [x] | Reload script | Sidebar Reload, 1 |
| [x] | Edit script and live section/point counts | Edit points, 1 |
| [x] | Save/cancel editor; Escape/backdrop close and focus return | Edit then action, 2 |
| [x] | Translation language and Translate with status/mismatch/errors | Edit then select or Translate, 2 to access |
| [x] | Imported-script preview, warnings, save/cancel | Automatic editor after import, 1 from preview |
| [x] | Start, starting status, cancel pending startup, stop take | Action bar, 1 |
| [x] | Automatic/manual transcription backend choice | Action-bar select, 1 to access |
| [x] | Auto/cloud/local readiness and start choice | Start then choice, 2 |
| [x] | Remember start choice, fix setup, cancel start dialog | Start then control, 2; setup also via direct gear |
| [x] | Transcript visibility/live text | Action-bar toggle, 1 |
| [x] | Reset section | Action overflow then Reset, 2 |
| [x] | Show log and close with focus restoration | Action overflow then Log, 2; close from log, 1 |
| [x] | Report problem | Direct action-overflow item, 2; retained button in open log |
| [x] | Watch screen/stop watching and recording status | Screen Sense row, 1 |
| [x] | Screen Sense off/slide-change/balanced/realtime modes | Screen Sense select, 1 to access |
| [x] | Look now/Scan | Screen Sense Scan, 1; same `lookNow` callback |
| [x] | Select/capture region and existing global hotkey | Screen Sense overflow then Region, 2; hotkey unchanged |
| [x] | Choose screen/window or cancel; dialog focus/Escape | Watch then source/cancel, 2 |
| [x] | Observations, unmentioned points, analysing state | OnScreenStrip under points |
| [x] | Observations Look now and Forget | OnScreenStrip, 1 |
| [x] | Forget screen | Screen Sense overflow, 2; observations button, 1 |
| [x] | Export accumulated notes | Screen Sense overflow then Export, 2 |
| [x] | Update checking/downloading/downloaded/error status | Status disclosure, 1; ready banner automatic |
| [x] | Install downloaded update/restart; Later | Update banner, 1 |
| [x] | CPU/RAM/GPU/model diagnostics and collapse/expand | This computer disclosure, 1 |
| [x] | Unload loaded model despite saved collapsed-resources preference | This computer then unload, 2 |
| [x] | Calls, average latency, cost/model and screen-frame cost | Status strip, visible |
| [x] | Slideshow follow/slide count, offline/backend/slow/plan status | Existing automatic handlers; details in status disclosure, 1 |

## Verification

- `npm run typecheck`: all workspaces pass.
- `npx vitest run --root G:/FILOW`: 204 passed, 1 existing skipped test, 35 passing files.
- `npm run build -w apps/web`: passes, including standalone asset preparation.
- Pure-helper coverage: minimum/percentage/rounding, short/invalid dimensions, missing or
  invalid storage, blocked storage fallback, persistence, shrink/grow restoration and reset.
  Component rendering checks both handle translations, semantic control attributes, full
  next-point text and completion. Existing engine, cancellation, pairing reopen, dialog,
  menu, log and contrast tests still pass.
- Served `apps/web/.next/standalone/apps/web/server.js` on `127.0.0.1:4790` with
  `FILOW_SCRIPT=G:/FILOW/tmp/pkg-qa/script.md`. Set `prefs:theme` to dark then light in
  localStorage. Production Chromium screenshots inspected against the light mockup's
  structure at 1280x820 and 760x540 in both themes.
- Sidebar widths: 260 px and 56 px respectively. Content heights: 651 px and 325 px.
  Default card: 240 px and 227 px respectively. Bottom actions stay within the viewport;
  content above them scrolls. No horizontal page overflow or point truncation. Point
  text/background resolve to the existing theme tokens. Button/select inventories are
  identical between themes except the current theme's accessible label.
- Both sizes/themes: pointer shrinking, ArrowUp/ArrowDown 16 px, inner scrolling, saved
  preference after reload, double click reset, shrink/grow restoration, double-click done,
  green tick, keyboard reopen, previous/next, editor Escape/focus, pairing open/close,
  reset and Screen Sense menu bounds all pass. The green tick measures 24 px in both
  themes, using `--ok` (#4ad67a dark, #14562b light).
- Desktop bridge/API mocks: Report, model unload despite `prefs:resourcesCollapsed=1`,
  region and Scan callbacks, source chooser, update restart/Later, and pairing toggle
  reload/reopen all pass in both themes. No real tunnel, model unload, update or report
  was triggered. EN/IT handle labels, both system color schemes, card DOM identity across
  theme changes, keyboard bounds, pointer cancellation and last-section unmount/remount
  also pass.
- Long-content GET-response fixture: full current and next-point text wraps without
  horizontal overflow in both themes at 760x540 and 380x270. Only next-card content scrolls
  internally; current points remain full-height within the page's scrolling presentation.
- The visual check caught a missing CSS token import during cleanup; it was restored
  before final verification, with a regression assertion. Final captures use correct tokens.
- Impeccable detector: three warnings for the existing specified 3 px accent rule on the
  current sidebar item and active point (the latter appears in two CSS rules). Retained
  because the owner-approved mockup explicitly requires these state markers.

Local captures: `output/playwright/one-layout/{dark,light}-{1280,760}.png`, with `-done`
and `-screen-menu` variants. QA scripts and machine-readable results are under
`tmp/one-layout-*`; these files and the isolated browser profile/cache stay on G:.

## Limits and cleanup

The existing relay on port 4748 rejects this isolated browser with HTTP 401. Actual phone
pairing, microphone/STT/model/vision inference, native screen capture, global hotkeys,
OS firewall/network changes, real update installation and packaged Electron were not run.
Their existing handlers were source-checked; desktop-specific access paths were additionally
exercised with mocks as described above. Active point rendering is covered by the existing
component/state tests, not live speech. No welcome or mirror visual acceptance is claimed.

The QA standalone server and isolated browser are stopped before completion. No tag, push
or release. An external claude-mem block appeared in AGENTS.md during the task; it was not
edited, reverted or staged by this work. Other pre-existing tmp files were left intact.
