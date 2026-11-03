# Independent polish review

Reviewed `v0.9.22..c9eff8d` against `tmp/codex/brief-8-polish.md` and the liquid-glass design, then applied the fixes below. The implementer's report was not used as verification. References below describe the final reviewed source. P = prompter, S = settings, W = welcome, M = mirror and compact overlay. Every CSS conclusion covers dark and light; native rendering remains owner acceptance.

## Defects and disposition

All confirmed source defects found in this review are fixed in the single review commit:

- **Keyboard access:** clickable point `div`s and missed-item `span`s could not receive focus. Added role, tab stop, pressed state for points, and Enter/Space handling without replacing or reordering elements. Hot-point and busy-chip outlines no longer override the keyboard ring. See `apps/web/components/Teleprompter.tsx:411`, `packages/ui/src/StageView.tsx:68`, `apps/web/app/globals.css:42`, `:113`, `:194`. Point text deliberately stays still when activated (motion rule outranks the general active translation).
- **Contrast:** original light success text was 3.670:1 on glass over black; light warning text 4.545:1; dark warning text 4.755:1 in the worst case. They failed the requested 7:1 text gate. Corrected semantic tokens, primary gradient orange endpoint (6.748 to 7.180), recording badge (5.438 to 8.042), and arbitrary system-accent action backgrounds. Removed opacity from unavailable-mode containers so readable descriptions are not faded with their disabled controls. Disabled controls retain the explicitly requested 0.5 opacity and are excluded from the text gate.
- **Hover/selection pairing:** primary hover used the adjusted accent with a foreground chosen for a different background; selection had the same system-accent mismatch. Primary hover now uses the neutral hover layer and normal text; selection uses text/background tokens. Fields, plain links and actionable rows receive neutral hover too. See `globals.css:251`, `:260`, `:275`, `apps/desktop/welcome.css:57`, `:65`.
- **Typography:** native control font shorthands could reset tabular numerals; web selects could retain the UA family. Explicit control family/numeric rules and a body scale token now cover them (`globals.css:16`, `:273`; `welcome.css:70`). Placeholder text uses the gated muted token at full opacity (`globals.css:274`).
- **Residual glyph/test gap:** `StageView` still defaulted to a Unicode tick/circle. Mirror supplied SVG overrides, but other consumers still used the fallback. Defaults now use the same authored `Icon` set (`StageView.tsx:25`). Added a syntax-aware source test across the four surfaces and shared components; the previous new assertions did not guard icon regressions.
- **Residual label:** pairing dialog still used the deleted `.eyebrow` class. It now uses `.label` (`apps/web/components/PairPanel.tsx:79`).
- **Layout constraint:** reverted the polish pass's unrelated `flex-wrap: wrap` addition on `.topbar`; the dock's existing wrapping remains (`globals.css:20`). Removed duplicate `--unused` token placeholders.

No confirmed defect is knowingly left unfixed. Claims requiring native, populated runtime or visual acceptance are explicitly limited below. No dependency, preference key, IPC contract, AGENTS.md or engine decision logic changed. README.md and README.it.md describe the new keyboard equivalent of the existing point actions.

## Ten-rule matrix

“Fixed” means the submitted polish diff was incomplete; the review resolves it. “Pass (bounded)” means source plus the stated fixture checks pass, not that every runtime condition was exercised.

