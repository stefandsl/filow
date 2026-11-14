# Small items: C1, I1 and overlay finishing

Worktree: `G:/filow-wt/small-items`, branch `feat-small-items`, based on
`origin/main` at `037c4e7`. No merge, push, tag or installed-app changes.

## Copy and date

C1 checks every English `notice_` and `kind_` entry against the three prohibited
phrases. Existing strings pass, so no translation changes were needed. The notice
suite passes 37 tests; inserting `the user` into `notice_ask` produces one failure.

I1 uses the shared pure date helper described in [DATE-IN-PROMPTS.md](DATE-IN-PROMPTS.md).
Its 16 tests cover fixed dates, local midnight, local versus UTC fields, all five
UI languages, automatic language, three mocked providers, whiteboard overrides,
local board look/edit and the desktop agent. Advancing the helper's day by one
fails the tests. Provider tests make no network calls. Weight-only warm-up remains
undated and carries no prompt to prefill.

## Overlay changes

- The hotspot remains at the grounded rectangle's bottom-right corner. The ring
  omits its text-facing quadrant, the underline ends 18 px before the corner, and
  the landed arrow has no shadow or ink outside its box. The text glyph rectangle
  is therefore outside the landing decorations.
- Every leader segment progresses towards the anchor's side. Carried routes are
  checked too. A bounded search may reassign label rows within the same column
  when fixed rows would require a hook; part identities and numbers stay fixed.
  Routes and label positions blend over 160 ms. Routing runs in a worker, which
  is terminated with the model view, so difficult searches cannot block animation.
- Pointer travel uses a continuous velocity ramp with a lower peak speed and a
  path-length-aware minimum duration. Unit tests measure actual 60 Hz time steps.

The old fixture test now permits row reassignment while still checking exact
anchors, unchanged columns, zero intersections, zero hooks and 12 px clearance
at its 32 computed poses. This supersedes its previous fixed-row assertion.
It does not assert that intermediate blended routes maintain that clearance.

## Hidden renderer evidence

Driver and raw evidence: `G:/FILOW/tmp/small-items/driver`, `logs`, `frames`, and
`measures.json`. The driver is copied from `overlay-r2b` and measures every
`requestAnimationFrame`, not just its eight screenshots. `measure.cjs --assert`
checks zero hooks, route changes below 40 px for this fixture, pointer steps below
4% both raw and normalized to 60 Hz, and flight frame gaps below 20 ms.

| Measure | Before | After |
| --- | ---: | ---: |
| Largest pointer step, dark | 4.696% | 3.706% |
| Largest pointer step, light | 4.683% | 3.706% |
| Largest pointer step normalized to 60 Hz | 4.687% | 3.677% |
| Maximum hooks in one model frame | 6 | 0 |
| Model frames with hooks, dark / light | 321 / 296 | 0 / 0 |
| Maximum route change per frame, dark | 367.816 px | 26.629 px |
| Maximum route change per frame, light | 367.816 px | 27.019 px |

Both after flights contain 37 moving frames over 542.071 px, with a maximum
16.8 ms frame gap. Model captures contain 606 dark and 604 light frames, including
the eight sheet poses and 24 full-turn poses. Dark and light landing and model
screenshots were visually inspected. An intermediate main-thread routing build
still skipped frames; the final worker build is the evidence reported here.

Isolation: hidden offscreen Electron windows, fake microphone, denied permission
requests, global input disabled, private G: profile/temp/cache/log paths, ports
4961-4965 and debug port 9561. The driver blocks outbound requests and uses a fake
local model. Its parent has a 150-second deadline and terminates only its children.
Electron needed read/execute permission on this worktree's downloaded runtime;
no installed runtime or profile was used.

## Validation and limits

- `npx vitest run`: **249 files, 3,134 tests passed; 2 files / 5 tests skipped**.
- `npm run typecheck`, `npm run lint`, production web build: **passed**.
- Six mutations caught and restored: notice copy, date, landing shadow, hook,
  one-millisecond route transition, and excessive pointer peak speed.
- Fresh-worktree setup: `npm ci` installed 897 packages. The first full suite
  found three missing-vendor failures in desktop QA; `npm run build:welcome -w
  apps/desktop` generated the normal vendor files and the full rerun passed.

Known limitation: abrupt full-turn pose changes can exchange label rows. During
those eased exchanges the label rectangles overlap briefly: 55 captured frames
per theme, at most three pairs. The requested monotonicity and continuity checks
pass, but this is not a claim of collision-free labels throughout every transition.
The expensive optional per-frame clearance audit was stopped; only the 32-pose
unit clearance check is claimed. No new blind critic verdict was obtained.

Not verified: real models' interpretation of the date, native/live microphone and
desktop input, other displays or models, installed-app integration, packaging,
updating or release. No real model, paid API or installed-app check was performed.
