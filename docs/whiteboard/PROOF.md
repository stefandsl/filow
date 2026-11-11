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
## Round 5b: the guards did harm, and what changed

Measured by the coordinator on round 5 code (paid, two runs): strict 2/10 and 4/10, where round 4
code had 6 and 6. The redaction refusal worked on the real service; the other guards cut content
and showed what was left.

| Seen in the paid runs | Cause | Change |
|---|---|---|
| Ohm's law starts at "Next, Current is ..."; the law is never stated; "voltage" is a lower-case lone box | `applyReview` in `generate.ts` left out every step whose sentence the examiner refused or whose sum did not come out ("a false sentence is not spoken, and what was drawn with it goes too"), and the validator then recreated the box the cut step had drawn from its id. Refused sentences were never part of what a rewrite was asked to fix. Which of the two verdicts cut step 1 cannot be told: the raw lesson was not saved. | No step is ever left out. A refused sentence or a wrong sum asks for the whole lesson again, once, with the examiner's reason. If the rewrite is no better, the first lesson is shown whole and the step is named under the board as not confirmed. If more than half the steps stay unconfirmed, the whole lesson is refused. |
| Compound interest "plots only the simple line" | The board drew both curves. `bench.mjs` wrote only the first function of a plot into `summary.md` (the `describe` and `finalBoard` lines), and `reviewText` gave the examiner the same one-curve text, so the reviewer and the examiner both read a plot that was not the one drawn. | Both print every curve of a plot. |
| Supply and demand plots only demand | Most likely the validator (`lesson.ts`, the plot branch): a plot whose first expression was already drawn was dropped as a repeat even when it added a second curve. Not provable without the raw lesson. | A plot is a repeat only when all its curves are. From now on `validatorLosses` records anything the validator does not keep. |
| Cells cut to "I = 2...", "Facto..." | `cleanText(v, 6)` in the cells branch of `lesson.ts`: six characters a value. | Forty characters. The layout shows every value in full: a row when it fits, otherwise one value under the other with the pointer at the left. |
| Binary search skips an iteration or stops early | No check | A stated middle is recomputed from the stated bounds ("low = 4, high = 7, mid = 9" is refused); a division stated as its floor passes only when the sentence says it is rounded down; the examiner is told that a trace must run to its end. The last point rests on the model. |
| "Network receives Input Data", "Oxygen exits Plant" still reversed | The judge was asked whether the sentence is true; these are true sentences drawn against the flow. | The judge is told that an arrow points from what gives to what receives, calls such a line reversed and gives the label for the turned arrow. Not measured. An arrow the judge says nothing about is now kept, not dropped. |

Rules every guard now follows, each a test (`lib/whiteboard/guards.test.ts`, the route tests):
a guard may repair, ask for one rewrite, or refuse the whole lesson with a reason. It never removes
a step, a curve or part of a worked example. The one thing still taken off is an arrow the judge
calls false, and that is written into the audit.

A last look in code after every guard (`finalProblems`): the first sentence does not open with
"Next", "Then", "Finally" (five languages); a note that speaks of a second curve has a plot with
two; no cell is cut; no plot uses a number above 2 that the lesson never gives. What it finds
before the rewrite is part of the rewrite request; what it still finds afterwards is said under
the board. It does not catch a plot whose slope is a number the lesson uses for something else
(the run 2 Ohm lesson: 6 ohms in the example, `2*x` plotted, 2 being the current).

Replayed offline over the twenty lessons a real model wrote before round 5
(`fixtures/cloud-r3.json`, from `wb-cloud\r3-run1` and `r3-run2`), with the examiner and the judge
played by the test:

- an examiner that agrees: all 18 lessons come out with every sentence and every item (the two
  Krebs lessons were written about a placeholder and are refused whole);
- an examiner that refuses the first sentence twice: every lesson is shown whole, step 1 named;
- six kinds of bad answers (unreadable, all false, every other false, all arrows false, arrows
  reversed, a rewrite that drops a step): each lesson is shown whole or not at all;
- the sum check, the validator and the note mover raise no false alarm on them and lose nothing.

Guards switched off by default because nothing shows they help (`GUARDS` in `generate.ts`):

