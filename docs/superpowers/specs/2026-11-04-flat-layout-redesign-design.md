# Flat layout redesign of the prompter: design

## Owner amendment, 2026-11-05

The owner superseded the theme-dependent layout decision below: use ONE left-sidebar layout
in both themes, matching the light mockup's structure and using the selected theme's tokens.
Keep the same buttons and functions, accessible within two clicks. Remove the old layout
switch, tabs, right panel and width splitter. The next-section card below the points instead
resizes vertically from its bottom edge: pointer drag, ArrowUp/ArrowDown by 16 px, double click
to reset, 120 px minimum and 70 percent of content height maximum, with `prefs:nextHeight`
stored per viewer and re-clamped on window resize. Welcome and mirror are out of scope.
The remainder records the original 2026-11-04 design; this amendment takes precedence.

Date: 2026-11-04. Owner: Stefan Butnaru. Source: the owner's brief and two mockup images he supplied, kept at `docs/superpowers/specs/mockups/2026-11-04-prompter-dark.webp` and `...-light.webp`; his two decisions in conversation are marked "owner's call". Everything marked "my call" is the author's and can be overruled.

## Intent

Rebuild the prompter page's layout to the two mockups while preserving every existing function and the stack (Next.js app in `apps/web`, Electron shell in `apps/desktop`, shared packages). The mockups are flat: opaque surfaces, 1px subtle borders, one restrained accent. The frosted-glass material shipped in 0.9.23 is retired for the prompter (owner's call: "flat like the mockups"), and the window's acrylic/vibrancy is turned off.

## Owner's calls

1. **Two layouts, one per theme.** Dark theme = mockup 1: section tabs across the top, a right rail with "next section" and Screen Sense, a bottom action bar. Light theme = mockup 2: a left sidebar with the section list, "next section" under the points, Screen Sense as a row above the action bar. System theme follows the OS and gets the matching layout.
2. **Flat material.** No blur, no translucency, no acrylic. Surfaces separated by 1px borders and one tone step.

Author's note on 1: a theme switch now also moves the navigation, which users may find disorienting; it also doubles layout maintenance. Recorded, not changed.

## Goals

- Readable talking points first: the point text is the largest and highest-contrast element; never truncated, wraps to as many lines as needed.
- Clear section navigation visible at all times (tabs in dark, sidebar in light) with the current section marked by weight and a filled accent badge, not colour alone.
- One prominent "Avvia" (Start) button, filled accent, bottom-left of the action bar; it becomes "Ferma" (Stop) during a take with the same prominence.
- Presentation content (section title, points, next section, transcript) separated from Screen Sense controls (its own panel in dark, its own row in light).
- Less-used actions in an overflow menu ("⋯"): Ricarica copione, Azzera sezione, "Registro e segnalazione" (opens the existing log panel with Segnala un problema). Impostazioni is the top-bar gear in both layouts. Importa documento: dark layout = button at the right end of the section-tabs row; light layout = bottom of the sidebar together with Ricarica copione (then Ricarica is not duplicated in the overflow). Every existing action stays reachable within two clicks.
- Diagnostics ("Questo computer" with CPU/RAM/GPU and the model line, and "Chiamate · Media · Costo") in an expandable status strip at the very bottom, collapsed by default.
- Italian labels preserved (the i18n tables stay the source), presentation content untouched.
- Waiting, active (started/hot) and completed states distinct by icon and text as well as colour: waiting = clock icon + "In attesa" + empty bar; active = filled accent badge/left rule + progress bar filling; completed = check icon + strike-through text + muted row.
- Fits the existing window (1280 x 820 default, min 760 x 540) and scales up; no clipped controls, no truncated points at any width from 760 px.

## Non-goals

- No change to the engine, decisions, session protocol, settings keys, IPC, the welcome window, the PowerPoint pane or the browser extension.
- No new dependencies.
- The mirror page keeps its own layout (phone + overlay); it only drops the glass tokens.

## Anti-goals

- A layout that hides any current action (Abbina, Modifica punti, Importa, Ricarica, Azzera, Impostazioni, Precedente, Sezione successiva, Guarda lo schermo, Guarda ora, Seleziona zona, mode select, Trascrizione, Segnala un problema).
- Points that ellipsize or scroll horizontally.
- Colour as the only state signal.
- Any element clipped at 1280 x 820 or at 760 x 540 (the minimum): at the minimum, the sidebar/tabs collapse to a compact form rather than overflow.

## Structure

Shared across both layouts:

