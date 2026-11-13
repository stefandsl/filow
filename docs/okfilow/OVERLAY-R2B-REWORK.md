# Overlay round 2B rework

This reworks `82c4923` on `feat-overlay-r2b`. The comparison baseline remains the
unchanged build at `8464239`. No merge, push, tag or release.

## Findings and changes

The critic's landing complaint was a real placement error, not just the scene. The previous
capture's target was `(450,250)-(592.359375,277)`, but the tip stopped at approximately
`(600.359,210)`, 40.792 px outside it. The planner had deliberately selected a clear point
outside the target. It now uses the bottom-right corner of the smallest containing target
rectangle. The body extends away from that corner, the pill takes a clear dock, and an
underline links the landing to the target. The ring remains opaque throughout the hold.
Its dark-theme colour is `#ffcf55`; its light-theme colour is `#825700`. The SVG viewBox
starts at the path's hotspot, eliminating fractional CSS margin rounding.

The renderer uses the same rectangle stream supplied by panel grounding, display mapping,
the preload and main-process local-coordinate conversion. The integration unit test exercises
grounding through renderer planning on a secondary display with a negative X origin. The
hidden pipeline also sends a point through the actual panel, API and preload with fake
local-model responses and synthetic UIA data. This is not a live Windows UIA acceptance test.

Both leader columns now reserve 28 px lanes. Surface candidates are raycast against their
own mesh and rejected when an opaque neighbour occludes them. The search measures margins
from projected silhouettes and neighbouring colour boundaries. It prioritizes an 8 px safe
patch over the preferred vertical lane; a part too small to supply one uses its widest
available patch. Transparent casing anchors prefer the upper shell. Tests include a rotating
cylinder and the six-part engine, including the narrow perspective where less than 8 px is
available. Independent capture measurements use the projected geometry rather than trusting
the renderer's reported margin.

The light stage uses `#cbd5e1`, dark shell outlines, and a 3 px / 4 px soft shadow in place
of the broad 6 px / 14 px shadow. The stage fills its rectangular surface, so compositing
transparent rounded corners cannot produce black wedges. Theme changes update shell edge
materials through a MutationObserver that is disconnected on cleanup.

## Light-stage choice

The baseline really retains a dark model stage under light preference. Its pale shell has
strong tonal contrast, but that stage appears as a dark block in a light application. The
rework keeps a light, blue-grey stage: the final light frames show readable dark-on-white
labels, dark shell rims, distinct coloured components and clean corners. The stronger rims
carry shell definition without making its front opaque and hiding the machinery. The dark
baseline remains untouched in the blind sheets so the critic can disagree with this choice.

## Evidence and limits

Validation: 3,084 tests pass in 245 test files; 5 tests in 2 files remain skipped.
Workspace typecheck, lint and the production web build pass. All nine mutations fail
their regression tests and are restored. The real panel flow emits a point with its
avoidance rectangle; the renderer reaches that rectangle's bottom-right corner within
0.001 px, including the panel's existing 0.1 px rectangle rounding.

Worst values across themes, except the separately reported contrast ratios:

| Metric | Before 8464239 | Rework |
| --- | ---: | ---: |
| Pointer maximum step, px/frame | 22.888 | 12.824 |
| SVG element-box and pill overlap, px squared | 2143.984 | 72.000 |
| Glyph-bound and pill overlap, px squared | 1945.950 | 0 |
| Hotspot distance to target at landing, px | 0 | 0 |
| Ring centre error, px | 11.280 | 0 |
| Ring contrast, dark | 10.301:1 | 12.341:1 |
| Ring contrast, light | 1.642:1 | 5.921:1 |
| Minimum projected anchor margin, px | 0.035 | 8.005 |
| Minimum right-column lane spacing, px | 2.900 | 28.000 |
| Minimum lane spacing, either column, px | 2.700 | 28.000 |
| Leader crossings / label overlaps | 0 / 0 | 0 / 0 |

The original SVG element-box metric is retained: 72 px squared is empty SVG viewport
space over the divider, not the arrow path. The added like-for-like glyph metric uses
the known path's bounds transformed by the actual SVG hotspot and scale, plus the pill's
box, for both builds. The baseline's zero target distance comes with text occlusion;
the rejected intermediate build instead missed the target by 40.792 px.

The safe detour currently takes about 3.91 seconds in this fixture. This is a latency
tradeoff, not a claim of faster arrival. Renderer-frame p95 is at most 16.8 ms in these
captures. Streamed draw-to-ink samples are 27, 36 and 29 ms; bubble maximum height step
is 5.09375 px. Append preserves stroke identity and label placement.

All external evidence is under `G:/FILOW/tmp/overlay-r2b`:

- `driver/run-rework.mjs`, `qa-rework.cjs`, `analyze-rework.py`: bounded production-page
  captures. Scene inputs and timestamps match between builds; the longer 4.9 s measurement
  window includes the new route's settled landing.
- `logs/before2-capture.json`, `logs/after2-capture.json`, `numbers-2.json`: raw frame data
  and the new metrics. Pointer distance uses the actual SVG hotspot, not the element box.
  Ring contrast includes opacity and is measured at peak arrival against the scene background.
  Lane spacing is measured at the polyline knees in each column. Anchor margins are projected
  distances to part and neighbouring boundaries; baseline anchors can still be inside meshes
  rather than on their visible surfaces despite having a nonzero projected margin.
- `driver/run-point.mjs`, `pipeline-point.cjs`, `pipeline2.json`: real panel/API/preload
  flow with synthetic capture and silent speech. No real microphone or model is used.
- `mutations-2.json`: nine deliberate breaks, rejected by the focused tests and restored.
- `frames/ab2`: eight neutral, balanced, mirrored sheets with a fresh random assignment.
  `ab-key-2.json` is outside the frames directory. Give the critic only `frames/ab2`.

The React review keeps per-frame coordinates in refs and DOM updates, avoids React state
churn for geometry, and cleans up the added theme observer. The existing model loop still
does its layout each renderer frame; these measurements do not establish physical display
presentation timing or performance for arbitrarily complex meshes.

Not verified: a new independent blind verdict, visible physical-display timing, native
click-through over real applications, live UIA rectangles, packaged installers, real voice,
microphone or model quality. The engine samples do not establish clearance for every model,
camera pose or desktop layout. All QA windows remained hidden/off-screen, with the allowed
ports and isolated G: profile. No installed app, owner input, paid API or existing service
was used. The unrelated `AGENTS.md` edit remains unstaged.
