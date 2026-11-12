# OK Filow: pointing on real screens (measured 12 Nov 2026)

Why `apps/web/lib/buddy/ground.ts` and `apps/desktop/okfilow-uia.js` exist, and the numbers behind them.

## The problem

On the owner's desktop (1360x768, a taskbar of 33-pixel icons, about 100 desktop icons) a circle
labelled "Start" sat on the Search and Firefox icons, 40 pixels from the Start button, and a box
labelled "This area" covered an arbitrary region. The earlier benchmark (20 of 22) used a drawn desktop
with large rectangles and did not show this.

## How it was measured

Real screens of this PC, with the true rectangle of every target from Windows itself (UI Automation and
the desktop icon list), so no input is needed. The screenshot is taken the way the app takes it
(Electron desktopCapturer, one screen, 1024 wide, JPEG 72). Each target is asked for as "Where is X?"
through the real `/api/buddy/ask` handler and, like the panel, a second narrow request when the answer
pointed at nothing. A hit is a point inside the true rectangle. Local models only (Ollama).

- Tuning: one snapshot, two scenes, 154 targets, half of them held out.
- Held out entirely: two later snapshots (a 1360x768 and a 1920x1080 screen), 81 targets, never tuned on.
- "Reworded": the question uses Gemma's own English wording of the name, not the name Windows gives.

## Result on the held-out screens (81 targets: 60 small, 14 medium, 7 large)

| Build | small | medium | large | all | median error | answer + point |
|---|---|---|---|---|---|---|
| 0.9.35 on this PC (Qwen3-VL 8B alone) | 7% | 14% | 71% | 14% | 613 px | 2.1 s |
| main before this work (Gemma answers, lfm3-vl points) | 3% | 64% | 43% | 17% | 478 px | 0.70 s |
| with the list from Windows | 98% | 100% | 86% | 98% | 0 px | 0.35 s |
| with the list, the app itself exposing nothing (taskbar names only) | 68% | 57% | 0% | 60% | 1 px | 0.50 s |
| reworded questions: 0.9.35 / main / with the list | | | | 19% / 12% / 94% | | 2.1 / 0.67 / 0.66 s |

On the held-out half of the tuning snapshot: 41%, 25% and 99%; reworded 17% and 80%.

Small = under 2,400 square pixels (a taskbar icon), large = over 40,000.

## Where the error was

- The model, not the mapping. Answers are in the right 0-1000 space (median answer to truth ratio
  0.97 to 0.99); the model simply does not find a small thing in a 1024-pixel picture, and Gemma
  often says "it is not visible" and writes no tag. Grid to display arithmetic is exact to 2 pixels.
- lfm3-vl garbles one tag in four ("[IPS:911,62:Share]"): the numbers are now read anyway (13% to 24%).
- A sharper picture does not fix it: 1280 or native width gave 15% against 15% at 1024 on the held-out
  1920 screen (23% at full 1920, for 0.6 s more), so the capture size was left alone.
- A second look at a crop around the first guess: 38% against 24%, for 0.25 s. Not shipped: the list does more.

## What ships

1. `okfilow-uia.ps1` + `okfilow-uia.js`: a read-only helper (part of Windows, nothing downloaded) lists
   the names and rectangles of what is visible on a display, topmost window first, hidden things left
   out. 0.07 to 0.36 s on this PC, next to a screenshot that takes 0.33 to 0.58 s.
2. `ground.ts`, used by the ask route after the answer:
   - a point, circle or box whose label is a name on screen goes on that element;
   - a label in other words is matched by Gemma from the names alone (86% right, 0.34 s);
   - a near miss moves onto the small element beside it; a box that names nothing is not drawn;
   - the thing a "where is" question names is given to the local model with its position, and an
     answer that still points at nothing gets the point.
3. The list is used on this PC only. It is never sent to an online provider.

Without a list (not Windows, helper slow or blocked) everything works as before.

## Limits

- Apps that expose nothing to Windows (games, some canvas apps): 60% instead of 98%, still above 17%.
- Scaling other than 100% and mixed-scaling monitors were not measured (this PC has two screens at 100%).
- The helper is not yet called from `okfilow.js capture()`: see the wiring note in the branch report.
