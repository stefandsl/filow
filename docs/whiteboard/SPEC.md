# Whiteboard tutor - spec

Status: built on branch feat-whiteboard (2026-11-11). Research and licences:
`tmp/research/WHITEBOARD-2026-11.md` (kept outside the repo). The wider desktop-overlay board of
`docs/OKFILOW-WHITEBOARD.md` (user ink, region select, 3D cards) is a later phase; this spec is the
tutor: the user asks about a hard concept and OK Filow explains it on a board, one step at a time.

## 1. What the user gets

- Ask by typing on the Whiteboard page, or say or type "whiteboard: ..." / "explain ... on the
  whiteboard" / "lavagna: ..." to OK Filow, or press Whiteboard in the OK Filow panel.
- Each step draws a few boxes, arrows, a formula, a plot or a note while one short sentence is shown
  under the board and spoken with the voice chosen in OK Filow (natural voice on this PC, the
  system voice, or none).
- Controls: play / pause, back, next, replay the step, voice on / off. Click a box (or focus it and
  press Enter) to have that part explained again in simpler words. A follow-up question adds steps
  to the same board.
- Export: the board as PNG, the steps as Markdown. Nothing leaves the PC on export.
- The lesson is in the language of the question; the interface is English or Italian (Russian,
  Romanian and Japanese fall back to English until the language pass adds them to
  `apps/web/lib/whiteboard/text.ts`).

## 2. The lesson format (what the model writes)

The model names things and relations. It never writes coordinates, markup or code.

```json
{"title":"Photosynthesis","scene":"flow","steps":[
 {"say":"A leaf takes in light, water and carbon dioxide.","items":[
   {"kind":"node","id":"sun","text":"Light"},
   {"kind":"node","id":"leaf","text":"Leaf"},
   {"kind":"edge","from":"sun","to":"leaf","text":"energy"}]},
 {"say":"Inside, it makes sugar and releases oxygen.","items":[
   {"kind":"node","id":"sugar","text":"Glucose"},
   {"kind":"edge","from":"leaf","to":"sugar"},
   {"kind":"formula","tex":"6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2"},
   {"kind":"mark","target":"leaf","style":"circle"}]}]}
```

| Field | Meaning | Limit |
|---|---|---|
| `scene` | how the boxes are arranged: `flow` (rows that snake), `cycle` (around a centre), `stack` (top to bottom: sequences, timelines, call stacks) | one per lesson |
| `say` | the sentence shown and spoken | 260 characters |
| `node` | a labelled box; `id` is reused by later steps | 36 characters, 10 per lesson |
| `edge` | an arrow `from` -> `to`, optional label | 22 characters |
| `formula` | LaTeX, set with KaTeX | 180 characters |
| `plot` | `expr` in x, `xmin`, `xmax` | 80 characters |
| `note` | a short line of text | 120 characters |
| `mark` | `circle`, `underline` or `highlight` on an earlier node | - |
| `sketch` | free shapes in the existing `drawing2d` format (`lib/buddy/visuals.ts`, `validateDrawing`) | cloud path only, one per step |

At most 7 steps (4 on a text-only helper, the Lite setup) and 6 items per step.

### Validation and repair (`apps/web/lib/whiteboard/lesson.ts`)

Model output is data. It is parsed as JSON (`parseJsonLoose`: code fences, words around it, trailing
commas and a cut-off answer are forgiven), then every field is checked:

- unknown kinds are dropped; text is cut to its limit and stripped of tags, control characters and
  direction marks; ids become short ASCII keys;
- an edge may name a node by id or by label; an edge to a node that was never drawn creates that
  node; an edge to itself, a duplicate edge and a mark on nothing are dropped;
- LaTeX: commands that define macros, link, load or read are refused (`\href`, `\url`, `\def`,
  `\newcommand`, `\includegraphics`, `\htmlClass` ...), unbalanced braces are closed or refused, and
  the server parses the formula with KaTeX before it is accepted. The page sets it with
  `katex.render` (DOM nodes, `trust: false`, `maxExpand` and `maxSize` capped): no HTML string from
  the model is ever inserted;
- a plot expression is read by Filow's own parser (`plot.ts`: numbers, x, + - * / ^, brackets,
  sin cos tan asin acos atan exp ln log sqrt abs, pi, e) and evaluated by walking the tree. There is
  no `eval` and no `Function`. This is why JSXGraph, named in the research, is not a dependency: a
  function plot does not need 1 MB of library, and the plot is drawn in the same SVG as the rest so
  it has the same look and exports with the board;
- a step with no usable item becomes a text card: the sentence on the board, the lesson goes on.

## 3. Layout and drawing

