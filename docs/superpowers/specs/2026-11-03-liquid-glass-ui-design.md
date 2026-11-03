# Liquid glass UI for Filow: design

Date: 2026-11-03. Owner: Stefan Butnaru. Written from a conversation with the owner; the "owner's call" items are his words, the "my call" items are the author's and he can overrule them.

## Intent

Filow's window is already frosted glass (acrylic on Windows 11, vibrancy on macOS, see `backgroundMaterial` in `apps/desktop/main.js` and `[data-glass]` in `apps/web/app/globals.css`). Everything drawn on it is still opaque: in dark mode the points and buttons are near-black slabs with drawn borders, in light mode flat white cards. The glass stops at the window edge and the content looks pasted on top. The owner wants the content to be part of the same material, in the spirit of three references he sent:

- oraoraoraaa/liquid-glass (no licence): tokens, frosted panels, a pointer-tracked "lens" sheen on controls, custom glass selects.
- SamirYMeshram/liquid-glass-ui-Portfolio-2 (no licence): glass built from an SVG displacement filter (refraction), a floating "liquid dock".
- guillaume-flambard/liquid-ui (MIT, unpublished, stale): component ideas only.

None of the three becomes a dependency and no file is copied from the two unlicensed repos. Techniques are reimplemented in Filow's own CSS.

## Goals

