# Liquid-glass Operate polish

2026-11-03. Refines the incumbent materials, control order and product language. No settings keys, IPC, dependencies or engine behavior changed.

Implementation commits: `9c123e6` labels/copy; `08d3855` states/colour/depth;
`9c33f3e` icons; `5e43b19` typography/spacing/browser surfaces;
`7375e36` recovery-copy audit; `afd67ea` final state/spacing verification fixes.

## Rule evidence

Paths and line numbers refer to the final source tree. `CSS` below is `apps/web/app/globals.css`; `tokens` is `apps/web/app/theme-tokens.css`.

| Rule | Implementation and evidence |
| --- | --- |
| 1. Labels | The prompter renders just the informative section counter at `apps/web/components/Teleprompter.tsx:392`. EN/IT section and next labels are plain sentences at `packages/core/src/i18n.ts:95`, `:97`, `:530`, `:532`. Counter, next, Screen Sense, resource labels and footer use untracked 13px normal-case text at `CSS:30`, `:261`. Welcome's name remains plain orientation text at `apps/desktop/welcome.css:16`. |
| 2. Typography | Fixed rem scale with a 1.16 ratio: `tokens:3`. Inter remains the family at `tokens:52`; the scoped stylesheet no longer uses the monospace family. Point text remains 22px/700 at `CSS:34`, with the existing mirror fluid size and compact 17px preserved at `CSS:89`, `:156`. Inherited tabular numerals cover timers, percentages, counts and resources at `CSS:10` and `apps/desktop/welcome.css:63`. Muted contrast remains gated at 4.5:1 by `apps/web/lib/glass-contrast.test.ts:27`. Scale, tracking, numerals and browser tokens are tested at `apps/web/lib/glass-css.test.ts:7`. |
| 3. State and colour | Decorative accent backdrop, feature-icon colour, hover halos and resource gradients removed. Neutral hover steps are declared for dark/light at `tokens:47`, `:83`. Shared web controls use 180ms ease-out background/shadow/transform/opacity transitions, pressed translation, pointer and disabled states at `CSS:244`. Welcome follows the same vocabulary at `apps/desktop/welcome.css:55`. Keyboard focus is 2px with 2px offset at `CSS:269` and `apps/desktop/welcome.css:68`; selection/danger outlines yield to keyboard focus at `CSS:64`, `:82` and welcome CSS `:34`. Existing loading text and disabled controls remain intact. |
| 4. Depth | Raised/sheet elevation is composed once at `CSS:178`, `:182`; offset soft shadows are tokens at `tokens:45`, `:46`, `:81`, `:82`. The dock uses a 12px card radius at `CSS:210`; pills remain on small controls. Opaque fallbacks and the established blur budget remain at `CSS:197`. Welcome uses the same materials at `apps/desktop/welcome.css:10`, `:22`, `:44`. Semantic outlines indicate state rather than elevation. |
| 5. Spacing | Computed prompter values: app gap 16px, topbar gap 16px, point gap 8px, point padding 8px/12px, dock gap 8px and padding 8px/12px. Heading margin is 16px above / 8px below (`CSS:31`); welcome heading is 24px / 12px (`apps/desktop/welcome.css:17`) and option padding is 16px (`:28`). Dock button padding is 8px/4px at `CSS:262`, retaining order. At 1024px EN fits all nine controls; IT wraps seven plus two. At 1280px both fit all nine. No horizontal overflow or orphan in either theme. Resource chip spacing is 8px at `apps/web/components/ResourcesPanel.tsx:104`. |
| 6. Icons | One authored 24-unit, 1.5px SVG set at `apps/web/components/icons.tsx:4`, `:30`; welcome mounts those same paths at `:36`. Theme, point tick, close, progress, resource and navigation symbols use SVG. Overlay close has a translated aria-label at `apps/web/app/mirror/page.tsx:161`; theme labels remain at `apps/web/components/LangSwitch.tsx:24`. Mirror supplies the same icons to shared StageView at mirror `:165`, `:169`. Welcome hosts are at `apps/desktop/welcome.html:20`, `:37`. Redundant arrows were removed from translated action names. |
| 7. Copy | EN/IT dictionaries have no authored visible em dashes or arrow glyphs. Counter and preview wording is tested at `packages/core/src/ui-preferences.test.ts:4`. Translation, model, update and shortcut errors now include recovery, e.g. `packages/core/src/i18n.ts:282`, `:356`, `:713`, `:785`. Mirror errors wrap provider detail with localized recovery at `apps/web/app/mirror/page.tsx:87`, `:101`, using EN/IT keys at `packages/core/src/i18n.ts:92`, `:527`. |
| 8. Browser surfaces | Selection, caret, scrollbars and focus follow theme tokens at `CSS:10`, `:259`, `:269`; welcome equivalents at `apps/desktop/welcome.css:63`, `:65`, `:68`. Both themes verified in browser. |
| 9. Motion | The dock's existing background-only sheen/refraction remains the only authored moment (`CSS:222`). Busy/recording pulses and meter animation removed. Point text has no transition (`CSS:255`). Reduced motion disables sheen, refraction, transitions and pressed translation at `CSS:231`, `:264`; welcome at `apps/desktop/welcome.css:51`, `:66`. No entrance added to welcome. |
| 10. Brand | Web retains the existing vector Wordmark at `apps/web/components/Teleprompter.tsx:350`, with its aspect-preserving viewBox at `packages/ui/src/Brand.tsx:9`. Welcome retains the kit's black/white SVGs at `apps/desktop/welcome.html:14`, with automatic proportional height at `apps/desktop/welcome.css:11`. Both themes visually inspected; no raster enlargement. |

