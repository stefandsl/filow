# Overlay round 2B

This work stays on `feat-overlay-r2b`. Main `f5d18e2` was merged as `d89a2fd`;
its microphone opening/closing and phone-security behavior remains covered by the suite.
No push, tag, merge into main or release was performed.

## Changes

- Marks follow spoken sentences, remember speech that began before the first tag arrived,
  and release any remaining marks after speech finishes. Append and Stop use per-mark
  start times. Existing stroke nodes and label placements survive an append.
- Draw and point carry validated avoidance rectangles through the real preload. The main
  process converts them to overlay-local coordinates. Resume retains the avoidance data.
- The bubble measures its content with ResizeObserver and animates width and height over
  160 ms. Reduced motion disables sizing transitions.
- The pointer plans one eased quadratic route for its body and pill, with a shared clock
  for the arrival ring. The ring is centered on the SVG tip. Routes that cannot clear the
  detected obstacles hide the pointer instead of covering them.
- Leaders start on actual mesh surfaces. Transparent casings use an upper-shell anchor
  that cannot be mistaken for the machinery behind them. Minimum-length lane matching
  separates leaders; numbered labels retain reading order. Model margins ignore clicks,
  while ray hits, labels and controls request mouse input. Light-theme labels have explicit
  foreground, surface and leader colors.

## Evidence

The user-specified directory `G:/FILOW/tmp/overlay-r2b` contains:

- `driver/run.mjs`, `qa.cjs`, `pipeline.cjs`: bounded, hidden Electron runs using the real
  production pages and each build's preload. `run.mjs before` uses the supplied build at
  `G:/filow-wt/overlay-r2b-before`, commit `8464239`. `run.mjs after` uses this worktree.
  `run.mjs pipeline` drives the actual panel/API with fake Ollama NDJSON and silent speech.
- `numbers.json`: per-theme before/after measurements and append/bubble/pipeline checks.
- `logs/*-capture.json`: every sampled renderer frame, bounds and leader polyline.
- `pipeline.json`: streamed answer, speech callbacks, IPC events and first-ink samples.
- `mutations.json`: 20 deliberate breaks, all rejected by tests, with sources restored.
- `frames/ab`: eight neutral A/B sheets. Every scene/theme appears twice with sides
  swapped. Initial side assignment is balanced. Only `ab-key.json`, outside `frames`,
  identifies the variants. Give the critic only `frames/ab`.

Validation: `npx vitest run` passes 3,077 tests, with 5 existing skips; workspace typecheck,
lint and production web build pass. The UI detector reports no findings. The build emits
its existing Next.js ESLint integration advisory; it exits successfully.

The harness sets all requested QA isolation switches, uses ports 4951 and 4955 plus debug
9551, stores its profile/temp/cache/logs on G:, denies microphone permissions, blocks browser
requests outside its local QA ports, suppresses dialogs and stops only its own processes.
The capture is a renderer harness, not the installed app. Its main-process capture and
speech are synthetic. No real microphone, keyboard/mouse injection into the desktop, paid
API, installed profile, existing service or owner checkout was used.

## Measurement limits and pending review

The pointer metric is the greatest tip movement between adjacent renderer samples. Text
occlusion is conservative bounding-box intersection of the arrow and pill with the fixture's
text/divider rectangles, not a claim about all desktop applications. Leader crossings use
strict segment intersections, and lane spacing is measured at the knees within each column.
These are short rotating-engine samples; the unit suite also exercises 400 randomized layouts.

Append checks verify identical DOM stroke identity and label position after new marks arrive.
The pipeline emits all three marks. New sentences start their first mark immediately;
only marks released in the same batch are staggered. Exact draw-to-2-percent-ink delays
are in `numbers.json`. Natural voice latency was not measured.

Not verified: the blind critic's preference, presented frame timing on a visible physical
display, native click-through behavior over real owner applications, live UI Automation
rectangles in those applications, a packaged installer, real microphone or real-model quality.
The synthetic cases and unit tests cannot establish clearance for every arbitrary layout.
An unrelated auto-injected `AGENTS.md` edit was left unstaged.

## Final captured numbers

Worst case across dark and light, using the fixture and sampling method above:

| Metric | Before | After |
| --- | ---: | ---: |
| Maximum pointer step (px/frame) | 22.752 | 11.503 |
| Maximum text overlap (px squared) | 2143.984 | 0 |
| Leader crossings | 0 | 0 |
| Minimum lane spacing (px) | 6.8 | 12.0 |
| Label overlaps | 0 | 0 |

Final streamed draw-to-ink delays: 35, 36 and 32 ms. Maximum sampled bubble height
step: 5.1875 px. Appending preserves the original stroke node and label placement.
The eight-sheet key passes balanced-side and mirrored-pair checks.
