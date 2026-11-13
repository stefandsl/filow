# Overlay round 2B second rework

Reworks 812cffc on feat-overlay-r2b. No merge, push, tag or release.

Part numbers are assigned once in initial reading order, and columns remain attached to
parts for the model's lifetime. Surface patches prefer that initial column order while
retaining the 8 px clearance priority. Labels hold their rows whenever that routing is
clear. A necessary row change eases label and leader endpoints together; numbers never swap.

Pointer motion uses a sampled arc-length clock with quadratic ease-out and a straight
final approach. Duration is clamped to 450-900 ms, independent of detour length. Landing
dock selection reserves 8 px around its padded pill bounds, including the compact shadow.
A nearby horizontal divider suppresses the underline. Light accents use #684500 and a
1.5 px dark outline, matching the arrow outline weight.

Validation: 3,089 tests passed in 246 files; 5 tests in 2 files skipped. Workspace typecheck,
lint and production web build exited 0. Seven deliberate mutations were rejected and
restored: number, column, flight cap, clearance, backtrack, divider underline and contrast.
The React review retained transient geometry outside React state and existing cleanup.

## Renderer evidence

The before build remains 8464239. Both builds were captured with the same fixture and
sampling schedule. Each of the eight balanced, mirrored blind sheets has eight samples
per side, including eight rotation frames per model side across 4.8 seconds. Identity
measurements inspect all 294 model frames per theme, not only the sheet samples.

| Metric | Before 8464239 | Second rework |
| --- | ---: | ---: |
| Flight duration, dark / light, ms | 683.4 / 683.3 | 633.4 / 633.3 |
| Last-30-percent backtrack, px | 0 | 0 |
| Landing pill clearance, px | 0 | 17 |
| Light ring contrast | 1.642:1 | 8.039:1 |
| Dark ring contrast | 10.301:1 | 12.341:1 |
| Glyph and pill text overlap, px squared | 1945.950 | 0 |
| Maximum pointer step, px/frame | 22.750 | 39.355 |
| Identity changes, both themes | 0 | 0 |
| Minimum leader lane spacing, px | 2.700 | 28.000 |
| Minimum right lane spacing, px | 2.900 | 38.900 |
| Minimum surface margin, px | 0.035 | 8.005 |
| Leader crossings / label overlaps | 0 / 0 | 0 / 0 |

The rejected 812cffc rework took about 3,910 ms, versus 633 ms now. Its identity changes
were reported by the critic; its old raw capture did not store identities, so no automated
identity-change count is claimed for that intermediate build. The larger step follows
from the requested faster flight. The old 14 px step test was replaced with a continuity
bound and explicit duration/backtrack gates. Renderer sampling is not physical-display timing.

The legacy SVG-box overlap remains 72 px squared: empty viewport space at the divider.
Actual glyph/pill overlap is zero. Pill clearance excludes the shadow itself, while the
planner reserves padding for it. The ring and underline share the same light ink; the
unit test also checks 4.5:1 against pure white and checks both dark outlines.

An intermediate eased row swap produced a transient crossing/overlap. Preferring safe
surface patches in established label order removed that swap in the final fixture. Final
captures have zero crossings and overlaps. Arbitrary camera poses and meshes are not proven.

Evidence under G:/FILOW/tmp/overlay-r2b:

- driver/run-rework3.mjs, qa-rework3.cjs, analyze-rework3.py.
- logs/before3-capture.json, logs/after3-capture.json, numbers-3.json.
- mutations-3.json and logs/*3*.log / *3-result.json.
- frames/ab3: eight neutral sheets. ab-key-3.json is outside frames with fresh random sides.

All four final theme/scene captures were visually inspected. Windows remained hidden,
with isolated G: profile and allowed ports. Microphone permissions were denied; no real
input, installed app, real model or paid API was used. QA launchers have hard deadlines
and clean up only their own PIDs.

Not verified: a fresh independent blind verdict, physical-display timing, native drag
and click-through over real applications, live UIA rectangles, packaged installers,
real microphone/voice/model quality, or universal clearance for arbitrary scenes.
The old pipeline2 draw timing is retained as previous evidence, not rerun in this task.
