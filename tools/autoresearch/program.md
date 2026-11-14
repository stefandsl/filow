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
| AR-3 spoken forms, 5 languages | `apps/desktop/tts-numbers.js` | `node tools/autoresearch/ar3/evaluate.mjs [--split heldout]` |

### AR-3 details

- 60 frozen inputs per language (en, it, ru, ro, ja) with expected spoken forms, inside `ar3/evaluate.mjs`. Item i
  is held out when i % 3 == 2 (20), the rest are dev (40). Russian, Romanian and Japanese expected forms need a
  native check.
- Score: percent exact matches (case-insensitive, whitespace collapsed; Japanese without whitespace), averaged over
  the five languages. No model, no network, under one second. Dev misses go to `G:/FILOW/tmp/autoresearch/ar3/runs`.
- `ttft_p50_ms` in `results.tsv` is `-` for this track.
- Keep `apps/desktop/tts-round2.test.ts` green: a kept experiment that breaks it is a discard.

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
