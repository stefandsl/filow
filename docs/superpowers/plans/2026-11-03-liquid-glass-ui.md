# Liquid glass UI, prompter page: implementation plan

> **For agentic workers:** this plan is executed by Codex agents (`codex exec`) task by task, each followed by an adversarial reviewer. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the prompter page's points, preview, controls, bars and modals translucent layers of the window's glass, in dark and light theme, without losing any readability.

**Architecture:** all visual change lives in `apps/web/app/theme-tokens.css` (new glass tokens per theme) and `apps/web/app/globals.css` (rules per element). One small pure module computes contrast so a test pins the readability rule. One tiny client script sets the pointer-sheen variables on the dock. No layout or markup change except two wrapper class names.

**Tech Stack:** CSS custom properties, `backdrop-filter`, SVG `feDisplacementMap`, Next.js 15 app (`apps/web`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-liquid-glass-ui-design.md`

## Global Constraints

- Readability first: point text contrast >= 7:1 and muted text >= 4.5:1 over the raised/sheet tint composited on pure white and on pure black, both themes (spec "Readability rules").
- No `border` on glass layers; edges are an inner highlight plus a 1 px outer box-shadow at 6 to 10 percent alpha (spec "The material").
- No layout changes, no new dependencies, nothing copied from the two unlicensed reference repos.
- No motion, sheen or refraction on point rows or the preview; `prefers-reduced-motion` turns off sheen, refraction and enter animations.
- Fallbacks: without `backdrop-filter` the raised/sheet layers use `--panel` / `--panel-2`; without `[data-glass]` the page keeps its brand-glow backdrop.
- Font sizes and weights unchanged. Accent is never a text colour on glass.

## Review Focus

1. A pure white wallpaper under the dark theme: point text must still reach 7:1 (test in Task 1).
2. A pure black wallpaper under the light theme: same (Task 1).
3. A section with 30 points: rows 11+ must be flat (no blur) and still readable (Task 2 adds a test on the class rule, reviewer checks on screen).
4. A browser tab (no `[data-glass]`): nothing may be transparent down to an empty body; the brand glow backdrop must remain (Task 4 verification).
5. `prefers-reduced-motion: reduce`: no `pointermove` listener attached, no displacement filter (Task 3 test).

---

### Task 1: Glass tokens and the contrast gate

**Files:**
- Modify: `apps/web/app/theme-tokens.css`
- Create: `apps/web/lib/glass-contrast.ts`
- Test: `apps/web/lib/glass-contrast.test.ts`

**Interfaces:**
- Produces CSS tokens, each with a dark value under `:root` and a light value under `:root[data-theme="light"]`: `--glass-raised`, `--glass-sheet`, `--glass-flat` (rgba tints), `--glass-blur-raised`, `--glass-blur-sheet` (filter values), `--glass-highlight` (inner top highlight rgba), `--glass-edge` (outer 1 px shadow rgba), `--glass-shadow` (outer shadow for raised), `--glass-radius: 12px`, `--glass-radius-pill: 999px`.
- Produces `compositeOver(tint: {r,g,b,a}, backdrop: {r,g,b}) => {r,g,b}` and `contrastRatio(fg: {r,g,b}, bg: {r,g,b}) => number` (WCAG 2.1 relative luminance) and `parseRgba(css: string) => {r,g,b,a}` in `glass-contrast.ts`. The test reads the token values from `theme-tokens.css` with a regex, so the test fails whenever a tint is tuned below the bar.

- [ ] **Step 1: Write the failing test** `glass-contrast.test.ts`: for each theme (dark: text `#f7f7f5`, muted `#a4a8b3`; light: text `#08090b`, muted `#555e73`) and each layer (`--glass-raised`, `--glass-sheet`) and each backdrop (white, black): `expect(contrastRatio(text, compositeOver(tint, backdrop))).toBeGreaterThanOrEqual(7)` and `>= 4.5` for muted. Add one unit assertion: `contrastRatio({r:255,g:255,b:255},{r:0,g:0,b:0})` is `21` (to 2 decimals).
- [ ] **Step 2: Run** `npx vitest run apps/web/lib/glass-contrast.test.ts` and see it fail (module missing).
- [ ] **Step 3: Implement** `glass-contrast.ts` with the three functions above, and add the tokens to `theme-tokens.css`. Starting values: dark raised `rgba(19,21,26,0.84)`, sheet `rgba(27,30,38,0.74)`, flat `rgba(27,30,38,0.45)`; light raised `rgba(255,255,255,0.86)`, sheet `rgba(255,255,255,0.72)`, flat `rgba(255,255,255,0.45)`; blur raised `saturate(140%) blur(22px)`, sheet `saturate(130%) blur(16px)`; raise any alpha until the test passes.
- [ ] **Step 4: Run** the test and see it pass.
- [ ] **Step 5: Commit** `git add apps/web/app/theme-tokens.css apps/web/lib/glass-contrast.ts apps/web/lib/glass-contrast.test.ts && git commit -m "Glass tokens with a contrast gate"`.

### Task 2: Points, preview, bars, chips and modals as glass layers

**Files:**
- Modify: `apps/web/app/globals.css` (rules `.point`, `.point.started`, `.point.hot`, `.strip`, `.strip.onscreen`, `.strip.onscreen .fact`, `.chip`, `.modal`, `.modal-bg`, `.modal textarea`, `.source`, the `@supports (backdrop-filter)` block)
- Modify: `apps/web/components/Teleprompter.tsx` only to add the class `far` to point rows with index >= 10 inside `.points`.
- Test: `apps/web/lib/glass-css.test.ts`

**Interfaces:**
- Produces the layer classes used by Task 3: `.glass-raised`, `.glass-sheet`, `.glass-flat` as reusable rules (background from the token, backdrop-filter from the token, `box-shadow: inset 0 1px 0 var(--glass-highlight), 0 0 0 1px var(--glass-edge)` plus `var(--glass-shadow)` on raised, `border: 0`, radius from the token). `.point` composes raised, `.strip` and `.modal` compose sheet/raised, `.chip` composes flat, `.point.far` composes flat.

- [ ] **Step 1: Write the failing test** `glass-css.test.ts`: read `globals.css` as text and assert (a) no rule among `.point`, `.strip`, `.chip`, `.modal`, `.btn` contains `border: 1px solid`; (b) a `.point.far` rule exists and its block contains no `backdrop-filter`; (c) the `@media (prefers-reduced-motion: reduce)` block exists and sets `filter: none` for `.dock .btn::before`.
- [ ] **Step 2: Run** it and see it fail.
- [ ] **Step 3: Rewrite** the listed rules in `globals.css` per the spec: `.point` raised, `.point.started` keeps the strike-through and `--glass-sheet` tint, `.point.hot` gets `box-shadow` with `var(--accent-ring)` instead of a border, `.strip` sheet, `.strip.onscreen` sheet with an accent-ring shadow, `.strip.onscreen .fact` flat with no border, `.chip` flat pill, `.modal` raised, `.modal-bg` keeps its blur, `.modal textarea` and `.source` flat. Delete the old `@supports` block's per-element backgrounds and replace it with the three layer rules guarded by `@supports`; outside the guard the layers fall back to `--panel` / `--panel-2`. Add the `far` class in `Teleprompter.tsx` where point rows are rendered.
- [ ] **Step 4: Run** `npx vitest run apps/web/lib/glass-css.test.ts` and the full suite; both pass; `npm run typecheck` passes.
- [ ] **Step 5: Commit** `git commit -am "Points, preview, bars and modals as glass layers"`.

### Task 3: The dock, buttons, selects, sheen and refraction

**Files:**
- Modify: `apps/web/app/globals.css` (rules `.controls`, `.btn`, `.btn.primary`, `.btn.danger`, `.btn:disabled`, `select.btn`; new `.dock`, `.dock .btn::before`, `#filow-glass-filter`)
- Modify: `apps/web/components/Teleprompter.tsx` (add class `dock` to the first `.controls` element, the one holding Start take; add the inline `<svg>` filter definition once, hidden)
- Create: `apps/web/lib/glass-sheen.ts`
- Test: `apps/web/lib/glass-sheen.test.ts`

**Interfaces:**
- Produces `attachSheen(dock: HTMLElement, opts?: { reducedMotion?: boolean }) => () => void` in `glass-sheen.ts`: attaches one `pointermove` listener that sets `--mx` and `--my` (pixels relative to the dock) on the dock element and returns a detach function; attaches nothing and returns a no-op when `opts.reducedMotion` is true (callers pass `matchMedia("(prefers-reduced-motion: reduce)").matches`).
- The SVG filter id is `filow-glass-filter` (`feTurbulence` baseFrequency 0.012, numOctaves 2, `feDisplacementMap` scale 8).

- [ ] **Step 1: Write the failing test** `glass-sheen.test.ts` (jsdom not available: use a fake element with `addEventListener`, `removeEventListener`, `style.setProperty` spies): attaching registers exactly one `pointermove` listener; a dispatched event sets `--mx`/`--my`; the returned function removes the listener; with `reducedMotion: true` nothing is registered.
- [ ] **Step 2: Run** it and see it fail.
- [ ] **Step 3: Implement** `glass-sheen.ts`; in `globals.css` make `.dock` a raised pill bar (`--glass-radius-pill`, padding 8px 10px, same flex and wrap as `.controls`), `.btn` a flat pill with the inner highlight and no border, `.btn.primary` keeps `--action-background`, `.dock .btn::before` an absolutely positioned background layer carrying `filter: url(#filow-glass-filter)` and the sheen `radial-gradient(120px circle at var(--mx) var(--my), rgba(255,255,255,0.18), transparent 70%)`, `select.btn` the same look; `@media (prefers-reduced-motion: reduce) { .dock .btn::before { filter: none; background-image: none } }`. In `Teleprompter.tsx` add the `dock` class, render the hidden SVG filter once, and call `attachSheen` in an effect with the reduced-motion flag, detaching on unmount.
- [ ] **Step 4: Run** the full suite and typecheck; pass.
- [ ] **Step 5: Commit** `git commit -am "Controls dock with pointer sheen and refraction"`.

### Task 4: Verification on screen and in the package

**Files:** none new; evidence in `docs/superpowers/plans/2026-11-03-liquid-glass-ui-evidence.md`.

- [ ] **Step 1:** `npm run build -w apps/web`, then launch the desktop app (`npx electron .` in `apps/desktop`, `FILOW_USER_DATA_DIR` set to a throwaway profile with `welcomeCompleted: true`, `localAiOffered: true`) over a white, a black and a photographic wallpaper; screenshot the prompter in dark and in light each time (6 images) into `tmp/glass-evidence/`.
- [ ] **Step 2:** Open `http://localhost:4747` in a browser (no `[data-glass]`): the brand-glow backdrop is visible and every layer reads as glass over it; screenshot.
- [ ] **Step 3:** Run a take with `--show-fps-counter` for 60 s on the owner's laptop; record the lowest fps; must stay >= 55.
- [ ] **Step 4:** Write the evidence file listing each screenshot, what it shows, and the fps figure; note anything that fails the spec.
- [ ] **Step 5: Commit** the evidence file.
