# Overlay round 2B: final rework

2026-11-14, branch `feat-overlay-r2b`, regression baseline `e7db482`.

The three changes are leader routing, pointer trajectory, and light-theme fine strokes.
Numbers, columns and label rows remain fixed. A route keeps its previous elbows while
clear, then finds a short route around reserved screen-space corridors. No renumbering
or asynchronous label easing can invalidate the final polyline. Pointer flights use a
monotonic curved approach with distance pacing, a gentle start and ease-out, capped at
900 ms. Light leaders have a 4.5 px opaque dark casing around 2 px ink. The ring has a
2.5 CSS px border and dark outlines, and starts at full size rather than scaling a thin
stroke down to less than one rendered pixel.

## Measurement correction and baseline proof

The previous driver sampled only 4.9 seconds of slow rotation. Its lane-spacing value
was the difference between knee heights, not distance between the rendered leaders.
The renderer could also ease labels after its proposed-slot crossing check.

`driver/qa-rework4.cjs` reads every final SVG polyline point through `getScreenCTM()` into
overlay pixels. The independent Python analyzer tests every segment of every pair,
including opposite columns, touching bends and collinear overlap. Crossings have no
anchor exclusion. Clearance is centreline distance outside explicitly defined **8 px
anchor discs**, not the gap between knee heights or the gap between stroke edges.

The rebuilt, unmodified e7db482 renderer reports up to **3 intersecting leader pairs**
in both themes and zero minimum clearance. Regression fixtures retain 24 full-turn
poses plus eight sheet poses. The live driver additionally samples the rendered frames
between them, including the old easing transitions. All 1,196 final model frames pass.

The literal crossing claimed at the old eighth sheet pose was not reproduced there:
the lines are close, but their finite segments do not intersect. The expanded full-turn
coverage exposes real crossings on e7db482, including the new sheet's last camera pose.
Similarly, recorded baseline pointer motion has a vertical reversal, not a horizontal
one. These distinctions are preserved in the numbers instead of treating the critic's
visual impressions as measured facts.

## Results

Worst case across dark and light. Baseline here means e7db482, not the older A/B control.

| Measure | e7db482 | Final |
| --- | ---: | ---: |
| Intersecting leader pairs per frame | 3 | 0 |
| Minimum leader clearance outside 8 px anchor discs | 0 px | 12.996 px |
| Label overlaps per frame | 3 | 0 |
| Label identity changes | 0 | 0 |
| Pointer direction reversals, X / Y | 0 / 1 | 0 / 0 |
| Pointer path / straight distance | 1.3525 | 1.1560 |
| First step / largest later step | 1.0282 | 0.0532 |
| Maximum pointer step | 39.355 px | 25.457 px |
| Measured pointer flight | 616.6 ms | 616.7 ms |
| Glyph and pill overlap with text | 0 px2 | 0 px2 |
| Minimum rendered ring border | 0.735 px | 2.008 px |

The opaque casing `#08090b` has nominal contrast 19.920:1 on white, 13.417:1 on
the `#cbd5e1` stage, and 17.169:1 on a pale `#eeeeee` model surface. These are colour
contrasts, not a claim that every partially antialiased edge pixel has that contrast.
Final dark/light model and pointer captures were visually inspected, including the
new full-turn pose and the previously criticised near-parallel pose.

## Checks and artifacts

- Vitest: **3,093 passed**, 5 skipped; 247 files passed, 2 skipped.
- Workspace typecheck and lint: exit 0. Production web build: exit 0.
- Six mutations caught and restored: disabled crossing count, bypassed routing,
  restored upward detour, removed gentle start, removed dark leader casing, and
  restored the subpixel ring entrance. Failures are assertions, not compilation errors.
- A/B control remains **8464239**, as required by the original brief. e7db482 has a
  separate baseline capture for regression proof. Eight fresh balanced/mirrored sheets
  are in `G:/FILOW/tmp/overlay-r2b/frames/ab4`; the new key is outside that directory at
  `G:/FILOW/tmp/overlay-r2b/ab-key-4.json`. Each model side has eight rotations: the
  previous last pose is frame 7, and frame 8 exposes the expanded full-turn case.
- Raw captures: `logs/{before,baseline,after}4-capture.json`; independent results:
  `numbers-4.json`; mutation report: `mutations-4.json`, all under the same evidence root.
- Reproduce using `driver/run-rework4.mjs before`, `baseline`, or `after`, with the
  corresponding production build already installed in its isolated worktree. The
  `baseline` variant deliberately uses this worktree and requires its e7db482 build.
  Then run `driver/analyze-rework4.py`. Build and test logs are under
  `G:/filow-wt/overlay-r2b/tmp/rework4`.

All Electron windows were hidden/off-screen, permissions denied, with the QA input
flags and G: profile. Only owned processes were terminated. No real microphone,
installed profile, production ports, paid service, merge, push, tag or release was used.

## Not verified

Fresh independent blind verdict; physical-display playback and presentation timing;
native dragging/click-through over real applications; live UI Automation; packaged
installer; real microphone, voice and model quality. The panel pipeline was not rerun.
The clearance result covers this model and these samples, not arbitrary meshes,
occluded parts, continuously swept camera angles or resized viewports. No 12 px
clearance is claimed inside the 8 px anchor regions or between the outer casing edges.