- `layout.ts` places everything, deterministically, for the steps shown so far: nodes by scene,
  arrows as curves that go around other nodes, labels where nothing else is, notes, formulas and
  plots in a column beside (wide board, 1200 x 720) or below (tall board, 480 x 800, used under
  700 px of width) the diagram. When the column is full the oldest notes are wiped.
  `layoutProblems` lists overlaps, anything off the board and labels that are cut; the tests run
  it over thousands of generated lessons and the lesson proof runs it on every step.
- `components/whiteboard/Board.tsx` draws one SVG: Rough.js gives the hand-drawn strokes (seeded,
  so a shape looks the same on every redraw), text is SVG text, formulas are KaTeX inside
  `foreignObject`. No GPU. New items of the current step draw on with a stroke animation (off with
  reduced motion, and on the Lite tier where shapes are plain).

## 4. Getting a lesson (`apps/web/lib/whiteboard/generate.ts`, `POST /api/whiteboard/lesson`)

The answer is a stream of JSON lines: `start`, `outline`, one `step` per step, `done` or `error`.

Local (default): Ollama with a JSON schema in `format`.
1. One short call for the outline: title, scene and one sentence per step.
2. One call for the drawing plan of the whole lesson: the things (boxes) and the relations between
   them, each relation "from, verb, to". A relation must join two named things and carry a verb.
3. One call that checks every relation as a statement of fact; a relation that is not confirmed
   (false, unsure, or a check that cannot be read) is never drawn.
4. One small call per step that picks, by id from a closed list, which things and checked relations
   that step shows, plus an optional formula, plot expression or short note. A checked relation
   whose two things are both on the board is drawn even when no step picked it. A small model that
   draws freely step by step invents false arrows (docs/whiteboard/PROOF.md): here it cannot.
   Between the fact check and the picks, once (not on the Lite tier): relations the check refused are
   written again and things no relation touches are linked from the sentences; what comes back goes
   through the same fact check before it can be drawn.
   Invalid or empty: one retry; still nothing: text card. Each call has its own time limit; a model
   that stalls after the outline still yields a lesson of text cards.
The page shows and speaks step 1 while the later steps are generated.

Cloud (only when the user chose Cloud, never as a fallback): one call for the whole lesson through
`askBuddy("cloud", ...)`, so the consent key, the first-send notice and the going-outside signal
apply unchanged. Only the question text (and, for a follow-up, the lesson so far) is sent: no
screenshot. Offline mode answers on this PC whatever was asked.
The lesson starts with the model's own restatement of the topic. Code then checks, in this order:
a placeholder the question did not contain (a provider that hides names: no lesson, code
`redacted`); a proper name of the question the restatement and title never use (off the topic); the
examiner's review (sentences, topic, the one thing the board must show, looked for on the board in
code); the sums in the sentences, recomputed; every arrow judged alone, with who acts; boxes left
alone (off by default; when on, asked once for their links and judged); notes moved to the step of
their box; a last look in code (the opening word, curves a note speaks of, cut cells, plot numbers).
A guard repairs, asks for one rewrite or refuses the whole lesson; it never cuts a step, a curve or
part of a worked example. A step whose check did not pass after the rewrite is shown and named
under the board as not confirmed; when more than half are, the lesson is refused.

Hardware tiers come from the existing setup resolution: no local helper -> the existing message and
a Cloud button the user must press; text-only helper -> 4 steps, plain shapes; picture helper -> the
full lesson.

## 5. Failure states

| What happens | What the user sees |
|---|---|
| Ollama is not running, or the helper is not downloaded | the existing message, with Try again and (in the desktop app, online) Use Cloud |
| The outline cannot be read after a retry | "Could not plan this lesson", Try again |
| One step cannot be drawn | that step is a text card |
| The model stalls | the steps that arrived stay; the rest become text cards; a note says the drawing stopped early |
| Cloud chosen, no consent yet | the first-send notice; No keeps the lesson on this PC |
| Cloud chosen while offline | answered on this PC; the source chip says so |
| The cloud service hid a name or place of the question (`[PERSON_NAME]`) | no lesson; the reason, where the setting is (OpenRouter account, privacy or guardrails), Try again and "Explain it on this PC" |
| The online model keeps writing about another topic | no lesson; the reason, Try again and "Explain it on this PC" |
| The online model is busy after three waits | the reason; no other source is used |
| A step could not be confirmed (examiner or a sum), even after the rewrite | the whole lesson, and a note naming the steps to read with care |
| The question is empty or too long | the Explain button stays off / the text is cut to 400 characters |

## 6. Tests and proof

- Unit: `apps/web/lib/whiteboard/*.test.ts`, `apps/web/components/whiteboard/*.test.tsx`,
  `apps/web/app/api/whiteboard/*.test.ts` (a fake model server; no paid call).
- Proof: `tools/whiteboard/bench.mjs` runs ten concepts through the local model and scores each
  lesson; results in `docs/whiteboard/PROOF.md`.
