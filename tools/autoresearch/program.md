# Filow autoresearch: rules for the experimenting agent

After github.com/karpathy/autoresearch (MIT). The owner or the orchestrator edits this file. The agent does not.

## The loop

1. Work on a branch `autoresearch/<track>-<date>` in its own worktree. Commit only there. No merge, push or tag.
2. Run the baseline first, unchanged. Record it.
3. One experiment = one idea in the ONE editable file of the track. Commit it.
4. Run the track's evaluator to a log file. Never print the log. Read only the summary block after `---`.
5. Score higher than the last kept commit: keep the commit. Equal or lower: `git reset --hard` to the last kept commit.
6. Log every experiment to `results.tsv` (tab-separated, untracked, outside the repository):
   `commit	score	ttft_p50_ms	status	description` with status `keep`, `discard` or `crash`.
7. Do not ask to continue. Stop at the experiment cap or after 4 discards in a row.
8. At the end, run the held-out split once for the baseline commit and once for the best kept commit. Never tune on held-out.

## Hard rules

- Edit only the one file. Never edit the evaluator, its worker, its config, the question builder or the questions.
- Fixed budget: one dev run takes about 5 minutes. A run past 10 minutes is killed and counts as `crash`.
- One score, higher is better. Ties: the simpler file wins (fewer lines, fewer rules).
- Simplicity criterion: a small gain that adds clutter is not worth it; equal score with less text is a win.
- Cap: 12 experiments per run (token cost).
- No paid or online calls. Local model only, on the evaluator's own server. Never the owner's Ollama (port 11434).
- Hidden runs only: no windows, no microphone, no desktop input. Kill only your own processes; leave none running.
- Scratch, logs and results on G: (`G:/FILOW/tmp/autoresearch/<track>`), never on C:.
- If other programs load the CPU, timing is observational; say so in the report.
- Before any merge to main, a blind critic checks the kept result and `npx vitest run`, `npm run typecheck`,
  `npm run lint` pass.

## Tracks

| Track | The one editable file | Evaluator |
|---|---|---|
| AR-1 local screen prompt, 5 languages | `apps/web/lib/buddy/local-target-prompt.ts` | `node tools/autoresearch/ar1/evaluate.mjs [--split heldout] [--record-baseline]` |
| AR-2 overlay motion | `apps/web/lib/buddy/overlay-motion-params.ts` | `node tools/autoresearch/ar2/evaluate.mjs` |
| AR-3 spoken forms, 5 languages | `apps/desktop/tts-numbers.js` | `node tools/autoresearch/ar3/evaluate.mjs [--split heldout]` |

### AR-2 details

- Every run builds apps/web, starts its standalone server on 127.0.0.1:4961, and drives the hidden Electron
  `ar2/qa.cjs` (offscreen, permissions denied, no desktop input, only port 4961 reachable): the pointer flight to
  "Settings" over two text obstacles and the jet-engine model for the sheet plus 24 camera poses, dark and light.
- Numbers (worst of both themes) as in overlay round 2B: leader crossings, leader clearance outside 8 px anchor
  discs (lane spacing), label overlaps, label identity changes, glyph and pill overlap with text, pointer max step,
  flight time, direction reversals, path/straight ratio, arrival ring centre to the landed tip.
- Score 0..100, weights in `ar2/evaluate.mjs` (`WEIGHTS`). No held-out split: the scene set is fixed. A kept change must
  keep the other overlay tests (`apps/web/lib/buddy/overlay-*.test.ts`) green. `overlay-motion-params.test.ts` pins
  the round 2B values and is expected to fail on a changed value; the orchestrator updates it when a kept result
  is merged.
- One run takes about 3.5 minutes (build about 90 s, driver about 100 s); `--no-build` reuses the last build.
- Noise: the worst-frame crossing count moves between runs (4 and 6 seen on the same commit, score 53.21 and
  51.78). Keep an experiment only when the score rises by more than 2 points.
- Baseline 14/11 on 21cbe9c (first run as 5d77704, same files): 53.21 (crossings 4, clearance 0 px, label overlaps 3, identity changes 0, text overlap
  0, max step 20.09 px, flight 616.7 ms, reversals 0, path ratio 1.156, ring offset 0 px).

### AR-3 details

- 60 frozen inputs per language (en, it, ru, ro, ja) with expected spoken forms, inside `ar3/evaluate.mjs`. Item i
  is held out when i % 3 == 2 (20), the rest are dev (40). Russian, Romanian and Japanese expected forms need a
  native check.
- Score: percent exact matches (case-insensitive, whitespace collapsed; Japanese without whitespace), averaged over
  the five languages. No model, no network, under one second. Dev misses go to `G:/FILOW/tmp/autoresearch/ar3/runs`.
- `ttft_p50_ms` in `results.tsv` is `-` for this track.
- Keep `apps/desktop/tts.test.ts` and `apps/desktop/tts-round2.test.ts` green: a kept experiment that breaks either is a
  discard. They pin some conventions the evaluator does not expect (bare English years, English dates and "dot"
  versions, Russian "одна тысяча", Italian "tre a cinque", Romanian digit-by-digit decimals, "ноль часов ноль минут").

### AR-1 details

- Model: lfm3-vl (LFM3 1.7B Q4_K_M), CPU, the tool's store `G:/FILOW/tmp/latency/ollama-std`, own server on
  127.0.0.1:11435, context 8192, temperature 0.3, through the product path `askOllama` with the ask route's
  `knownTarget` rule. 512 px JPEG-72 synthetic screens (the 40 pointing screens).
- Questions: `ar1/questions.json`, 60 per language (en, it, ru, ro, ja; where / show me / what does), built once by
  `ar1/build-questions.mjs`, seed 20261114. Labels stay as on the screen. Split 30 dev, 30 held out.
- Dev run: 6 dev questions per language, evenly spaced, languages interleaved (30 answers).
- Score: percent of answers with BOTH a strict POINT inside the target rectangle AND model-written words in the
  question's language (app-built pointer words do not count), averaged over the five languages, minus 10 points
  when the median first-token time is more than 10% above the recorded baseline of that split.