| Guard | Why off | Switch |
|---|---|---|
| The examiner's "must show" word, looked for on the board | Model-dependent, new in round 5, the round that scored worse; each miss costs a rewrite | `WHITEBOARD_GUARDS=must` |
| Asking for links of lone boxes | Model-dependent, new in round 5 | `WHITEBOARD_GUARDS=links` |
| Taking a lone box off the board | On the saved lessons it would have removed ten boxes in four lessons, five of them the trace of a binary search | `WHITEBOARD_GUARDS=links,removeLoneBoxes` |

Still on: the redaction refusal (shown to work on the real service), the name check, the
examiner with its one rewrite, the sum check, the arrow judge, the note mover. Whether each helps
is what the next paid run can now show: every `lesson-N.json` holds `raw` (the lesson as the model
first wrote it), `lesson` (as shown) and `changes` (what each guard did), `summary.md` lists the
changes under each lesson, and `--raw` writes `summary-raw.md` so that one reviewer can score both.

No paid call was made here. Local model: unchanged by this round.
## Round 6, first part: raw against shown, and what was switched off

Measured by the coordinator on round 5b code (paid, two runs, four fresh reviewers), each lesson
scored twice, as the model wrote it and as Filow showed it:

| Run | Raw (before the guards) | Shown (after the guards) |
|---|---|---|
| r5-run1 | 7/10 | 6/10 |
| r5-run2 | 8/10 | 4/10 |

The guards lowered the score. The arrow judge turned or removed correct arrows (the SYN-ACK
redrawn from client to server, the third leg of the handshake removed), the examiner marked
correct steps as not confirmed (Ohm's law itself), and rewrites were asked for non-faults. In the
raw lessons the only outright failure was the Krebs cycle (the account hides the name, the model
writes about the nitrogen cycle) plus one or two arrow slips.

Decision, by that evidence. On by default, because it fixes a proven failure or cannot make a
correct lesson worse:

- the refusal of a question the provider redacted (code `redacted`, the localized message);
- the comparison of the topic's names in code: a lesson that never names what was asked is
  written again once, then from a definition, then refused (code `topic`), never shown;
- the validator: cells in full, every curve of a plot, and now ten items a step and fourteen boxes
  (the caps of six and ten had cut the arrow from CO2 to the plant and the box "Starch" with its
  arrow in two of the raw lessons);
- the look at the first sentence: one that opens with "Next" asks for one rewrite, kept only if
  it is better.

Off by default, behind `WHITEBOARD_GUARDS` (`examiner`, `arrows`, `sums`, and as before `must`,
`links`, `removeLoneBoxes`): the sentence examiner with its marks and its rewrite, the arrow
judge, the rewrite for a sum. The sums are still recomputed, as a "noted only" line in the audit
of the bench.

Calls per online lesson: one (it was three, and up to ten). A lesson off the topic by its names
costs up to four (lesson, rewrite, definition, third lesson); a first sentence that opens with
"Next" costs two.

Proved offline on the raw lessons of those two runs (`fixtures/cloud-r5-raw.json`, twenty raw
answers; `lib/whiteboard/guards.test.ts`): replayed with the defaults, each of the eighteen
lessons on the topic is shown after exactly one call with every sentence and every box, arrow,
formula, curve, cell and sketch the model wrote; the two written about the nitrogen cycle are
refused whole. What differs from the raw answer is listed and pinned by the test: a remark, a
row of cells or a plot the model wrote twice is drawn once (nine items in twenty lessons), a
remark may move to the step that draws its box, and a remark about one box carries its name.

Two defects of the raw lessons that were ours:

- Drawn twice: a plot that draws every curve of an earlier plot and one more now takes that
  plot's place on the board (supply alone, then supply and demand: one plot, not two with supply
  on both); a row of cells that begins with all the values of an earlier row replaces it (a
  trace that grows by a line is one block). "Connection established" written for the client and
  for the server is one remark.
- Unit and variable remarks not tied to their box: a remark the model wrote about one box is
  written with that box's name in front ("Current (I): Measured in Amperes (A)"). It still stands
  in the notes column, not beside the box.

Layout of those twenty raw lessons: no problem on the wide board; on the narrow one seven dense
steps still have an arrow or a box on a label. That is open.
## Round 7: the local checks, measured on and off

The same honesty check as for the online path, on the local model (qwen3-vl:8b, RTX 3070 8 GB).
The local path has no single "raw" lesson to compare with (its steps are picked from a checked
plan), so it is an A/B: three runs of the ten questions with the local checks on (the default)
and three with `WHITEBOARD_LOCAL_OFF=sentences,relations,repair` (no sentence examiner, no fact
check of the plan's relations, no second round). `nvidia-smi` before each run: 0 to 8 % load (the
7.6 GB in use from the second run on is the model itself, kept loaded). Two fresh strict
reviewers per run, drawing rubric.