## Verification

- `npm.cmd run typecheck`: passed in all workspaces.
- `npx.cmd vitest run --root G:/FILOW`: 196 passed, 1 existing skipped; 23 files passed, 1 skipped. Three regression tests added to the previous 193-test baseline.
- `npm.cmd run build -w apps/web`: passed; standalone prepared.
- `npm.cmd run build:welcome -w apps/desktop`: passed.
- `git diff --check`: passed.
- Browser screenshots: `output/playwright/polish-*` (local QA artifacts, not committed), prompter EN/IT at 1024 and 1280, settings, pairing, populated mirror, compact overlay and welcome, dark/light. Source control order unchanged.
- Browser computed checks confirmed 22px/700 point text, 13px counter, 2px solid focus / 2px offset, dark hover rgb(41,45,56), light hover rgb(228,231,237), dock radius 12px. Reduced motion yielded filter `none`, sheen `none`, transition duration `0s`.
- Mirror used synthetic session data via browser routing. Welcome used a test preferences bridge. No real startup registration, model download or live take was triggered by QA. Browser console errors were the expected absent dev session relay at localhost:4748; populated mirror checks used the synthetic relay.
- Temporary files, npm cache and isolated browser profile on G:. C: remained above the 20GB stop threshold.

## Detector and narrow exceptions

The exact requested command was attempted, but `C:/Users/Asus/.claude/skills/impeccable/scripts/detect.mjs` does not exist. The installed equivalent at `C:/Users/Asus/.agents/skills/impeccable/scripts/detect.mjs` was run once with `--json` and the same eight requested targets. Result: `[]`. No remaining detector findings and no detector suppressions. Later small fixes address recovery copy, focus specificity, dock radius and spacing; the detector was not rerun.

Intentional constraints: point sizes remain outside the new UI scale because the brief explicitly protects them; mirror's pre-existing fluid point size is retained. Semantic state outlines and inset material highlights are not decorative halo elevation. Point rows remain still, including while being marked, rather than receiving the control press translation. Native select arrows remain browser-drawn. User-authored scripts and external error payloads are not rewritten. StageView retains its old default symbols for out-of-scope consumers; the requested mirror and overlay explicitly supply the shared SVGs.

Not verified: native acrylic/vibrancy, packaged launch, hardware FPS, real session relay transport, macOS/Linux or native screen-reader operation. These are not inferred from browser screenshots or source tests. The prior native acceptance tasks remain pending.

An unrelated claude-mem injection appeared in `AGENTS.md` during the session. This task did not modify, stage or commit that file.
