# Flat layout corrections: visual evidence

Verified 2026-11-04 against both supplied mockups. Production web build served on
localhost:4790 with FILOW_SCRIPT=G:/FILOW/tmp/pkg-qa/script.md. Chromium captures
use CSS viewport sizes, Italian labels, and the in-app theme button. Explicit light
and dark preferences were selected; system mode was separately checked against both
emulated OS themes. No dependencies added.

## Captures

Files are under [output/playwright/flat-fixes](../../../output/playwright/flat-fixes/).

| Viewport | Dark | Light |
| --- | --- | --- |
| 1280 x 820 | [Dark](../../../output/playwright/flat-fixes/dark-1280.png) | [Light](../../../output/playwright/flat-fixes/light-1280.png) |
| 760 x 540 | [Dark](../../../output/playwright/flat-fixes/dark-760.png) | [Light](../../../output/playwright/flat-fixes/light-760.png) |
| 760 x 540, scrolled to Screen Sense | [Dark](../../../output/playwright/flat-fixes/dark-760-scrolled.png) | [Light](../../../output/playwright/flat-fixes/light-760-scrolled.png) |
| 1920 x 1080 | [Dark](../../../output/playwright/flat-fixes/dark-1920.png) | [Light](../../../output/playwright/flat-fixes/light-1920.png) |
| Three-state renderer fixture | [Dark](../../../output/playwright/flat-fixes/dark-states-fixture.png) | [Light](../../../output/playwright/flat-fixes/light-states-fixture.png) |

## Comparison and corrections

- Overflow now uses three visible circular paths and retains the localized More label.
- Both mode selectors use short bilingual labels; selected controls and individual
  options retain full descriptions in title attributes. All Screen Sense modes were selected.
- Transcript has no slash or empty placeholder text. Its toggle remains in the dark
  content area and the light action bar.
- Tabs stay on one line; only section names ellipsize. Full original headings remain
  in title attributes. Optional `Intro - Title` headings display their prefix separately,
  matching the mockup without changing the script or parser.
- Pair device uses a monitor icon and opens the existing dialog even without a session.
  A live code retains its own clickable chip. Theme is one button cycling light, dark,
  system, with the current icon and localized accessible name.
- Light has a measured 260px sidebar, tinted current row and 3px rule, bottom import/reload,
  title and right-aligned edit action, bordered point numbers, right-side state labels,
  two-column next-section points above 1100px, then Screen Sense and the action bar.
- First captures exposed excess vertical space around the next section. The second
  layout round removed the dark card frame/padding and tightened light row/card spacing.
  At 1280px Screen Sense ends at y=681 dark and y=705 light, above the action bar at y=707.
- At 760px the dark tabs become badges and the light sidebar becomes a 56px rail.
  Content scrolls vertically; controls stay reachable, and neither theme has horizontal
  page overflow. Point text wraps fully. At 1920px both layouts retain their hierarchy.

## Checks and limits

Passed `npm run typecheck`, `npx vitest run --root G:/FILOW` (186 passed, one existing
skip), and `npm run build -w apps/web`. Extended bilingual-label coverage passes.
Browser interaction checks passed in both themes: pairing dialog open/close, overflow
arrow navigation and Escape focus return, double-click completion and keyboard reopening,
mode switching, EN/IT, and system-theme layout following.

The three-state captures use server-rendered markup from the actual PointsList component
with fixture data inserted into the production page. They verify appearance, not live
speech recognition. Actual completion/reopening was also tested through the UI.
No live microphone, vision request, phone pairing, or packaged Electron run was performed.
The unavailable relay's dialog was tested; the live-code path was source-reviewed.
Desktop-only region capture remains in the dark panel and in the light overflow.

Remaining intentional differences: existing point typography is preserved, the actual
script's section names are retained, and the desktop-only region action is absent from
browser captures. At minimum height presentation content requires scrolling. Exact pixel
parity is not claimed; placement and hierarchy follow the mockups. No release was made.

The Playwright CLI exited with `Session closed`; captures and interaction checks used
the already installed Playwright library and Chromium directly, with temp/profile files on G:.