| Run | Checks | Machine | Reviewer A | Reviewer B | What the failures mostly were |
|---|---|---|---|---|---|
| r7-on1 | on | 7/10 | 3 | 3 | thin or unlinked boards |
| r7-on2 | on | 9/10 | 4 | 4 | thin or unlinked boards |
| r7-on3 | on | 8/10 | 4 | 6 | thin or unlinked boards |
| r7-off1 | off | 8/10 | 4 | 5 | false drawings |
| r7-off2 | off | 10/10 | 1 | 1 | false drawings |
| r7-off3 | off | 8/10 | 4 | 3 | false drawings |

Mean of the six scores: 4.0 with the checks on, 3.0 with them off. Three runs a side is little
and the spread is wide (one run without the checks scored above one run with them), so the
difference in the number is weak evidence. The difference in kind is not: without the checks all
six reviews name false arrows as the main failure ("Voltage is equal to Current", "Leg is
Hypotenuse", "Supply increases Price"), with them none does. Unlike the online path, where the
guards lowered the score, nothing here shows a local check doing harm, so the local defaults stay
as they are: all three on. They were measured together; which of the three carries the gain was
not measured. A run with the checks on takes about 25 minutes for ten lessons on this card, one
without about 10.

The ceiling is unchanged: with the checks on, the lessons fail because the board is thin (the
outputs of photosynthesis not linked, no supply and demand curves, the cycle not closed), which
is what this 8 GB model can state, and the page keeps its advice under local lessons.

Also in this round, on the narrow board: a label that finds no free place on its arrow may stand
beside it. On the twenty raw online lessons that took the steps with an arrow or a box on a label
from eight to three; the wide board has none. The pen in time with the voice, the blackboard and
the video are described in `docs/whiteboard/PEN-AND-VIDEO.md`.
## Round 8, part B: the online lesson, by prompt and by adding only

Not measured on a real model yet: no paid call was made here.

What the strict reviews of the raw lessons (r5-run1, r5-run2) still found, and what was done about
each. None of it is an examiner that edits: the prompt asks for more, the validator reads more,
and one question adds what is missing.

| Defect in the raw lessons | Change |
|---|---|
| A wrong-way or invented arrow (neural network, both runs; "New Principal becomes Interest") | The prompt asks for an arrow as a sentence, `{"kind":"edge","who":"data","does":"feeds","to":"network"}`: who acts comes first by construction and the verb is the label. The validator reads `who`/`does` and still reads `from`/`text`. Before answering the model is asked to read every arrow back as a sentence. |
| A formula with letters nobody named (`A = P(1 + r/n)^{nt}`) | The prompt asks for every letter to be named in the step. Code then looks: the single letters of each formula against everything said and written up to that step. For what is still unnamed, one question ("the legend") and a note in the formula's step: "n = periods a year, t = years". |
| Plots with unlabelled axes | A plot carries `x` and `y` names, drawn at the axes. A plot without them is part of the same one question. |
| Boxes left alone | Prompt only: every box is the who or the to of at least one arrow. |

The legend adds a note and names; it never changes or removes anything the model wrote, and when
its answer is no use the lesson is shown as it was. It can be switched off
(`WHITEBOARD_GUARDS=nolegend`). On the twenty raw lessons of the paid runs, replayed: every lesson
on the topic still comes out exactly as written; 6 to 12 of them would have had the one extra
question (every plot of those runs predates axis names). Calls per online lesson: one, or two when
a legend is asked for.

Names an online account hides (owner decision of 11/11/2026: keep the account's filter, work
around it for whiteboard questions only): when the answer carries a placeholder or never uses a
name of the question, the question is sent once more with the name spelled out letter by letter
and the model told why; the lesson is then written normally and the page says what was done. If
the spelled name is hidden too, the lesson is refused as before. Which spelling the real filter
lets through is not known yet: `node tools/whiteboard/echo.mjs --yes-send --name Krebs` prints it
(a paid call of a few tokens), and `WHITEBOARD_NAME_SPELLING` picks `spaced`, `hyphen` or `dots`.
See `docs/okfilow/OUTBOUND.md`.

The whiteboard's online model can be its own (`WHITEBOARD_CLOUD_MODEL`, default: OK Filow's). The
consent recipient follows that model's maker, and the whiteboard's notice reads it from
`/api/whiteboard/recipients`.
## Round 9: three online models measured, the default changed, two drawings no longer dropped