1. **Readable first** (owner's call, the one non-negotiable): the points are read from a metre away while speaking. Text contrast on every layer must stay at or above today's in both themes, over any wallpaper. Where glass and readability conflict, readability wins.
2. One material: points, the "next" preview, buttons, selects, chips, the Screen Sense bar, the status strip and modals are translucent layers of the window's glass, with no drawn 1 px borders. Depth, not contrast, carries hierarchy.
3. Both themes from one token set: milky glass on light, smoked glass on dark, system theme follows the OS as today.
4. Still works without the native material: in a browser, the phone mirror and the PowerPoint pane there is no acrylic behind the page, so the page keeps its own soft brand-glow backdrop and the same layers read as glass over it.

## Non-goals

- No layout changes: every element keeps its place and order on the prompter page.
- No new dependencies, no React component library, no runtime JS for the glass except the optional pointer sheen.
- Not touching the engine, the decision logic, the session protocol or the welcome window's behaviour.

## Anti-goals (failure even if it "works")

- Anything that moves, shimmers or refracts behind or near the point text during a take.
- Glass so transparent that a busy wallpaper shows through the point rows.
- A light theme that is only "dark theme with inverted colours": the two must each look right on their native desktop.
- Frame drops on a laptop on battery (backdrop-filter is expensive; see constraints).

## The material

Three depths, each a token set (background rgba, blur, highlight, shadow):

- **Raised** (the current section's points, the primary button, modals): strongest blur and most opaque tint. In dark `rgba(19,21,26,0.72)` and in light `rgba(255,255,255,0.70)` as starting values, to be tuned on screen; inner 1 px highlight `rgba(255,255,255,0.14)` top edge (dark) / `rgba(255,255,255,0.9)` (light); soft outer shadow.
- **Sheet** (the "next" preview, the Screen Sense bar, the status strip, selects, secondary buttons): lighter tint, same blur, fainter highlight, no outer shadow.
- **Flat** (chips, hints, the transcript line): tint only, no blur, no highlight.

Edges: no `border` property. The edge is the inner highlight plus a 1 px outer `box-shadow` at 6 to 10 percent alpha. Corner radius 12 px on raised and sheet, 999 px on chips and the dock.

Refraction (owner liked it in the references, my call on where): an SVG `feDisplacementMap` filter applied **only to the controls dock and to buttons**, never to the point rows or the preview. Strength small (scale 6 to 10). Behind `@supports (filter: url())` and off under `prefers-reduced-motion`.

Pointer sheen: a radial highlight that follows the pointer on buttons and the dock, implemented as two CSS variables (`--mx`, `--my`) set from one `pointermove` listener on the dock; off under `prefers-reduced-motion`; never on point rows.

The controls row (Start take, mode select, Edit points, sections, Reset, Reload, Import, Settings) becomes one floating raised bar, the "dock", full width of the content column, pill corners, with the same buttons inside; Settings may wrap to a second line inside the dock on narrow windows exactly as it wraps today.

## Readability rules (the owner's priority, made measurable)

- Point text: dark theme `#f7f7f5` on the raised layer, light theme `#08090b`; the raised layer's tint must give at least WCAG AA 7:1 against the text over a pure white and over a pure black wallpaper (test both with the window over a white and a black full-screen image).
- Muted text (eyebrows, WAITING, percentages) at least 4.5:1 on the same layers.
- No text sits on the bare window glass except the title line and the eyebrows; those get a 1 px text shadow in dark mode only if the contrast test above fails over a white wallpaper.
- The current point's tick and progress use the accent as today; the accent never becomes a text colour on glass.
- Font sizes and weights unchanged.

## Themes

`theme-tokens.css` keeps the authority: every glass token has a dark and a light value under `:root` and `:root[data-theme="light"]`; `data-theme="system"` resolves as today. Light-theme glass is white-based and warmer (a hint of the brand yellow in the glow), dark-theme glass is blue-black. The system accent colour from the welcome window keeps overriding `--accent` only.

## Fallbacks

- No `backdrop-filter` support: the raised and sheet layers fall back to today's opaque `--panel` / `--panel-2` colours (already present), so nothing becomes unreadable.
- No `[data-glass]` (browser, phone, PowerPoint pane): the page's own radial brand glow stays as the backdrop and the same layers apply.
- `prefers-reduced-motion`: no sheen, no displacement, no enter animations.

## Performance constraint

Each blurred layer is a compositing cost. Keep the blurred elements on the prompter page to: the point rows of the current section (at most the visible ones), the preview sheet, the dock, the Screen Sense bar, the status strip and one modal at a time. Chips and hints are flat. Verify in the desktop app with the Chromium frame counter (`--show-fps-counter`) while a take runs: no sustained drop below 55 fps on the owner's laptop.

## Scope and order

1. Prompter page (`apps/web/components/Teleprompter.tsx` via `globals.css` and `theme-tokens.css`): points, preview, dock, Screen Sense bar, status strip, modals, chips.
2. Settings pages and the overlay window: same tokens, no new patterns.
3. Welcome window (`apps/desktop/welcome.css`): same tokens.
4. Phone mirror and PowerPoint pane: inherit through the shared tokens; check only.

Step 1 is the deliverable the owner judges; 2 to 4 follow once he approves the look.

## Verification

- Screenshots of the prompter page in dark and light, each over a white, a black and a photographic wallpaper, before and after.
- The contrast checks above, written as a vitest test on the token values (compute contrast of text over the layer tint composited on white and on black).
- The fps check during a take.
- Typecheck and the full test suite green; the desktop package built and launched (per HANDOFF: dev launch proves nothing about packaging).

## Calls made after the builder check (author's, the owner can overrule)

- Contrast beats tint: the raised layer's alpha rises as far as needed (up to about 0.85 in dark, 0.88 in light) to reach 7:1 for point text over a pure white and a pure black wallpaper. The wallpaper is not meant to show through point rows.
- The contrast test composites the page's own rgba tint over pure white and pure black; the native acrylic only adds opacity on top, so this is the conservative measure. Screenshots are the visual check, the test is the gate.
- The displacement (refraction) filter is applied to a background layer (`::before`) of buttons and the dock, never to the element that holds the label, so text is never distorted.
- The dock is in flow, in the exact place and size of today's controls row, styled as one bar. It is not fixed or sticky and never overlaps the points.
- Blur budget: every row of the current section blurs; from the eleventh row on, rows use the flat layer. Completed and waiting rows differ by tint and the tick, not by blur.

## Left to the builder

Exact tint, blur and highlight values within the rules above; the displacement filter's noise texture; how the dock wraps on narrow windows; whether `.strip` and `.status` share one class.
