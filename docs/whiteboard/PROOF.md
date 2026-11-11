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

## Round 3: the drawing has to show the concept

The rubric gained a third clause: the board at the end must show the main things AND how they
relate; a list of unconnected boxes fails. Reviewers get the final board in words (`summary.md`,
"Final board"). Under this rubric the round 2 result does not stand.

Local model, round 3 code (every step draws from the checked plan, relations drawn as soon as both
ends are on the board, row of cells for worked examples, formulas and plots):

| Run | Strict, new rubric | Steps that draw something | Checked relations on the final boards | Layout check | Seconds per lesson (first step) |
|---|---|---|---|---|---|
| t-run1 | 4/10 | 40 of 45 (5 text cards) | 12 of 12 | 9/10 | 112.7 (87.8) |
| t-run2 | 5/10 | 46 of 48 (2 text cards) | 24 of 24 | 10/10 | 89.2 (66.7) |
| t-run3 | 3/10 | 40 of 43 (3 text cards) | 19 of 19 | 9/10 | 82.5 (66.5) |
| held-out | 3/10 | 39 of 41 (2 text cards) | 18 of 18 | 10/10 | 33.5 (26.3) |

**The target (8/10 on three runs, 7/10 held-out) is not met, and this is where the local model
stops:** its sentences are right and its arrows are true, but there are too few of them. The
drawing plan plus its fact check leaves one to two confirmed relations per lesson (12 to 24 in ten
lessons). Everything confirmed is drawn (coverage 100%), and nearly every step draws something, yet
the relation that carries the mechanism (the loop of the Krebs cycle closing, light plus water plus
carbon dioxide becoming sugar, the compare-and-discard of binary search) is usually not among the
confirmed ones. Loosening the check brings back false arrows (round 1: 3/10 for that reason).
Not tried for lack of time: asking the model to repair a refused relation instead of dropping it.
The page keeps its advice under every local lesson; it never switches source by itself.

The layout score is after the round 3 layout changes, recomputed on the saved lessons
(`bench.mjs --rescore`); at bench time it was 6, 7, 7 and 8 of 10, all from cut titles and labels
on the phone-shaped board. The times of the three first-set runs are two to four times those of
every other run on this machine (the held-out run right after took 33.5 s): the graphics card was
almost certainly busy with other work, but that was not verified. Against round 2 (25 to 29 s) the
held-out run is about 5 to 8 s slower per lesson, which is the larger pick call (cells, pointer).

Pictures of the best run (t-run2), final boards in the light theme: `G:\FILOW\tmp\wb-shots\r3`
(`lesson-01.png` .. `lesson-10.png`, `contact-sheet.png`), made with `tools/whiteboard/shots.mjs`.

### The online path (Cloud, FreeLLMAPI)

Measured by the coordinator on the real model before these changes (google/gemini-2.5-flash, one
call per lesson, 4 to 9 s): strict 3/10 and 5/10, layout 6/10 and 6/10. Failures: arrows labelled
from the wrong end, a lesson on another topic, loops never closed, plots contradicting each other,
no worked example, crowded phone-shaped boards.

What the online path does now, not yet measured on a real model (no paid call was made here):
1. the lesson in one call, with the kinds of explanation and their recipes, a row of cells for
   algorithms, a rule that every arrow has a label read from its start to its end, and a limit of
   8 boxes and 10 arrows;
