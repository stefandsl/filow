# Flat layout release review fixes

Date: 2026-11-04. Source review: `tmp/codex/run-13-last.md` (release 0.9.24).
Visual target: `../specs/2026-11-04-flat-layout-redesign-design.md` and its two mockups.
No version bump, tag, release, dependencies or changes to the design target.

## Findings and corrections

1. **Short viewport:** a height-limited media query lets the page grow and scroll, with a
   240px minimum presentation area. It also removes the sidebar list's viewport-derived
   height cap in that mode. Normal-height layouts are unchanged. CSS assertions cover both
   grid templates, scrolling and minimum content height.
2. **Screen Sense overflow:** only the dark Screen Sense popover is left-aligned to its
   trigger, with viewport-bounded widths. The action menu retains its positioning. CSS
   assertions cover alignment and bounds.
3. **Cancelled startup:** each start has an identity, invalidated by Cancel, a new start
   or unmount. Readiness, automatic planning, microphone probing and backend startup check
   that identity after awaiting. Stale callbacks and failures cannot update a newer take;
   a late backend is stopped locally. Deferred-promise tests cover invalidation, replacement
   and late errors, with source assertions for all startup boundaries.
4. **Dialog focus:** Start, source chooser and script editor share a labelled native
   modal dialog. It sets initial focus, makes the background inert, wraps Tab/Shift+Tab,
   handles Escape and restores the opener. The Start button retains its DOM identity
   across probing and has an explicit restoration ref. SSR tests cover all three dialogs;
   unit tests cover modal lifecycle and keyboard boundaries.
5. **Import failure:** errors render above the points in a visible `role="alert"` banner,
   scrolled into view when needed, and clear on the next import. The prefix has EN and IT
   keys; diagnostic details are preserved. SSR verifies both translations and full text.
6. **Log close focus:** the action overflow exposes its trigger ref to the log panel.
   Closing the log focuses that trigger before unmounting. SSR and callback-order tests
   cover the panel and restoration sequence.

All existing action entries and callbacks remain in place, with the same one/two-click
paths. Point typography and full text are preserved. README behaviour notes are mirrored
in English and Italian.

## Verification

- `npm run typecheck`: passed across all workspaces.
- `npx vitest run --root G:/FILOW`: 200 passed, 1 existing skipped test.
- `npm run build -w apps/web`: passed.
- Production Chromium checks in dark and light at 1280x820, 760x540 and 380x270 CSS pixels.
  The last size reproduces the layout viewport of a 760x540 window at 200% zoom; browser
  chrome zoom itself was not changed. No horizontal page overflow or clipped point text.
  At the smallest size the presentation content grows to 1393px (dark) / 1580px (light).
- Each of the three dialogs: initial focus inside, 16 Tab and 16 Shift+Tab steps contained,
  Escape dismisses, focus returns to the opener. Checked in both themes. The first native
  implementation allowed focus to browser chrome at a boundary; explicit wrapping fixed it.
- Log open/close returns focus to the action overflow in both themes.
- At 760px, the dark Screen Sense menu spans x=16 to x=256 inside the x=0 to x=760 content
  container. Settings and Forget are visible. Screenshot inspected.
- A mocked failed import shows its announced error with the log closed.
- A delayed automatic plan response arriving after Cancel leaves Start enabled, opens no
  dialog and makes zero microphone calls.

Local captures are in `output/playwright/review-fixes/`: dark/light at all three sizes plus
`dark-screen-menu-760.png`. They were inspected against the mockup structure. Temporary
browser scripts and profiles remain on G:. The check server and isolated browser were stopped.

These are renderer checks with a synthetic script, mocked desktop source chooser, readiness,
vision and import responses. Live microphone/backends, OS capture, native packaged windows,
screen-reader speech and phone pairing were not exercised. Expected fixture HTTP 401/422
responses are not application regressions. Chromium required execution outside the process
sandbox after a sandboxed launch crashed. No release was attempted.