| Rule / verdict | P evidence | S evidence | W evidence | M evidence |
|---|---|---|---|---|
| 1. Plain informational labels: **fixed** | `Teleprompter.tsx:392`, `PairPanel.tsx:79`; `globals.css:30` | `settings/local/page.tsx:344`; resource label uses the shared style | `welcome.css:16`; `welcome.html:17` | `StageView.tsx:41`, `:91`; `globals.css:155` |
| 2. Scale, point readability, numeric stability: **fixed** | `theme-tokens.css:3`; `globals.css:10`, `:16`, `:35`, `:273` | Same global/control rules; `ResourcesPanel.tsx:44` live meter readings inherit tabular numerals | `welcome.css:3`, `:63`, `:70` | `globals.css:90`, `:157`; `StageView.tsx:150` counters inherit tabular numerals |
| 3. State colour and controls: **fixed** | `globals.css:245`, `:251`; point keyboard handlers `Teleprompter.tsx:414` | Same state vocabulary; selected radio labels `settings/local/page.tsx:442`; focus is on the actual input | `welcome.css:34`, `:55`, `:57`, `:68` | `mirror/page.tsx:161`; `StageView.tsx:71`, `:109`; shared focus/state rules |
| 4. Material depth: **pass** | `globals.css:179`, `:183`, `:187`, `:211` | `.settings .strip` shares raised; model rows share flat, `globals.css:179`, `:187` | `welcome.css:10`, `:21`, `:28`, `:32` | `globals.css:183` overlay sheet; `StageView.tsx:66` far rows flat except compact |
| 5. Spacing/wrapping: **pass (bounded)** | `globals.css:18`, `:34`, `:211`, `:263`; measured 8px points/dock gaps and 8px/12px dock padding | `globals.css:100`, `:102`; measured 12px row gaps | `welcome.css:9`, `:25`, `:26`; measured pane padding 32px, option gap 8px/20px, padding 16px/0 | `globals.css:89`, `:152`, `:154`; measured point gap 8px; content order preserved |
| 6. SVG icons / accessible names: **fixed** | `icons.tsx:3`, `:28`; `Teleprompter.tsx:421`; theme buttons `LangSwitch.tsx:23` | Shared theme switch; unload `ResourcesPanel.tsx:106` has aria-label | `welcome.html:20`, `:37`; `welcome.ts:8` mounts the shared paths; no icon-only button | Overlay close `mirror/page.tsx:161`; `StageView.tsx:25` defaults now SVG |
| 7. Copy, EN/IT, no em dash: **pass** | `i18n.ts:95`, `:231`, `:530`, `:664`; action names retained in dock | `settings/local/page.tsx:492` placeholder is a hyphen; localized recovery strings in i18n | `welcome.html:17`, `:28`, `:37` use i18n; existing save/startup recovery retained | `mirror/page.tsx:87`, `:101`; `i18n.ts:92`, `:527` localized recovery |
| 8. Browser surfaces: **fixed** | `globals.css:10`, `:260`, `:261`, `:270` | Inherits the same root and universal rules | `welcome.css:63`, `:64`, `:65`, `:68` | Inherits the same root and universal rules, including compact |
| 9. Bounded motion: **pass** | Only dock pseudo-elements carry sheen/refraction, `globals.css:224`; reduced motion `:232`, `:265`; pointer listener `Teleprompter.tsx:91` | No entrance/pulse; shared reduced-motion rules, `globals.css:209` | No authored entrance; `welcome.css:51`, `:66` disable transitions/press movement | No authored animation; shared reduced-motion rules; point activation does not translate text |
| 10. Product face: **pass in source; visual acceptance pending** | `Teleprompter.tsx:350`; unchanged vector wordmark | `settings/local/page.tsx:332`; unchanged vector | `welcome.html:14` and `:15`; `welcome.css:11` preserves aspect ratio and switches black/white variants | Pairing wordmark `mirror/page.tsx:110`; overlay brand location remains `:160` |

Unqualified component basenames in the table are under `apps/web/components`; settings and mirror are under `apps/web/app`; StageView is `packages/ui/src/StageView.tsx`; i18n is `packages/core/src/i18n.ts`; globals/theme tokens are `apps/web/app`; welcome files are `apps/desktop`.

Specific scan results:

- `letter-spacing` is zero throughout the scoped web/welcome styles; no `text-transform: uppercase` remains. EN/IT language abbreviations, CPU/RAM/GPU and the OFFLINE state are informational, untracked text, not decorative eyebrows.
- The counter is still **Section 1 of 4 / Sezione 1 di 4**; `i18n.ts:95`, `:530` and `ui-preferences.test.ts:5` verify both languages. P and M both render it; S/W have no section sequence to label.
- `git grep` for `☀ ◐ ☾ ✓ ✕ × → ←` found no remaining icon glyph in the scoped rendered strings after fixing StageView. Remaining repo hits are arrows in comments, dimension multiplication (`16×16`, capture width×height), and tests. Mac shortcut symbols are key names in `kbd`, not decorative icons. No visible em dash remains in tracked TS/TSX/HTML; remaining em dashes are the test patterns that prohibit them.
- All scoped icon-only buttons have aria-labels: theme trio, resource unload, overlay close. Buttons with SVG plus action text are named by that text. Welcome icons are aria-hidden; its start button has visible text. Icons use one 24-unit, 1.5px stroke set.
- No 1px `border` on a glass layer. The waiting mark's 2px circular border is an icon, and `border: none` declarations remove borders. Thin outlines identify actual state/selection; focus has the separate 2px ring. Inset highlights and one offset soft outer shadow are the material recipe, not duplicate card elevations.
- Accent remains on primary actions, selected controls, hot/unsaid/busy state, caret and keyboard focus. Decorative page glow, welcome feature accent and resource-bar gradient are removed. No accent-coloured body text. Brand assets themselves are unchanged.

## Independent contrast recomputation

WCAG sRGB linearization, luminance coefficients 0.2126/0.7152/0.0722, ratio `(Lhigh + .05)/(Llow + .05)`. Composite each final rgba layer directly over white/black, without rounding channels. No dependence on the implementer's reported numbers. Normal and semantic state text must reach 7; muted must reach 4.5. No new muted colour was introduced: dark `#a4a8b3`, light `#555e73`.

| Theme | Layer | Backdrop | Text | Muted | Success | Warning |
|---|---|---|---:|---:|---:|---:|
| Dark | Raised | White | 12.953 | 5.842 | 7.404 | 7.448 |
| Dark | Raised | Black | 17.338 | 7.820 | 9.911 | 9.969 |
| Dark | Sheet | White | 12.303 | 5.549 | 7.032 | 7.074 |
| Dark | Sheet | Black | 15.949 | 7.194 | 9.117 | 9.171 |
| Dark | Flat | White | 12.303 | 5.549 | 7.032 | 7.074 |
| Dark | Flat | Black | 15.949 | 7.194 | 9.117 | 9.171 |
| Light | Raised | White | 19.920 | 6.492 | 8.766 | 8.927 |
| Light | Raised | Black | 16.649 | 5.426 | 7.326 | 7.461 |
| Light | Sheet | White | 19.920 | 6.492 | 8.766 | 8.927 |
| Light | Sheet | Black | 16.649 | 5.426 | 7.326 | 7.461 |
| Light | Flat | White | 19.920 | 6.492 | 8.766 | 8.927 |
| Light | Flat | Black | 16.649 | 5.426 | 7.326 | 7.461 |

Hover: dark text/muted 12.823/5.784, light 16.080/5.240; success/warning minima 7.076/7.206 in light, 7.330/7.373 in dark. Primary gradient's minimum endpoint is 7.180. Recording badge is 8.042. Selection swaps `--text` and `--bg`, so has the same high contrast as normal text on the page. Tests also gate opaque panel fallbacks and sampled black/white/yellow/blue/gray/red/green system-accent action pairs at 7:1. Arbitrary system accents are blended toward the necessary pole before use as action backgrounds; preference values are untouched.

## Rendered structure and computed checks

Built temporary React SSR fixtures from **git show v0.9.22** and from the final sources using esbuild, with a two-section script, synthetic local settings status, inert session/STT adapters, EN/IT, dark/light. Rendered the resulting HTML in cached headless Chromium via CDP. Welcome uses the actual HTML with localized text and inline source CSS (its CSP is removed only in the temporary fixture). No screenshots or native acceptance were claimed.

