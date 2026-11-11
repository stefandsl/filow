# Whiteboard tutor - the lesson proof (2026-11-11, round 2)

What was measured, on what, and what it means. Tool: `tools/whiteboard/bench.mjs` (ten concepts
through the real lesson route of a running Filow server; local path; no cloud call was made).

## The machine

Windows 11, NVIDIA GeForce RTX 3070 (8 GB). Local model chosen by the setup for a drawing:
`qwen3-vl:8b` (Q4_K_M) in Ollama 0.40.13. The graphics card was shared with other work during the
runs, so the times are on the slow side.

## Two scores, and which one counts

- Strict score (the exit test): a fresh reviewer agent per run, who did not build the feature and
  does not know earlier scores, reads every lesson (`summary.md`: each spoken sentence and what was
  drawn with it) and passes it only when the sentences are correct, in order and really explain or
  prove what was asked, AND every arrow, formula and plot is true. A sparse drawing is not failed
  for being sparse.
- Machine score: the lesson arrived, at most one step is a text card, and `layoutProblems` finds
  nothing on any step of either board shape. It says the board is drawn properly, not that the
  lesson is right. Since a step can no longer write free notes, more steps are text cards and this
  score went down while the strict score went up.

Two sets of ten concepts: the first set (photosynthesis, Pythagoras' proof, TCP handshake, compound
interest, neural network learning, binary search, Krebs cycle, supply and demand, Ohm's law,
recursion) and a held-out set never used while tuning (Doppler effect, vaccines, Bayes' rule, DNS
lookup, derivative as slope, water cycle, public-key encryption, natural selection, Kirchhoff's
laws, quicksort).

## Results on this PC, local model

| Version of the local path | Run | Strict | Machine | Seconds per lesson (first step) |
|---|---|---|---|---|
| 1. Free drawing, one call per step | bench-final-1 | 3/10 | 10/10 | 9-23 (5-14) |
| 1. Free drawing | bench-final-2 | 3/10 | 9/10 | 9-18 (6-8) |
| 2. Drawing plan, relations fact-checked, pick per step | bench-plan-2 | 6/10 | 10/10 | 15-25 (10-18) |
| 2. same | bench-plan-3 | 8/10 | 9/10 | 15-25 (10-18) |
| 3. + sentences checked and rewritten, kinds of explanation | r2-run1 | 6/10 | 9/10 | 28.8 (23.3) |
| 3. same | r2-run2 | 6/10 | 10/10 | 28.1 (22.2) |
| 3. same | r2-run3 | 5/10 | 10/10 | 24.9 (20.3) |
| 3. same, held-out set | r2-heldout | 10/10 | 10/10 | 26.2 (22.2) |
| 4. + a second examiner, no free notes, formulas must be mathematics | r3-run1 | 5/10 | 7/10 | 44.2 (39.4) |
| 4. same | r3-run2 | 5/10 | 7/10 | 40.0 (35.6) |
| 4. same | r3-run3 | 6/10 | 8/10 | 44.0 (40.4) |
| 4. same, held-out set | r3-heldout | 7/10 | 9/10 | 37.2 (32.1) |
| **5. Shipped: version 4 with one examiner, circles only on named boxes** | **r4-run1** | **8/10** | 7/10 | 25.1 (19.4) |
| **5. same** | **r4-run2** | **8/10** | 5/10 | 29.2 (23.9) |
| **5. same, held-out set** | **r4-heldout** | **9/10** | 9/10 | 24.3 (19.6) |

**The exit target is met by the shipped version: 8/10 and 8/10 on two runs in a row, and 9/10 on the
held-out set.** Read it with these limits in mind:

- It is two runs. The strict score moves with the reviewer as much as with the model: the same
  kind of lessons scored 5 to 6 with harsher readers of version 3. Two of the passes in each r4 run
  were called borderline by their reviewer. Expect 7 to 9 lessons in 10 fully right, not always 8.
- The drawings are sparse. Six or seven boards in ten are labelled boxes with at most one arrow,
  a formula and text cards: true, but the mechanism is mostly in the spoken sentence, not in the
  picture.
- A lesson takes about 25 to 29 s, the first step about 20 to 24 s after the question (version 2:
  15 to 25 s and 10 to 18 s). The checks cost that time. The Lite tier has four steps at most and
  skips the rewrite pass. Lite was not measured on real Lite hardware.

### What changed, and why each change is general

1. A drawing plan for the whole lesson; a relation must join two named things and carry a verb.
2. Each relation is checked as a statement of fact and dropped unless confirmed; a step can only
   pick things and relations from the checked plan.
3. The outline chooses a kind of explanation (process, proof, algorithm, law, comparison), each with
   its recipe: a proof needs the construction and each equality with its reason; an algorithm traces
   one example with real values. This is what turned the Pythagoras "proof" into a rearrangement
   proof and binary search into a worked example.
4. Every spoken sentence is checked by an examiner call; a refused sentence is rewritten once and
   checked again, and refused twice it is left out (replaced by a plain statement of a checked
   relation only when fewer than three sentences would remain). The examiner also says whether
   the lesson as a whole does what was asked; if not, the outline is planned again, once.
5. A step can no longer write free text on the board (notes were where junk and false statements
   appeared); with nothing to draw it shows its checked sentence as a text card. A formula must be
   mathematics, not a phrase. A circle goes only on a box the sentence names.
6. Measured and rejected: a second, differently worded examiner (version 4). It refused so much
   that lessons came out hollow, took half as long again, and scored lower. It stays in the code
   (`CHECKS.passes`), off.

What still fails, in the shipped version: a proof that stops one line before its conclusion, a
lesson that leaves out the one step that says "how" (how light becomes sugar, how a shortage moves
a price), an arrow with a vague verb. These are limits of an 8B model checking itself.

`gemma4:e4b` was tried on version 1 (bench-3): machine 3/10; it ignores the one-sentence rule.

## What this means for the product

- Local is the default and works offline. On this tier (8 GB graphics card, `qwen3-vl:8b`) the
  page no longer recommends Cloud. On the Lite tier the advice stays, as words only: nothing ever
  switches source by itself.
- FreeLLMAPI is a third source, with its own first-send notice and consent. Tested in the route tests
  with a faked router only: not against a real FreeLLMAPI and not in the packaged end-to-end run.
- Cloud lesson quality is still unmeasured: no paid call was made. One command runs it when the
  owner decides to: `node tools/whiteboard/bench.mjs --cloud` prints who would receive the ten
  questions and stops; adding `--yes-send-to <recipient id>` runs it and saves the boards for
  strict scoring.

## How to repeat

1. Start Filow (or `next dev`) with Ollama running.
2. `node tools/whiteboard/bench.mjs --base http://127.0.0.1:<port> --out <dir>` (add `--set heldout`
   for the second set): the machine score and `summary.md` with every lesson in words.
3. Give `summary.md` to someone who did not write the prompts and does not know earlier scores.

Saved runs (outside the repo): `G:\FILOW\tmp\wb-tmp\` folders `bench-final-1`, `bench-final-2`,
`bench-plan-2`, `bench-plan-3`, `r2-run1..3`, `r2-heldout`, `r3-run1..3`, `r3-heldout`, `r4-run1`,
`r4-run2`, `r4-heldout`.
