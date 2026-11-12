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

1. `native/uia/okfilow-uia.cs` + `okfilow-uia.js`: a read-only helper program lists the names and
   rectangles of what is visible on a display, topmost window first, hidden things left out. It is
   compiled when the package is made (`npm run vendor`, with the C# compiler of the .NET Framework that
   ships with Windows: no SDK, nothing downloaded) into `native/uia/bin/okfilow-uia.exe`, 12 KB, any
   CPU, shipped unpacked; `after-pack.js` stops a Windows package without it (`npm start` builds it too). It runs as a child process
   (never elevated, JSON lines over stdio, ready in 0.06 s, about 20 MB), is restarted after a crash (four
   starts at most) and is ended if it hangs. The earlier PowerShell script compiled C# into the user's
   temp folder at every start; it is gone. 0.07 to 0.46 s per scan on this PC.
2. `okfilow.js capture()` starts one scan of the screens beside `getSources` (every window walked once,
   each screen its share of the 600 names; OK Filow's panel and overlays, which the screenshot leaves
   out, are left out; the main Filow window, which it shows, is read like any other) and sends the names with the
   screenshot (`shot.elements`). No picture (the eye closed, "Look at my screen" off, not Windows) means
   no scan.
3. `ground.ts`, used by the ask route after the answer:
   - a point, circle or box whose label is a name on screen goes on that element;
   - a label in other words is matched by Gemma from the names alone (86% right, 0.34 s);
   - a near miss moves onto the small element beside it; a box that names nothing is not drawn;
   - the thing a "where is" question names is given to the local model with its position, and an
     answer that still points at nothing gets the point.
4. The list is used on this PC only. It is never sent to an online provider.

Without a list (not Windows, helper missing, slow or blocked) everything works as before: the startup log says "screen names helper not in this build" once and points come from the model's coordinates.

## Limits

- Apps that expose nothing to Windows (games, some canvas apps): 60% instead of 98%, still above 17%.
- Scaling other than 100% and mixed-scaling monitors were not measured (this PC has two screens at 100%).
- With "All my screens" on, the follow-up choice now looks at every screen sent; a name on two screens
  (for example two "Close" buttons) goes to the pointing model.
- The scan adds about 0.2 s to the capture (0.55 s instead of 0.34 s median) when it is slower than the screenshot.
- With the taskbar on every screen and "All my screens" on, a taskbar button is on screen twice: the direct
  choice gives way to the pointing model for it.

## Wired, through the real app (12 Nov 2026)

Unpackaged app of this branch with test isolation on (FILOW_QA_NO_GLOBAL_INPUT=1, own profile and ports,
main window hidden, CDP only), local model, typed questions in the OK Filow panel about a File Explorer
window opened for the test (11 files and folders, Italian Windows). The point is the one the shell sent
to the overlay; right when it falls on the rectangle Windows gives for the thing (6 px margin).

| Run | Right | Median time to the point | Median capture |
|---|---|---|---|
| With the scan, window on the screen with the mouse (three runs, the last after the review fixes) | 11, 11 and 12 of 13 (34/39, 87%) | 1.6, 1.7 and 1.7 s | 0.55 s, 140 names |
| Helper removed (model coordinates only) | 7/13 (54%) | 2.0 s | 0.34 s |
| With the scan, "All my screens", window on the other screen | 10/13 (77%) | 2.8 s | 0.71 s (two screens), 339 names |

Misses with the scan: the address bar answered with a box in its own words (drawn, not a point), and "the
column that shows how big each file is" pointed into the column instead of its header. 13 questions on one
window is a small sample; the 98% above is the larger, held-out measure. Machine load during the runs:
CPU 3 to 51% (another agent was running probes). 125% and 150% scaling: not verified (the owner's display
settings were not changed).
