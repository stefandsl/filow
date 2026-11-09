# OK Filow whiteboard - design (phase I)

Status: design only, no code yet. Built by the session that owns the OK Filow source files, after its current queue.
Goal: a desktop-wide smart whiteboard. A transparent layer over every app where the user and the
agent both write and draw. The user can select a region and ask AI about it, write an equation and
plot it, and place and turn 3D objects. Reference behaviour: Clicky "real-time graphics"
(https://www.youtube.com/watch?v=YlW_-hdw7hs). There the drawing builds up while the answer is
spoken, it stays until dismissed, and follow-ups change the same scene.

## 1. Reference projects (checked in each repo on 2026-11-08)

| Project | License (checked) | What it is | Fit | Decision |
|---|---|---|---|---|
| DmytroVasin/DrawPen | MIT, ~1.1k stars, active (pushed 2026-11-06), Electron + React | Screen annotation: pen, shapes, laser, whiteboard toggle, toolbar, global draw shortcut | High for tool UX and shortcuts. Same stack as ours | **Port ideas and small pieces**, keep the MIT notice. Don't vendor the app: it has its own main process, settings and windows, and ours already exist (okfilow.js overlays) |
| opensourcebharat/lekhini | MIT (the repo shows "Other", but the LICENSE file is MIT), 5 stars, TypeScript, last push 2026-07-08 | Annotation overlay plus local-first AI via Ollama: "Ask AI" on a snipped region, handwriting recognition, autocorrect | High for the region-ask and handwriting flows. Low maturity (5 stars, quiet since July) | **Port ideas only.** Read its prompts and flow, write our own on our providers.ts |
| jsxgraph/jsxgraph | Dual **LGPL-3.0 or MIT** (LICENSE.LGPL + LICENSE.MIT in the repo); we take it under MIT | Interactive geometry and function plotting | Good for plots: one dependency, no server, safe expression parser (JessieCode) | **Use as an npm dependency** under MIT, lazy-loaded only in plot mode. Never eval() user text |
| excalidraw/excalidraw | MIT, 135k stars | Whiteboard editor component | Too heavy as the live overlay (a full editor, its own state and UI). Its look comes from roughjs + perfect-freehand | **Don't embed.** Use `perfect-freehand` (MIT) for ink and `roughjs` (MIT) for the hand-drawn shapes. Optional later: "Open in Excalidraw" export (.excalidraw JSON) |
| three.js | MIT, already a dependency (^0.170.0) | 3D | Already used by app/okfilow/model | **Reuse** the existing model window and BuddyModel parts |
| trycua/cua (libs/cua-driver) | MIT, Rust, has `platform-windows` and `cua-driver-uia` crates, speaks MCP over stdio | Computer-use driver for agents, background input without stealing focus | Fits "do it" (the agent clicks or types for the user). The README leads with macOS and Windows maturity is unproven | **Phase I6, behind a flag.** Spawn as an MCP child process, never bundled into the default build until it passes our Windows E2E |

Rule from the user's global instructions: prefer quality and long-term maintainability over saving
work. That is why we build on our own overlay and import small MIT libraries, not fork a whole app.

## 2. What we build on (already in the repo)

- `apps/desktop/okfilow.js`: one transparent, click-through, always-on-top overlay per display;
  panel window; tray; uiohook chords; IPC guarded to OK Filow's own windows.
- `apps/desktop/okfilow-gestures.js`: chord logic (talk Ctrl+Alt, dictate Ctrl+Win, hands-free,
  text box double Ctrl). The whiteboard chord is added here.
- `apps/web/lib/buddy/visuals.ts`: validated `BuddyDrawing` (400x300 SVG shapes), `BuddyModel`
  (3D parts), `BuddyCard`. The agent side of the board reuses these validators.
- `apps/web/app/okfilow/model`: three.js model window. Placed 3D objects reuse it.
- `prompt.ts` 0-1000 grid and POINT / CIRCLE / ARROW / BOX / UNDERLINE marks: the agent already
  draws on screen; the whiteboard makes those marks persistent board items.

## 3. Modes

1. **Live overlay** (default): the board is drawn over the real, live desktop. Apps keep updating
   underneath. While the board is in **draw mode** the overlay takes the mouse
   (`setIgnoreMouseEvents(false)`) on the display under the cursor. In **pass-through mode** the
   ink stays visible but clicks go to the apps.
2. **Frozen workspace**: capture the current display (desktopCapturer, in memory only) and draw
   on that still image. Use it for fullscreen video, games, or apps that repaint under the ink. Ask-AI
   uses the exact pixels you drew on. Exit returns to live, and the ink can be kept or cleared.
3. **Blank board**: an opaque background (dark, light or grid) over the display, like DrawPen's whiteboard
   toggle. Use it for plots and explanations not tied to an app.

The board state is one model shared by all three modes. The mode only changes the background.

## 4. Board model (single source of truth)

```ts
type BoardItem = {
  id: string; author: "user" | "agent"; display: string; // display id
  createdAt: number; step?: number;                       // agent items reveal by step
  kind: "ink" | "highlight" | "rect" | "ellipse" | "line" | "arrow" | "text"
      | "plot" | "model" | "card" | "image";
  // geometry in display DIP; agent output arrives on the 0-1000 grid and is mapped once
  ...
};
type Board = { items: BoardItem[]; undo: Op[]; redo: Op[]; mode: "live" | "frozen" | "blank" };
```

- The board lives in the desktop main process (okfilow-board.js, pure logic + tests), mirrored to
  each display's overlay by IPC. One store means multi-monitor, undo and save stay consistent.
- Ops are add/update/remove. Undo/redo works per op, and the user can undo agent items too.
- Persist only on explicit Save, or with an opt-in "keep board" setting, under userData/boards (never
  on C: temp). No silent autosave of screen content.

## 5. Tools

| Tool | Key | Notes |
|---|---|---|
| Pen | P / 1 | perfect-freehand strokes, pressure from the pen if present |
| Highlighter | H / 2 | wide, 35% alpha, multiply blend |
| Shapes | R rect, O ellipse, A arrow, L line | roughjs style; Shift = square/circle/45 degrees |
| Text | T | click to type; double Ctrl (existing gesture) still opens OK Filow's text box, not this |
| Laser | Z / 5 | fading trail, never saved (DrawPen idea) |
| Eraser | E | stroke eraser (whole item); Shift = partial |
| Select / move | V | box-select also feeds "Ask AI" and "Plot" |
| Undo / redo | Ctrl+Z / Ctrl+Y | |
| Colour, width | 1-9 palette, [ ] width | |
| Clear board | Ctrl+K | asks only if the board has unsaved agent items |

The toolbar is a small floating bar on the cursor display. It's draggable and can be hidden with
Ctrl+T (DrawPen). It's the only part of the overlay that takes clicks in pass-through mode
(`setIgnoreMouseEvents(true, {forward: true})` + hit-test).

## 6. Agent on the same board

- The answer may carry board ops alongside speech. We extend the existing tags with a fenced block,
  so the model is not forced into one tag per shape: `[BOARD]{"ops":[...]}[/BOARD]`. Parse it in
  visuals.ts style: validate every field, clamp to the grid, cap 80 items per answer, drop unknown
  kinds. No HTML or JS from the model ever runs.
- **Step sync (the Clicky effect)**: every agent item has a `step`. The panel splits the spoken text
  into sentences and reveals step N when sentence N starts. With no voice, steps appear 600 ms apart.
- **Stay until dismissed**: agent items never time out. This fixes the user's report that the
  photosynthesis drawing vanished too fast and the 3D view could not be captured. Esc hides the board.
  The items come back with the chord or the toolbar until cleared.
- **Follow-ups**: the current board (items as compact JSON, at most 4 KB, plus a fresh screenshot) goes to
  the model with the next question, so "now show the light reactions" adds to the same scene.
- **Ink is context**: the user's ink is in the screenshot the model sees (live mode) or in the
  frozen image, so "what did I circle?" works.

## 7. Region select -> Ask AI (Lekhini flow, our code)

1. Select tool box-select (or "R" region selector) on any mode.
2. A small chip appears: Ask AI / Plot / Read handwriting / Copy image.
3. Ask AI crops that region from a fresh capture (or the frozen image), at most 1280 px, plus the
   ink inside it. It sends both to /api/buddy/ask with the question typed or spoken. The answer is spoken
   and its board ops are anchored next to the region.
4. Provider rules unchanged: local Gemma by default, cloud only if the user picked it, no silent
   fallback, offline forces local.

## 8. Handwriting recognition (local vision model)

- Render the selected ink to a white-background PNG (no screen pixels, so no privacy leak) and
  ask the local vision model (pickLocalModel: gemma4:e4b first) to "transcribe exactly, return
  only the text; use LaTeX-free plain math like y = x^2 - 3".
- The result is shown in an editable chip before anything acts on it. The user can convert ink to a
  text item or use it for Plot.
- Quality bar to measure in phase I3: 20 handwritten samples (words + equations) drawn with the
  mouse. Target 90% exact on equations with Gemma e4b; if lower, offer cloud OCR when the user has
  chosen cloud.

## 9. Plot flow (JSXGraph)

1. User writes `y = x^2 - 3` (ink or text), selects it, clicks Plot.
2. Handwriting (if ink) -> text -> parse with JSXGraph's JessieCode / a whitelist grammar:
   `y = f(x)`, `f(x) = ...`, several functions separated by `;`, parametric `x(t), y(t)` later.
   Reject anything else with a clear message.
3. A plot item (resizable card, default 480x360) is placed beside the selection on the board:
   axes, grid, zoom and pan with the wheel, a hover readout, and roots and vertex marked for quadratics.
4. The agent can also emit `{kind:"plot", expr:"..."}` ops. Same parser, same validation.
5. JSXGraph is loaded only when the first plot is created (dynamic import).

## 10. 3D placement

- `{kind:"model"}` items reuse BuddyModel parts and the three.js renderer from app/okfilow/model.
  They're rendered inside the board as a card, not a separate window, so it can sit next to the
  thing it explains.
- Drag to orbit, wheel to zoom, click a part to name it (the existing model page behaviour). The card
  corner handles resize it. Each card has its own WebGL context; at most 3 live model cards, older
  ones freeze to a snapshot image (WebGL context limits).
- "Save view" exports the current camera as PNG via `preserveDrawingBuffer` at save time.

## 11. Multi-monitor and fullscreen

- One board, items tagged with a display id. Each display's overlay renders only its items. Dragging
  an item across displays re-tags it.
- Draw mode applies to the display under the cursor; other overlays stay click-through.
- DPI: store DIP, render with `devicePixelRatio`. Test 100% + 150% mixed setups.
- Fullscreen apps: the overlay is at "screen-saver" level and already shows over borderless
  fullscreen. Exclusive-fullscreen games/video can still cover it, so the chord switches to
  **frozen** mode automatically when the foreground window is fullscreen and the overlay is not
  visible. The check uses the window bounds against the display bounds from the existing focus code.
- Screen sharing: `setContentProtection(true)` hides the board from shares today. Add a toolbar
  toggle "show on screen share" (off by default, setting remembered) for teachers who want viewers to see it.

## 12. Keyboard shortcuts

| Action | Shortcut | Where |
|---|---|---|
| Toggle board (draw mode on cursor display) | hold-free chord **Ctrl+Shift+D** (global, via okfilow-gestures, not globalShortcut: Ctrl+Alt+Space belongs to Claude) | global |
| Pass-through / draw toggle while board is shown | **Ctrl+Shift+D** again or middle-click | global |
| Hide board (keep items) | Esc | board |
| Frozen workspace | F | board |
| Blank board | B (cycles dark / light / grid) | board |
| Ask AI on selection | Enter or Ctrl+Enter | board |
| Talk to OK Filow while the board is open | existing talk chord (Ctrl+Alt) | global |
| Tools, undo, clear, toolbar | see §5 | board |

All board-local keys apply only while the board has focus, so they never steal keys from the user's apps.

## 13. Save / export

- **Save PNG** (Ctrl+S): the composite of the background (frozen or blank; live mode captures the
  display at save time) + board, per display, into Pictures\Filow (configurable). Includes the 3D cards'
  current views and plots.
- **Copy** (Ctrl+C with nothing selected): PNG to the clipboard.
- **Save board** (.filowboard JSON): items only, re-openable. Optional **.excalidraw export** for
  rough shapes/ink/text (plots and 3D become images).
- Nothing leaves the PC on save.

## 14. "Do it" (Cua driver, behind a flag)

- After an answer that describes UI steps, a "Do it" chip appears only if the setting
  `okFilow.doIt` is on and cua-driver is installed. Spawn it as an MCP stdio child and send the
  planned steps. The user sees each step drawn on the board before it runs and can stop it with Esc.
- Always confirm before the first action of a run. Never type secrets. Never act in password fields.
- Not in the default build until the Windows E2E below passes.

## 15. Tests

Unit (vitest, no paid calls):
- board ops: add/update/remove, undo/redo across user and agent items, display re-tag.
- `[BOARD]` parser: valid ops, clamping, caps, unknown kinds dropped, malicious strings (HTML, JS
  URLs) rejected.
- step reveal: sentence split -> step timing; no-voice fallback.
- plot grammar: accepted forms, rejected input (calls, assignments, eval-like text).
- shortcut logic in okfilow-gestures (the board chord never fires during AltGr or app shortcuts).

E2E (packaged app, like the OK Filow QA profile on G:):
- Open the board, draw with pen/shape/text, undo, save PNG. The PNG pixels contain the strokes.
- Agent: canned answer with `[BOARD]` ops through the standalone server (ACCESS_PASSWORD empty, local
  Ollama). Items appear in step order and are still there after 60 s.
- Ask AI on a region: answer text arrives and ops are anchored next to the region.
- Plot `y = x^2 - 3` from typed text, and from ink with Gemma. The roots are marked near +/-1.73.
- 3D card: orbit, save view PNG, 4th card freezes the oldest.
- Multi-monitor: item on display 2 renders only there; drag across.
- Note: content protection hides the overlay from screenshots. E2E reads board state over IPC and
  exports PNGs, or runs with a test-only flag that turns protection off in the QA profile.

## 16. Phases (for fork 2, after its current queue)

| Phase | Scope | Done when |
|---|---|---|
| I1 | Board store + draw mode + tools (pen, highlighter, shapes, text, laser, eraser, select, undo), toolbar, Esc/clear, Save PNG/copy, multi-monitor | E2E draw-undo-save passes on two displays |
| I2 | Agent on the board: `[BOARD]` ops, step-synced reveal, stay-until-dismissed, follow-ups with board context; existing marks become board items | Photosynthesis question draws a step-by-step diagram that stays until Esc and saves as PNG |
| I3 | Region select -> Ask AI; handwriting -> text with local Gemma (measured on 20 samples) | Accuracy number recorded; flow E2E passes |
| I4 | Plot (JSXGraph, lazy) from text, ink, and agent ops | y = x^2 - 3 plots from ink |
| I5 | 3D cards on the board (reuse model page), frozen and blank modes, fullscreen auto-freeze, share toggle | 3D card saves its view; fullscreen video gets frozen mode |
| I6 | Cua "do it" behind a flag, Windows E2E | Opt-in flow works on Windows or stays flagged off with a written reason |

Each phase: unit tests, packaged-app E2E, pixel-level UI check, no commit of keys, no paid calls in tests.