2. one examiner call (same recipient, same consent; only the question and the lesson's own text):
   topic, every sentence, every arrow with its direction (ok, reversed, false), and whether the
   lesson does what was asked with a board that shows it;
3. a reversed arrow is turned, a false or unjudged one dropped, a step with a false sentence left
   out; a lesson off topic or not doing what was asked is written again once with the examiner's
   reason and examined again; a lesson still off topic is refused with an error.
Cost: two calls for a lesson that passes (about twice the 4 to 9 s measured), four at most.

Layout of the two measured cloud runs recomputed with the round 3 layout: 7/10 and 5/10. On the
wide board 9/10 and 8/10 are clean; the phone-shaped board with eight to ten boxes and ten or more
labelled arrows still has arrows through boxes or labels. The new limit of 8 boxes and 10 arrows
is meant to keep boards under that; whether it does is for the next cloud run to show.

To measure it (a paid call, the owner's decision): start Filow or `next dev` with
`OPENROUTER_API_KEY` set, then
`node tools/whiteboard/bench.mjs --base http://127.0.0.1:<port> --cloud --out <dir>` prints the
recipient and stops; the same command with `--yes-send-to <recipient id>` (for the default model:
`openrouter/google`) runs the ten questions, each now two to four calls.

## Round 4: the online path after its first paid run with the examiner

Measured by the coordinator (google/gemini-2.5-flash, round 3 code): strict 6/10 on the one valid
run (was 3 and 5); the second run was cut short by the provider (429 on lessons 6 to 10); layout
5/10. What failed: a refusal instead of a lesson (Krebs cycle), two reversed arrows the examiner
let through, a plot that did not match the worked example and two curves never drawn together, a
sum stated wrongly ("(0+1)/2 = 0"), lessons that state the outcome and skip the mechanism.

What changed, none of it measured on a real model yet (no paid call was made here):

| Failure | Change |
|---|---|
| Reversed arrows got through a general read | The arrows go in a call of their own, one sentence a line ("Error calculates True target."), each judged true, reversed or false, and the verdict is applied as given: turned, kept or dropped. An arrow without a verdict is dropped. |
| No lesson for the Krebs cycle | After a second lesson off the topic, the model first defines the topic in one sentence, writes a third lesson from that definition, and the examiner is given the definition too. Only then does the page say that no lesson could be made. Whether the lesson or the examiner was wrong in that run could not be told from the saved files (only the refusal was saved). |
| A wrong sum in a sentence | Every "expression = number" in the spoken sentences is recomputed in code (`checkArithmetic`). A wrong one has the lesson written again with the claim quoted; a step whose sum is still wrong is not shown. |
| Curves on separate plots, plot not matching the example | A plot can hold up to three functions and marks where the first two cross; the prompt asks for one plot when curves meet and for the function the example uses. |
| Outcome without mechanism | The examiner's "does it do what was asked" now names the one step each kind cannot do without (how inputs become outputs, what pushes a market back, a numeric example for a law, one concrete case for an idea such as recursion) and that rounding is said. A lesson without it is written again once. |
| 429 or 5xx from the provider | The same call is made again after 2, 5 and 10 seconds; after that the page says the online model is busy. No other source is used. |
| Crowded boards | A lesson with more than 7 boxes or 9 arrows continues on a fresh board ("Title (2)") that redraws the boxes it still points at; arrow labels may be 30 characters and are no longer cut at 22. |

Calls per online lesson now: three when it passes (lesson, review, arrows), up to eight in the worst
case (two rewrites, the definition, three reviews, the arrows). Each goes to the same recipient
under the same consent and carries only the question and the lesson's own text.

Layout of the saved paid run recomputed with this code: still 5/10, but the saved lessons carry
labels already cut at 22 characters by the older validator, so this number says little about new
lessons. The effect of the board limit, the continued board and the longer labels is for the next
paid run to show.

Local model: nothing new was measured in round 4. The three things to try (repairing a refused
relation, asking for relations per sentence, a bench on an idle graphics card) were not done. The
round 3 result stands: 4, 5 and 3 of 10 with the drawing rubric, held-out 3 of 10, and the page
keeps its advice under local lessons.

## Round 5: a provider that hides names, and what the paid runs still showed

Measured by the coordinator with round 4 code (two valid paid runs): strict 6/10 and 6/10, machine
layout 9/10 and 7/10. The Krebs cycle failures had one proven cause outside Filow: the OpenRouter
account redacts personal data in every prompt, so "Krebs" reached the model as `[PERSON_NAME]` and
the model taught some other cycle.

| Failure | Change |
|---|---|
| A name of the question hidden before the model saw it | A cloud answer that carries a bracketed placeholder the question did not contain (`placeholderLeaks` of `lib/pii/guard.ts`, unchanged) ends the lesson at once with code `redacted`: nothing more is asked, no board is shown. The page says, in five languages, that the cloud service hid a name or place, that the setting is in the OpenRouter account (privacy or guardrails), and offers "Explain it on this PC", which asks the local model the same question. |
| The same, when the model does not echo the placeholder | The lesson JSON starts with `"topic"`: the model restates what it was asked. Code compares the proper names of the question (capitalised words, possessives at its start: Krebs, Ohm, Bayes, Pythagorean) with that restatement and the title. A missing name is a lesson off the topic whatever the examiner says: written again once with the reason, then from a definition, then refused with the same "Explain it on this PC" button. |
| Reversed arrows the judge passed ("Error -> True Output (determines)") | The saved lesson shows both arrows on the final board. Code drops every arrow that has no verdict and turns every "reversed" one, so the judge was asked and answered "true": it answered wrong. Each line now names the two ends ("A = Error, B = True Output. Sentence: ...") and the judge also says who acts; "true" with `acts: "B"` is applied as reversed. Not measured on a real model. |
| Boxes left unconnected | After the review, boxes no arrow touches are named to the model once ("Not linked yet"); each link it proposes is judged like any other arrow (kept, turned or dropped); a box still alone is taken off the board unless its step draws nothing else. |
| A note or unit at the wrong step | A note may say which box it is about (`about`), and code also looks for a box's label in the note's words. A note that stands before the step that draws its box is moved to that step. Notes are not yet drawn next to their box: they stay in the notes column. |
| The key output missing from the board | The examiner names the one thing the final board must show (`must`); code looks for it in everything written on the board; when it is absent the lesson is written again once with "the board never shows ...". |

Calls per online lesson: three when it passes, one more when boxes are left alone (plus the
judging of the proposed links), up to ten in the worst case. Same recipient, same consent, only
the question and the lesson's own text.

OK Filow answers: the route adds one localized sentence after a cloud or FreeLLMAPI answer that
carries such a placeholder (the answer is streamed, so it cannot be withheld). The script writer
and the script translation already refused leaked placeholders before this round.

Every guard above has a test on the fake provider (one that replaces a name with `[PERSON_NAME]`)
and was seen failing when the guard is broken on purpose. No paid call was made here.

### Local model, round 5

Two changes, general: (1) a relation the fact check refused is written again once (turned round
or with a truer verb) and (2) a thing no relation touches is linked from the lesson's sentences;
both in one call, and what comes back goes through the same fact check before it can be drawn.
Skipped on the Lite tier and when the check cannot be read.

Measured on qwen3-vl:8b, RTX 3070 8 GB. `nvidia-smi` before the first run: 0 % load, 0.9 GB in
use (idle); during the runs 34 to 43 %, 7.5 GB (the model itself). Fresh reviewers, drawing rubric.

| Run | Machine | Strict | Arrows drawn | Boxes with no arrow |
|---|---|---|---|---|
| r5-t1 | 10/10 | 3/10 | 26 | 17 of 51 |
| r5-t2 | 8/10 | 4/10 | 32 | 14 of 49 |
| r5-t3 | 10/10 | 6/10 | 27 | 13 of 46 |
| r5-heldout | 9/10 | 4/10 | 20 | 20 of 47 |
| round 4 runs, for comparison | | (round 3: 4, 5, 3; held-out 3) | 15 to 18 | 20 to 22 of 47 |

The second round draws more true arrows (about half as many again on the first set) and leaves
fewer boxes alone, but the strict score does not move outside its noise: 3, 4 and 6 against 4, 5
and 3, held-out 4 against 3. The reviewers' reasons are the same in every run: the board does not
close the loop or show the output (Krebs cycle with no arrow back, supply and demand with the
price unlinked, photosynthesis without its inputs), and now and then a wrong sentence. That is
what this 8 GB model knows and can state, not a missing check. The target of 8 is not met, the
page keeps its advice under local lessons, and nothing here was tuned to the ten questions.
## How to repeat

1. Start Filow (or `next dev`) with Ollama running.
2. `node tools/whiteboard/bench.mjs --base http://127.0.0.1:<port> --out <dir>` (add `--set heldout`
   for the second set): the machine score and `summary.md` with every lesson in words.
3. Give `summary.md` to someone who did not write the prompts and does not know earlier scores.

Saved runs (outside the repo): `G:\FILOW\tmp\wb-tmp\` folders `bench-final-1`, `bench-final-2`,
`bench-plan-2`, `bench-plan-3`, `r2-run1..3`, `r2-heldout`, `r3-run1..3`, `r3-heldout`, `r4-run1`,
`r4-run2`, `r4-heldout`, `r5-t1..3`, `r5-heldout`.