Compared the entire ordered DOM tag tree of P, S, W, full StageView and compact StageView. All 20 language/theme/surface comparisons match after exactly two authorized normalizations: ignore SVG subtrees introduced as icon replacements and remove the redundant prompter eyebrow immediately before the section counter. Literal “same elements” is therefore **not** true: rule 1 explicitly removes one label node and rule 6 adds SVG/path nodes. No other element insertion, deletion or reordering was found in these fixtures. Source diff inspection covers the mirror pairing/overlay wrapper and conditional branches absent from the fixtures. The added topbar wrapping was reverted as unrelated layout drift.

Computed focus rings were `2px solid`, with focus-visible active, on every enabled/focusable fixture control: P 17, S 28, W 6, full M 5, compact M 2. All reported `tabular-nums`. Point sizes remained P 22px, full M 40px at the tested width, compact M 17px; weight 700 is preserved in source. The 13px counter uses `--type-sm` at the normal 16px root.

At 1024/1280, EN dock controls occupy one line; IT at 1024 wraps into seven plus two controls, and at 1280 occupies one line. The select's top is 1px above the buttons because of its intrinsic height, not a separate flex line. No singleton second line. Computed grouping gaps/paddings are the 4px multiples listed in rule 5. These are synthetic fixture measurements, not live-take or installed-font guarantees.

Temporary local evidence: `tmp/codex/render-polish-review.cjs`, `measure-polish-review.cjs`, `polish-render/measurements.json`, `review-mutation-uppercase.log`, `review-mutation-glyph.log`. They are not release assets or committed product files.

## Mutation checks, detector and validation

- Restored `text-transform: uppercase` on `.label`: focused CSS suite exit 1, exactly the quiet-label assertion failed. Restored original bytes in `finally`.
- Replaced the theme switch `<Icon name={icon} />` with `☀`: focused CSS suite exit 1, exactly the drawn-icon source assertion failed. Restored original bytes in `finally`.
- Clean focused suites: 56 passed. Final `npm run typecheck`: exit 0 across all workspaces. `npx vitest run --root G:/FILOW`: exit 0, 198 passed / 1 existing skipped test (23 passed / 1 skipped files). `npm run build -w apps/web`: exit 0, production output and standalone prepared. `npm run build:welcome -w apps/desktop`: exit 0. On Windows these used the equivalent `npm.cmd`/`npx.cmd` launchers because PowerShell blocks the `.ps1` shims. npm cache and TEMP/TMP were redirected under `G:/FILOW/tmp`; C: had over 272 GiB free at the initial check.
- The exact requested `.claude/skills/impeccable/scripts/detect.mjs` command was attempted once: **MODULE_NOT_FOUND**. No findings can be inferred from that failure.
- Ran the installed `C:/Users/Asus/.agents/skills/impeccable/scripts/detect.mjs` once with the six requested files: **`[]`, exit 0**. There are no individual findings to accept or reject. This is a substituted detector result, not a successful run of the missing path. The later body-scale binding and one-channel success-token adjustment do not add a new detector pattern. The empty detector output did not detect the keyboard, fallback-glyph or contrast defects; it is not an accessibility certificate.

## Remaining verification limits

Owner-only: on-screen dark/light judgement over white, black and photographic wallpapers; crisp native font/brand rendering; keyboard traversal with assistive technology; active takes and live telemetry; arbitrary long scripts/model names; native acrylic/vibrancy, packaged startup/update, and hardware FPS. Inter is first in the existing font stack but no Inter asset is bundled in this repository; actual availability on the owner's machine is unverified. Full mirror pairing, overlay drag/close integration, populated resource/model lists and modal interactions were source-reviewed, not exercised end to end in the static fixtures. The arbitrary-wallpaper gate applies to the protected material tokens; bare title lines retain the design's existing dark text-shadow exception and require the owner's wallpaper checks. No claim of an exhaustive visual or native acceptance pass.
