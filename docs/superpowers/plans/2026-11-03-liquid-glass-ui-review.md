# Independent liquid glass review

Reviewed implementation commits `54acecc`, `93b57bc`, `fc952a7` against the design and Tasks 1–3, not the implementation report. Line references below describe the reviewed tree including fixes. On-screen acceptance belongs to the owner.

## Confirmed defects and disposition

- **Fixed:** glass layers declared `border: 0`, contrary to the explicit no-`border` rule. Use `border-width: 0` to suppress native control borders without that shorthand. The previous test only rejected the exact text `border: 1px solid` and missed several selectors; the replacement parses CSS and rejects any `border` declaration on the material selectors.
- **Fixed:** `.label.linkish:hover` and `.settings a` still used `--accent` for text on sheets. Both now use `--text` (globals.css:113,135).
- **Fixed:** log, subtitle and section count had no material behind their text. They now compose the flat material (globals.css:196). Exempt bare title/eyebrow text had no dark-only shadow despite failing against white; the prescribed 1 px shadow is present (globals.css:247). This shadow is not a mathematical guarantee of contrast across a glyph; its appearance still needs owner inspection.
- **Fixed:** sheet highlights were identical to raised highlights, and blur differed despite the design's “same blur” rule. Added half-strength sheet highlights and matched the blur tokens (theme-tokens.css:28,62). The plan's 16 px sheet example conflicts with this design rule; the design wins.
- **Fixed:** generic `.strip` blur also blurred resources, missed points, empty-state and nested dialog panels. Only preview and Screen Sense strips now blur. Removed the additional full-screen modal-backdrop blur, and suppress underlying sibling dialogs and the header pairing dialog while an app dialog is present (globals.css:205,245). The plan's instruction to retain backdrop blur conflicts with the design's enumerated blur budget; the budget wins.
- **Fixed:** source/missed-item hover feedback still changed an invisible border colour. It now uses an accent-ring shadow (globals.css:59,146).
- **Fixed:** contrast tests hard-coded foregrounds without verifying their CSS token values. They now read and pin the actual foreground tokens (glass-contrast.test.ts:23).
- No failing tint found, so tint values were retained. No confirmed defect is intentionally left unfixed. Conflicting primary/secondary-button examples are recorded below rather than silently presented as literal compliance with both documents.

## Rule-by-rule evidence

Paths are relative to the repository. `CSS` below means `apps/web/app/globals.css`; `tokens` means `apps/web/app/theme-tokens.css`.

| Design rule | Actual implementation / verdict |
| --- | --- |
| Raised: most protective tint, strongest blur, top highlight and soft shadow | Raised points/modal: CSS:188,206; dock:217,224. Dark/light tints: tokens:25,59; 22 px blur, .14/.90 top highlights, soft shadows: tokens:28,62. **Pass for material layers.** Primary button deliberately retains the action background per Task 3 (CSS:69), rather than literally being raised glass. |
| Sheet: lighter tint, same blur, fainter highlight, no soft outer shadow | CSS:192,210; tokens:26,60. **Fixed:** same 22 px blur; separate half-strength highlights. Only the 1 px edge shadow remains. Dark sheet is lighter than raised; light raised/sheet both retain .92 white tint for readability rather than a distinct opacity hierarchy. The design allows tuning tint values. |
| Flat: chips, hints, transcript; tint only, no blur/highlight | CSS:196,201. **Pass:** no backdrop-filter or inset highlight. Busy/unsaid/hot states retain semantic accent-ring outlines. Buttons use flat tint plus a highlight, as explicitly required by Task 3 (CSS:62), rather than literally using the generic flat class. |
| No `border`; inner highlight and 1 px outer edge at 6–10% | **Fixed:** CSS:188,192,196,217; tokens:32,66 give .08 edge alpha. Mark-circle border (CSS:46) is an icon, not a material boundary; opaque nested start-mode cards and keycaps are also not glass layers. |
| Radius 12 px raised/sheet; 999 px chips/dock | **Pass:** CSS:189,193,200,219; tokens:34,35,68,69. Task 3 explicitly gives buttons pill corners as well. |
| Refraction only dock/buttons, scale 6–10, feature-gated | **Pass:** only `.dock::before, .dock .btn::before` receive URL filter (CSS:234). Teleprompter.tsx:460 defines turbulence and displacement scale 8. No point, preview or label-containing element receives displacement. |
| Pointer sheen: radial highlight, two variables, one dock listener, no rows | **Pass:** CSS:229; glass-sheen.ts:3–16. One `pointermove` listener reads geometry then sets local pixel coordinates on dock/buttons. No React state updates. |
| Dock full-width, in flow, same control order, wrapping allowed | **Pass at source level:** `.app` flex column (CSS:21), `.controls` flex/wrap (CSS:61), `.dock` relative and pill (CSS:217); Teleprompter.tsx:467. No fixed/sticky positioning. Exact size/wrap appearance remains unverified; Task 3 explicitly adds 8px/10px padding. |
| Point foreground #f7f7f5 / #08090b and >=7:1 at both extremes | **Pass:** tokens:7,49; CSS:10,38; independent calculation below. Completed rows intentionally use muted foreground and strike-through, as Task 2 requires (CSS:43). |
| Muted foreground >=4.5:1 | **Pass for the specified muted tokens:** tokens:8,50; point statuses/percentages CSS:48. Independent numbers below. Semantic success/error colours and disabled-control opacity are not the text/muted tint gate. |
| No bare text except title/eyebrows; dark-only 1px shadow when white fails | **Fixed:** flat metadata/log at CSS:196; dark title/eyebrow shadow at CSS:247. White-on-white bare title contrast is approximately 1:1, so the shadow condition applies. Physical native material and shadow appearance are owner checks. |
| Accent stays in tick/progress/indicators, never glass text | **Fixed:** no `color: var(--accent)` remains in globals.css. Existing semantic tick colour `--ok` remains (CSS:47); accent-ring indicators remain (CSS:45,69,102). Meter progress keeps its brand gradient (CSS:128). |
| Font sizes and weights unchanged | **Pass:** independently extracted all 65 `font`, `font-size`, `font-weight` declarations and compared, in order, to `git show HEAD~3:apps/web/app/globals.css` before this review commit. Identical; representative point typography CSS:41, status CSS:48, button CSS:66. |
| No backdrop-filter support: opaque panel/panel-2 | **Pass:** root-level defaults CSS:188,192,217; translucent raised/sheet backgrounds only inside support queries CSS:205,223. Started rows use panel-2 outside support query (CSS:203). Flat tint intentionally does not require blur. |
| No data-glass: retain page radial brand glow | **Pass at source level:** CSS:10–17 keeps opaque page base and two radial gradients; transparency only matches `[data-glass]`. Browser/phone/PowerPoint appearance is not asserted. |
| Reduced motion: no sheen, displacement or enter animations | **Pass:** CSS:238–242 removes both pseudo-elements' filter/background-image, disables descendant animations/transitions. `attachSheen` returns before registering anything (glass-sheen.ts:3); Teleprompter.tsx:87–99 listens for preference changes and detaches appropriately. The preference-change listener is not a pointer listener. |
| Blur only current rows, preview, dock, Screen Sense, status, one modal; chips/hints flat | **Fixed:** CSS:205,223 enumerate allowed layers, CSS:245 handles simultaneous dialog paint. Generic extra strips retain opaque fallback without blur. Modal backdrop no longer adds blur. |
| Eleventh row onward flat, completed/waiting same blur policy | **Pass:** Teleprompter.tsx:401,409 uses `i >= 10`; CSS:201,204 has flat backgrounds and no filter, CSS:206 excludes `.far`. CSS:214 changes completed tint only. First ten rows are the explicit design addendum's budget, not viewport virtualization. |
| No sustained <55 fps on owner's laptop during a take | **Unverified:** requires owner hardware, desktop frame counter and a 60-second take. Static selector checks cannot establish frame rate. |

