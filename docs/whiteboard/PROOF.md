# Whiteboard tutor - the lesson proof (2026-11-11)

What was measured, on what, and what it means. Tool: `tools/whiteboard/bench.mjs` (ten concepts
through the real lesson route of a running Filow server, local path only, no cloud call).

## The machine

Windows 11, NVIDIA GeForce RTX 3070 (8 GB). Local model chosen by the setup for a drawing:
`qwen3-vl:8b` (Q4_K_M) in Ollama 0.40.13. Other installed models: `gemma4:e4b`, `qwen3-vl:2b`,
`lfm3-vl`. The graphics card was shared with other work during the runs.

## Two scores, and which one counts

- Machine score: the lesson arrived, at least three steps have a drawing (at most one text card),
  and `layoutProblems` finds nothing on any step of either board shape (no overlap, nothing off the
  board, no cut label, no arrow through a box). This says the board is drawn properly. It does not
  say the lesson is right.
- Strict score (the exit test): a fresh reviewer agent, who did not build the feature, reads each
  lesson and passes it only when the sentences are correct and in order AND every arrow, formula
  and plot is a true statement. A proof that proves nothing fails. A sparse drawing does not fail
  for being sparse.

## Results on this PC, local model

| Version of the local path | Run | Machine | Strict |
|---|---|---|---|
| Free drawing, one call per step | bench-final-1 | 10/10 | 3/10 |
| Free drawing, one call per step | bench-final-2 | 9/10 | 3/10 |
| Plan, fact check, pick per step (shipped) | bench-plan-2 | 10/10 | 6/10 |
| Plan, fact check, pick per step (shipped) | bench-plan-3 | 9/10 | 8/10 |

Timing with the shipped path (model warm): outline in 4 to 7 s, first step on the board after 10 to
18 s, the whole lesson in 15 to 25 s. In the page a step is on the board 6 to 74 ms after its data
arrives.

**The exit target (8 of 10, twice in a row) is not met on this PC's local model: 6/10 and 8/10.**

### What changed between the two versions

With free drawing the model invented arrows step by step and about half the lessons carried a false
one ("Sun -> Air", "Voltage -> Resistance"). The shipped path makes three changes that hold for any
concept, not for these ten:
1. one call names the things of the whole lesson and the relations between them (the drawing plan);
   a relation must join two named things and carry a verb;
2. each relation is checked as a sentence by a second call ("Light gives energy to Leaf": true or
   false, false when unsure) and is dropped unless confirmed;
3. a step can only pick things and relations from the checked plan, by id from a closed list.

False arrows went from about one lesson in two to one lesson in twenty. What still fails is mostly
the sentences, which no drawing rule can repair:

| Concept | Why it still fails (strict) |
|---|---|
| Prove the Pythagorean theorem | both runs: the steps assert the theorem, they do not prove it |
| Binary search | both runs: opens with "arrays are sorted lists of numbers" |
| Krebs cycle | one run: one wrong clause about the energy carriers |
| Supply and demand | one run: "supply equals demand" drawn on the step that says supply exceeds demand |

The drawings are also sparse: the fact check is strict, so many boards are boxes, a formula and
notes with few arrows.

`gemma4:e4b` was tried on the first version (bench-3): machine 3/10. It ignores the one-sentence
rule and repeats sentences, so the setup's choice (`qwen3-vl:8b`) stays.

## What this means for the product

- The local path is the default and works offline, but on this hardware tier it is a simple
  explainer, not a reliable tutor: expect about 6 to 8 lessons in 10 to be fully right.
- The page says so under every local lesson and recommends Cloud ("Answers from"), and never
  switches by itself. Cloud needs the user's choice and the first-send notice.
- The cloud path is built and tested against the fake model server only (`tools/whiteboard/e2e.mjs`):
  consent, one call, question text only, validated lesson with a free sketch. Its lesson quality
  with a real cloud model was NOT measured: no cloud or paid call was allowed in this work.

## How to repeat

1. Start Filow (or `next dev`) with Ollama running.
2. `node tools/whiteboard/bench.mjs --base http://127.0.0.1:<port> --out <dir>`: the machine score
   and `summary.md` with every lesson in words.
3. Have someone who did not write the prompts read `summary.md` and score it strictly.

Saved runs of this proof: `G:\FILOW\tmp\wb-tmp\bench-final-1`, `bench-final-2`, `bench-plan-2`,
`bench-plan-3` (outside the repo).
