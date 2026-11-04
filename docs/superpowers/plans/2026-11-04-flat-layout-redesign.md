# Flat layout redesign: implementation plan

> **For agentic workers:** executed by Codex agents (`codex exec`) task by task, each followed by an adversarial reviewer and a screenshot comparison. Steps use checkbox (`- [ ]`) syntax.

**Goal:** rebuild the prompter page to the two mockups (dark = tabs + right rail, light = left sidebar) on flat surfaces, keeping every action and the stack.

**Architecture:** `Teleprompter.tsx` keeps its state and handlers and becomes the composition root; the markup moves into layout components under `apps/web/components/prompter/` (TopBar, SectionNav, PointsList, NextSection, ScreenSensePanel, ActionBar, StatusStrip, OverflowMenu). A `data-layout` attribute on `<html>` ("rail" for dark, "sidebar" for light, derived from the resolved theme) drives CSS Grid placement; the same component tree renders both layouts. Flat tokens replace the glass tokens; the desktop shell drops the acrylic.

**Tech Stack:** Next.js 15 app (`apps/web`), React 19, CSS custom properties + CSS Grid, Electron 45 (`apps/desktop`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-flat-layout-redesign-design.md` (mockups in `docs/superpowers/specs/mockups/`).

## Global Constraints

- Every action listed in the spec's anti-goals stays reachable within two clicks; the i18n keys in `packages/core/src/i18n.ts` are reused, new keys added in EN and IT together.
- Flat tokens exactly as the spec lists them; no `backdrop-filter`, no translucency, no `[data-glass]`.
- Contrast: text >= 7:1, muted >= 4.5:1, accent-button text >= 4.5:1 (the contrast test is re-pointed at the flat tokens).
- Point text size and weight unchanged; no `text-overflow: ellipsis` on points; no horizontal scroll.
- Three states by icon + text + colour: waiting (clock, "In attesa"), active (accent, "In corso", bar = confidence), completed (check, strike-through, "Detto").
- Motion 150 to 200 ms, hover/press/expand only; `prefers-reduced-motion` removes it. No em dashes in visible strings.
- No new dependencies. Do not touch AGENTS.md.

## Review Focus

1. A section title of 80 characters and a point of 200 characters at 760 x 540: wraps, nothing clips (Task 3 test on CSS rules + Task 6 screenshot).
2. Theme switch at runtime: the layout attribute changes with the resolved theme, including "system" following the OS (Task 2 test).
3. A script with 12 sections: the tabs row and the sidebar scroll, the current one stays visible (Task 2).
4. A take running: Avvia becomes Ferma, Screen Sense status chip updates, the status strip meters update without layout shift (tabular numerals) (Task 5).
5. Keyboard: tab order follows the visual order per layout; the overflow menu is operable with keyboard and closes on Escape (Task 5 test).

---

### Task 1: Flat tokens and the desktop shell

**Files:**
- Modify: `apps/web/app/theme-tokens.css` (replace `--glass-*` with the flat tokens from the spec: `--bg`, `--surface`, `--surface-2`, `--sidebar`, `--border`, `--text`, `--muted`, `--accent`, `--on-accent`, `--row-current`, `--radius: 10px`, `--radius-badge: 8px`)
- Modify: `apps/web/lib/glass-contrast.test.ts` -> rename to `apps/web/lib/contrast.test.ts` reading the flat tokens (`--surface`, `--surface-2`, `--sidebar`, `--row-current`, accent button) for text, muted and on-accent.
- Modify: `apps/web/app/globals.css` (remove the three glass layer rules, `[data-glass]`, the dock sheen, the SVG displacement filter; keep `.btn` states, focus ring, `::selection`, caret, scrollbar, icons)
- Modify: `apps/desktop/main.js` (both `new BrowserWindow` calls that set `backgroundMaterial`/`vibrancy`: remove them and `additionalArguments: ["--filow-glass"]`; `backgroundColor` from the resolved theme: `#121212` or `#f6f7f9`), `apps/desktop/preload.js` (remove `glass`), `apps/web/lib/glass-sheen.ts` and its test (delete), `apps/web/components/LangSwitch.tsx` (no `data-glass`)
- Test: `apps/web/lib/contrast.test.ts`, `apps/web/lib/glass-css.test.ts` -> renamed `flat-css.test.ts`

**Interfaces:** produces the token names above, used by every later task.

- [ ] Write the failing tests: `contrast.test.ts` asserts the ratios on the flat tokens for both themes; `flat-css.test.ts` asserts `globals.css` contains no `backdrop-filter`, no `data-glass`, no `filter: url(`.
- [ ] Run them, see them fail.
- [ ] Implement the token and shell changes.
- [ ] Run the full suite and typecheck; pass.
- [ ] Commit: `git commit -am "Flat tokens; acrylic window retired"`.

### Task 2: Layout switch and section navigation

**Files:**
- Create: `apps/web/lib/layout.ts` with `layoutForTheme(theme: "dark" | "light") => "rail" | "sidebar"` and `applyLayout(doc: Document, theme)` setting `document.documentElement.dataset.layout`.
- Modify: `apps/web/components/LangSwitch.tsx` (`useUiTheme` calls `applyLayout` after setting `data-theme`).
- Create: `apps/web/components/prompter/SectionNav.tsx` with props `{ sections: {id, title}[]; current: number; onSelect(index): void; layout: "rail" | "sidebar"; importAction: ReactNode; reloadAction?: ReactNode }`: renders the tabs row (rail) or the sidebar list (sidebar) with numbered badges, current one marked by `aria-current="true"` and the accent badge; compact below the spec's breakpoints via CSS only.
- Test: `apps/web/lib/layout.test.ts`, `apps/web/components/prompter/SectionNav.test.tsx` (render to string with `react-dom/server`: 12 sections -> 12 items, the current has `aria-current`, every item has the number and the title text, rail and sidebar variants both render the import action).

- [ ] Write the failing tests.
- [ ] Run, fail.
- [ ] Implement `layout.ts`, the hook change and `SectionNav` with its CSS in `globals.css` (grid areas: `rail` = top bar / tabs / main+aside / action bar / status; `sidebar` = top bar / sidebar+main / status with the action bar inside main).
- [ ] Run the full suite and typecheck; pass.
- [ ] Commit: `git commit -am "Layout switch per theme and section navigation"`.

### Task 3: Points list, states, next section, transcript

**Files:**
- Create: `apps/web/components/prompter/PointsList.tsx` with props `{ points: {id, text, state: "waiting" | "active" | "done", confidence: number}[]; layout }` rendering numbered rows, the state column (icon from `icons.tsx` + label + `<progress>`-like bar + percentage, tabular numerals).
- Create: `apps/web/components/prompter/NextSection.tsx` `{ title: string; points: string[]; layout }` (two columns above 1100 px in sidebar layout).
- Create: `apps/web/components/prompter/Transcript.tsx` `{ text: string; open: boolean; onToggle(): void }`.
- Create: `apps/web/lib/pointState.ts` with `pointState(bullet: {started: boolean; confidence: number}, hot: boolean) => "waiting" | "active" | "done"` (done when started; active when hot and not started; otherwise waiting).
- Test: `apps/web/lib/pointState.test.ts`; `apps/web/components/prompter/PointsList.test.tsx` (render to string: a 200-character point is present in full; each state renders its icon name and label; no `text-overflow` in the CSS for `.point`).

- [ ] Write the failing tests.
- [ ] Run, fail.
- [ ] Implement the three components and `pointState`, with CSS.
- [ ] Run the full suite and typecheck; pass.
- [ ] Commit: `git commit -am "Points list with three states, next section, transcript"`.

### Task 4: Screen Sense panel, action bar, overflow menu, status strip

**Files:**
- Create: `apps/web/components/prompter/ScreenSensePanel.tsx` `{ layout; active: boolean; children }` (panel in rail, row in sidebar; status chip + the existing controls passed as children in the order watch / mode / look now / region).
- Create: `apps/web/components/prompter/ActionBar.tsx` `{ start: ReactNode; mode: ReactNode; prev: ReactNode; next: ReactNode; overflow: ReactNode; transcriptToggle?: ReactNode }`.
- Create: `apps/web/components/prompter/OverflowMenu.tsx` `{ items: {id, label, onSelect, icon?}[] }`: a button `aria-haspopup="menu"` opening a `role="menu"` popover; arrow keys move, Escape closes, focus returns to the button.
- Create: `apps/web/components/prompter/StatusStrip.tsx` `{ summary: ReactNode; details: ReactNode; stats: ReactNode }` with a `<details>` element, collapsed by default.
- Test: `apps/web/components/prompter/OverflowMenu.test.tsx` (render: button has `aria-haspopup`, items render with `role="menuitem"`), `StatusStrip.test.tsx` (collapsed by default: `<details>` without `open`).

- [ ] Write the failing tests.
- [ ] Run, fail.
- [ ] Implement the four components with CSS.
- [ ] Run the full suite and typecheck; pass.
- [ ] Commit: `git commit -am "Screen Sense panel, action bar, overflow menu, status strip"`.

### Task 5: Compose the page

**Files:**
- Modify: `apps/web/components/Teleprompter.tsx`: replace the JSX with the composition of Tasks 2 to 4 (TopBar inline: wordmark, tagline, pair button, code chip, LangSwitch, ThemeSwitch, settings gear). Every existing handler and piece of state stays; the update and error banners go at the top of the main column; OnScreenStrip and the missed strip under the points; ResourcesPanel inside StatusStrip details; the log panel opens from the overflow item "Registro e segnalazione"; Avvia/Ferma in ActionBar; modals unchanged.
- Modify: `packages/core/src/i18n.ts`: new keys EN+IT: `ctl.more` ("More" / "Altro"), `ctl.logReport` ("Log and report a problem" / "Registro e segnalazione"), `nav.scriptTitle` ("The script" / "Il copione"), `nav.sections` ("{n} sections" / "{n} sezioni"), `section.counter` ("Section {n} of {m}" / "Sezione {n} di {m}"), `section.points` ("{n} points to cover" / "{n} punti da trattare"), `next.label` ("Next section" / "Prossima sezione"), `state.waiting` ("Waiting" / "In attesa"), `state.active` ("In progress" / "In corso"), `state.done` ("Said" / "Detto"), `status.thisComputer` ("This computer" / "Questo computer"), `screen.inactive` ("Not active" / "Non attivo"), `screen.active` ("Active" / "Attivo").
- Test: `packages/core/src/i18n.test.ts` (extend: every new key exists in both languages); `apps/web/components/Teleprompter.test.tsx` is not feasible without the engine, so the acceptance is the screenshot comparison of Task 6.

- [ ] Write the failing i18n test additions; run, fail.
- [ ] Implement the composition and the keys.
- [ ] Run the full suite, typecheck, `npm run build -w apps/web`; pass.
- [ ] Commit: `git commit -am "Prompter composed in the two flat layouts"`.

### Task 6: Screenshot comparison and corrections

- [ ] Build the web app, launch the desktop app on a throwaway profile with `welcomeCompleted: true`, at 1280 x 820, with the shipped sample script; capture dark and light.
- [ ] Place each capture next to its mockup (`docs/superpowers/specs/mockups/`) and list every placement, order, size and spacing difference; fix them; capture again (at most two rounds).
- [ ] Capture at 760 x 540 and 1920 x 1080 in both themes; confirm no clipping and all actions reachable; capture the three point states.
- [ ] Write `docs/superpowers/plans/2026-11-04-flat-layout-redesign-evidence.md` with the captures and the remaining differences.
- [ ] Commit the evidence.