## Independent contrast computation

Computed with a separate Python implementation, without importing `glass-contrast.ts`. Each channel is `alpha * tint + (1 - alpha) * wallpaper` in sRGB; WCAG linearization uses the .04045 breakpoint, luminance weights .2126/.7152/.0722, and `(Lmax+.05)/(Lmin+.05)`. No channel rounding before luminance.

| Theme | Layer | Wallpaper | Composite RGB | Text ratio | Muted ratio |
| --- | --- | --- | --- | ---: | ---: |
| Dark | Raised | White | 42.60, 44.40, 48.90 | 12.953 | 5.842 |
| Dark | Raised | Black | 17.10, 18.90, 23.40 | 17.338 | 7.820 |
| Dark | Sheet | White | 45.24, 48.00, 55.36 | 12.303 | 5.549 |
| Dark | Sheet | Black | 24.84, 27.60, 34.96 | 15.949 | 7.194 |
| Light | Raised | White | 255.00, 255.00, 255.00 | 19.920 | 6.492 |
| Light | Raised | Black | 234.60, 234.60, 234.60 | 16.649 | 5.426 |
| Light | Sheet | White | 255.00, 255.00, 255.00 | 19.920 | 6.492 |
| Light | Sheet | Black | 234.60, 234.60, 234.60 | 16.649 | 5.426 |

Every text ratio exceeds 7 and every muted ratio exceeds 4.5. These are tint-only measurements, not claims about rendered highlights, semantic status colours, disabled controls, or native wallpaper screenshots.

## Adversarial verification

Real source mutations, each applied separately, run against Vitest, and restored in a `finally` block with byte-for-byte equality checks:

1. Dark raised alpha `.90` → `.3`: contrast test assertion failed, exit 1.
2. Remove `.point.far { ... }`: flat-row test assertion failed, exit 1.
3. Add `border: 1px solid` inside `.point`: border test assertion failed, exit 1.

Local independent script and failure logs are in `tmp/glass-review/` (not committed). Final validation: workspace typecheck; complete Vitest suite (189 passed, 1 skipped); production web build. On Windows the equivalent `npm.cmd`/`npx.cmd` entry points avoid the system's PowerShell script-execution restriction. All new caches/temp data were directed to G:; C: had approximately 293 GB free at review start.

Unverified by agreement: six native wallpaper/theme screenshots, rendered fallback/glow, narrow-window wrapping, visual refraction/sheens and reduced-motion appearance, packaged desktop launch, phone/PowerPoint rendering, and the >=55 fps hardware acceptance. This review does not complete Task 4.