Measured by the coordinator on round 8 code (paid, the ten proof questions, two runs a model, six
fresh strict reviewers; `wb-cloud\m-flash-run1/2`, `m-sonnet-run1/2`, `m-carbon-run1/2`):

| Online model | Strict | Machine | Note |
|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 9/10 and 9/10 | 9 and 9 | no factual error found in any lesson |
| google/gemini-2.5-flash | 6/10 and 6/10 | 6 and 4 | |
| google/gemini-4-carbon | 5/10 and 5/10 | | 3 and 4 concepts had no lesson (time limit, empty answer); the lessons that arrived passed but one |

The hidden-name work-around held on the real service (the Krebs cycle got a real lesson on Flash
and on Sonnet); the spaced spelling comes back unchanged, lower case is still hidden.

Owner decision of 11/11/2026: the whiteboard's online default is Claude Sonnet 5.5. It can be
changed to Gemini 2.5 Flash in the whiteboard and in Settings, each under the yes of its own
maker; OK Filow's answers keep their model. See `docs/okfilow/OUTBOUND.md`.

Both Sonnet reviews named one defect of ours, and the lesson files show the rules that did it
(`changes` in `lesson-2.json` and `lesson-6.json`: "the validator did not keep 1 formula", "1
cells"):

| Lesson | What was dropped | The rule | Now |
|---|---|---|---|
| Pythagoras, step 6 | the closing formula `a^2 + b^2 = c^2` | a formula already written (step 1) counted as a repeat anywhere in the lesson | a formula is a repeat only inside its own step; shown again later it is kept, and the board writes it anew as the newest thing, once |
| Binary search, steps 3 and 5 | the row of cells | the same row with the same pointer counted as a repeat anywhere in the lesson, so the step that spoke of it drew nothing | kept in every step that shows it; the board holds one row and redraws it in that step |
| Binary search (round 5 raw) | the row narrowed to one value | "one value is not a row" | a row of one value is a row |

Fixture tests from those five saved lessons (`fixtures/cloud-m-dropped.json`): every formula and
every row of cells the model wrote is in its step, no such step becomes a text card, the theorem
is on the final board once and drawn in the last step. Not measured on a paid run after the fix.
Also from those reviews and from the Carbon run, by prompt or mechanically, none of it measured on
a paid run yet:

- Time: an online answer has four minutes (it had two) and a whole lesson ten; while the lesson is
  being written the page says how many seconds it has waited. A reasoning model had given no
  lesson for 3 and 4 of 10 questions at the old limit.
- A lesson cut short to a single step is asked for once more and never shown (the one-step
  recursion of the Carbon run).
- A remark that defines something of its own ("n = the whole number we want") is no longer given
  the name of the box the model pinned it to (it read "Base case: n = ...").
- The mark where two curves cross is not drawn where they merely start from the same point (both
  at 1000 in year 0); a crossing inside the plot is.
- The prompt asks for the result on the board in the last step.
- `echo.mjs` reports a spelling the provider did not answer for (a 429) as not tested.

Replayed over the twenty raw lessons of the two Sonnet runs (`fixtures/cloud-sonnet-raw.json`):
the eighteen on the topic are shown as written, with every formula and row of cells in its step,
after one call or two (the legend); the two saved first answers about another cycle are refused.
## How to repeat

1. Start Filow (or `next dev`) with Ollama running.
2. `node tools/whiteboard/bench.mjs --base http://127.0.0.1:<port> --out <dir>` (add `--set heldout`
   for the second set, `--raw` for the lessons before the guards): the machine score and `summary.md`
   with every lesson in words and what the guards changed.
3. Give `summary.md` to someone who did not write the prompts and does not know earlier scores.

Saved runs (outside the repo): `G:\FILOW\tmp\wb-tmp\` folders `bench-final-1`, `bench-final-2`,
`bench-plan-2`, `bench-plan-3`, `r2-run1..3`, `r2-heldout`, `r3-run1..3`, `r3-heldout`, `r4-run1`,
`r4-run2`, `r4-heldout`, `r5-t1..3`, `r5-heldout`, `r7-on1..3`, `r7-off1..3`.