- **Top bar** (56 px): wordmark + tagline left; right: "Abbina dispositivo" (pair) button with a monitor icon, the pairing code chip when a session is live, language switch (IT/EN), theme toggle (sun/moon icon), settings gear.
- **Section title block**: a small "Sezione N di M" line (muted, no tracking) and the section title as the h1; under it "N punti da trattare" and the "Modifica punti" button with a pencil icon.
- **Points list**: numbered rows (01, 02, ...) on one surface each, text at the current point size (unchanged), state column at the right (icon + label + progress bar + percentage); dark mockup shows the state column inside the row with a vertical rule; light mockup shows the number in a bordered badge and the state text stacked at the right.
- **Next section block**: "Prossima sezione" label, the next section's title, its points as a bulleted list (two columns in the light layout when wider than 1100 px).
- **Transcript**: a collapsible row "Trascrizione" with the live text; collapsed in the dark layout it sits under the points, in the light layout it is a toggle in the action bar.
- **Screen Sense**: status chip ("Non attivo" / "Attivo"), "Guarda lo schermo" primary action (accent while active), mode select ("Bilanciato", ...), "Guarda ora", "Seleziona zona"/"Scansiona", and the overflow for the rest.
- **Action bar** (72 px, bottom): "Avvia" filled accent with a play icon; "Modalità" + mode select; right: "Precedente", "Sezione successiva" (outlined, arrow), overflow "⋯".
- **Status strip** (40 px, under the action bar): "Questo computer" with a chevron; expanded it shows the machine line and the CPU/RAM/GPU meters; right side the calls/latency/cost line.

Dark layout (mockup 1): section tabs row under the top bar (numbered badges 1..M with the title, current one filled accent), "Importa documento" at the right end of that row; main column left (title, points, transcript), right rail 420 px (next section, divider, Screen Sense panel).

Light layout (mockup 2): left sidebar 260 px ("Il copione" heading, "M sezioni", the section list 01..M with the current one on a tinted row with a 3px accent left rule; at the bottom "Importa documento" and "Ricarica copione"); main column (title block, points, next section card, Screen Sense row, action bar).

## Tokens (flat)

- Dark: background `#121212`, surface `#1a1a1a`, surface-2 `#222222`, border `#2c2c2c`, text `#f3f3f1`, muted `#a3a3a3`, accent `#ffb600` (the brand yellow), on-accent `#111111`.
- Light: background `#f6f7f9`, surface `#ffffff`, sidebar `#eef1f5`, border `#e2e5ea`, text `#111318`, muted `#5c6270`, accent `#ffb600` with on-accent `#111111`, current-row tint `#fff8e1`.
- Radius 10 px on surfaces and buttons, 8 px on badges; 1px borders everywhere a surface meets another; shadows none (one tone step instead).
- Type: Inter; h1 34 px / 700; point text unchanged from today; labels 13 px; buttons 15 px / 600.
- Contrast: text >= 7:1 on its surface, muted >= 4.5:1, accent button text >= 4.5:1 (the existing contrast test is re-pointed at these tokens).
- Motion: 150 to 200 ms on hover/press/expand only; `prefers-reduced-motion` removes it.

## Desktop shell

`apps/desktop/main.js`: the main window and the welcome window drop `backgroundMaterial`/`vibrancy` and use an opaque `backgroundColor` matching the theme (dark `#121212`, light `#f6f7f9`, from the saved theme at creation). The preload no longer passes `--filow-glass`; `[data-glass]` CSS is removed. The welcome window keeps its layout but on flat surfaces.

## Verification

- Screenshots of the prompter at 1280 x 820 in dark and light compared side by side with the two mockups; discrepancies in placement, order, sizes and spacing corrected until the structure matches (exact pixel parity is not required; element placement and hierarchy are).
- Screenshots at 760 x 540 (minimum) and 1920 x 1080: no clipping, no truncation, all actions reachable.
- The three states rendered (waiting, active, completed) in both layouts.
- Typecheck, full test suite, web build, PowerPoint build; the packaged Windows build launched on a clean profile before any tag.

## Calls made after the builder check (author's, the owner can overrule)

- States map to the engine: **waiting** = a point with no confidence yet (clock icon, "In attesa", empty bar, 0%); **active** = the engine's "hot" state, confidence rising (accent badge or left rule, bar = confidence percentage, "In corso"); **completed** = the engine's "started" (check icon, strike-through, muted row, bar full, "Detto"). Labels come from the i18n tables.
- Features the structure section did not place: the update banner and the error banner at the top of the main column; the Screen Sense observations strip (OnScreenStrip) and the missed-points strip under the points list in both layouts (light: above the next-section card); ResourcesPanel inside the expandable status strip; the log panel behind the overflow item "Registro e segnalazione"; the pairing request, start-mode and source-chooser dialogs stay modals as today.
- "Modalità" in the action bar is the start mode (the existing `ctl.auto` / backend select); the Screen Sense mode select ("Bilanciato") is a different control and stays with Screen Sense. Both keep their current labels.
- Compact form below 1000 px wide: dark tabs show only the numbered badges with the title as `title`; the dark right rail stacks under the points as a single column. Below 900 px the light sidebar becomes a 56 px rail of numbered badges (labels hidden, Importa/Ricarica as icon buttons with `aria-label`). At the 760 x 540 minimum nothing overlaps or clips; the points list scrolls vertically.

## Left to the builder

Exact spacing values within the token rules; the overflow menu's implementation (native `<details>` or a small popover) as long as it is keyboard-accessible; how the two layouts share components (one component tree with a layout switch is expected, duplicated markup is not).
