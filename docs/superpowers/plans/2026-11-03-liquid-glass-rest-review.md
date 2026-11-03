# Independent review: remaining liquid-glass surfaces

2026-11-03. Baseline 02ea072; commits 9878589, 03ec21e, 92aa91e.
Read AGENTS.md, HANDOFF.md, design, plan and source diff independently.

## Confirmed fixes

- Splash loading animation ran beside status text and ignored reduced motion. Bar is now still; completion state remains. Added regression test.
- Splash duplicated shared theme values and reduced version text opacity to .8. It now uses imported tokens directly and full muted foreground opacity.
- Border removal changed box dimensions. Replaced removed border space with padding in settings model rows/keycaps, overlay drag bar, welcome pane/rows/buttons and splash badge. Adjusted welcome switch thumb coordinates by the removed inset. Grid/flex structure, element order, typography, breakpoints and window dimensions remain unchanged. Pixel equivalence requires visual measurement.
- No glass tint failed the requested gate. No token adjustment needed.
- No other confirmed defect remains unfixed within this review; unverified acceptance is listed below.

## File:line evidence (final source)

Both themes: apps/web/app/theme-tokens.css:1 and :45; glass values :25 and :58; accessibility overrides :79.

| Surface | Layers/borders | Motion, themes, layout |
| --- | --- | --- |
| Settings | apps/web/app/globals.css:188 raised panels, :192 sheet fields, :198 flat model/hints, :155 flat keycaps. Shared variables; border-width 0, no border shorthand. | :218 disables chip/meter motion, :241 reduced motion. No dock on settings, so dock filters cannot reach it. :107 retains panel flex; :108/:155 restore border space. Both themes inherited. |
| Mirror | packages/ui/src/StageView.tsx:55/:62 flat rows from index 10 outside compact; :77 preview sheet. globals.css:192/:210 sheet pairing/preview, :188 raised points. | Only classes changed, no order/layout/font change. No point/preview motion or filter. globals.css:241 reduced motion. apps/web/app/mirror/page.tsx:18 invokes shared theme hook. |
| Overlay | globals.css:161 sheet bar; :164 compact layout. StageView.tsx:62 excludes compact from far, retaining raised shadow/blur after ten points. Started rows keep existing sheet tint at globals.css:215 with raised depth. | No opacity on page/overlay/points; main.js:1289 keeps native opacity. No new transparent page stack. :161 restores bottom-border space. Shared theme/motion rules. |
| Welcome | apps/desktop/welcome.css:1 imports tokens; :10 raised brand, :22 sheet options, :27 flat rows, :30 sheet controls, :44 guarded blur/tints. No border shorthand. | :8 grid unchanged; :10/:28/:30/:41/:49 compensate border space. :51 reduced motion; no animation/displacement otherwise. :4/:5 and import cover both themes. |
| Splash | apps/desktop/splash.html:6 bundled tokens; :10 sheet badge, no border shorthand or new literal glass tint. | :20 still bar, :22 reduced motion, :24 full-opacity version. Theme script unchanged. :10 restores badge space. Existing flag colors are illustration, not glass tints. |

Welcome native material: apps/desktop/main.js:275 and :1602 have identical glass conditions (Windows build >=22000 or macOS). :284-288 and :1606-1608 use transparent background, acrylic or active under-window vibrancy under the same conditions. Only main.js diff is :284 aligning opaque fallback with main; dimensions, parent, modal state, preload, sandbox and lifecycle unchanged.

## Independent contrast calculation

Separate Node calculation from CSS values: alpha composite in sRGB over RGB 255/0, WCAG linearized luminance, (lighter+.05)/(darker+.05). Foregrounds read from tokens. Each pair is text / muted; thresholds 7 / 4.5.

| Theme | Tint | White | Black |
| --- | --- | --- | --- |
| Dark | raised rgba(19,21,26,.90) | 12.953 / 5.842 | 17.338 / 7.820 |
| Dark | sheet rgba(27,30,38,.92) | 12.303 / 5.549 | 15.949 / 7.194 |
| Dark | flat rgba(27,30,38,.92) | 12.303 / 5.549 | 15.949 / 7.194 |
| Light | raised rgba(255,255,255,.92) | 19.920 / 6.492 | 16.649 / 5.426 |
| Light | sheet rgba(255,255,255,.92) | 19.920 / 6.492 | 16.649 / 5.426 |
| Light | flat rgba(255,255,255,.92) | 19.920 / 6.492 | 16.649 / 5.426 |

Gate covers glass tints with text/muted, not accent/status colors, decorative highlights, disabled controls or final native opacity.

## Verification

- Injected border: 1px solid into .settings .strip: exit 1, exact glass/settings border diagnostic.
- Restored; injected into welcome .brand: exit 1, exact welcome border diagnostic. Restored byte-for-byte.
- npm run typecheck: exit 0.
- npx vitest run --root G:/FILOW: exit 0; 193 passed / 1 skipped, 23 files passed / 1 skipped.
- npm run build -w apps/web: exit 0; standalone prepared.
- npm run build:welcome -w apps/desktop: exit 0.
- PowerShell npm.ps1 execution-policy blocked; used npm.cmd/npx.cmd for the same commands.
- C: free space 293,184,069,632 bytes. Temp/cache/log/profile data on G:.

## Desktop without a screen

Launched npx electron . in apps/desktop with FILOW_USER_DATA_DIR=G:\FILOW\tmp\review-qa, FILOW_PORT=4795, FILOW_SESSION_PORT=4796, FILOW_OFFLINE=1. Added stderr logging and localhost CDP 4797 for read-only inspection.

Tool-sandbox launch failed before renderer creation with Windows runtime ACL error. Attempted scoped read grant was denied; no ACL change made. Launch outside the tool sandbox succeeded.

First successful run progressed to splash/main: startup.log recorded "splash shown" and "main window shown", no CRASH entry. Settings had welcomeCompleted=true by observation, so that did not prove welcome rendering. Archived QA profile for a fresh welcome run; some locked Chromium database files could not move, so Chromium cache was not pristine. Fresh settings did open welcome.html. CDP confirmed readyState complete, dark theme, data-glass present, translated Italian heading. Runtime/Log capture reported no exceptions or log errors during 15 seconds. First-run stderr included the development CSP security warning. No startup.log expected while welcome gate remained open.

Both review process trees terminated with taskkill /T /F. No normal installed profile settings deliberately changed.

Unverified: light-theme runtime rendering, native acrylic/vibrancy, visual layout/wallpaper matrix, overlay opacity appearance, phone rendering, FPS/battery, packaged launch, macOS/Linux. Source and contrast checks do not replace visual acceptance.
