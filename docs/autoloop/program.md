# Filow autoloop - program.md

This is the self-improvement loop for Filow, modelled on karpathy/autoresearch:
- `tools/autoloop/score.mjs` and `tools/autoloop/checks/` are fixed, like autoresearch's `prepare.py`.
- The code base is the thing being improved, like `train.py`.
- `docs/autoloop/STANDARDS.md` is the target.
- This file holds the instructions and is edited by humans (or by the daily review, see section 5).

## 1. The metric

`node tools/autoloop/score.mjs` prints one score (0-100, higher is better) and hard gates.
- **Gates:** every test passes, and (in full mode) the typecheck is clean. A change that fails a gate is never kept.
- **Score:** the weighted share of the scorecard checks that pass, with partial credit (for example 5 of 8 windows sandboxed).
- **Tracking quality:** when a local gauntlet result exists, it feeds TRK-1 and TRK-2.
- **Results log:** every run appends to `tmp/autoloop/results.tsv` (untracked). Read it first: it is the memory of what was already tried.

## 2. One experiment

1. Read `results.tsv`, the failing checks in the last full score, and `STANDARDS.md`.
2. Pick **one** improvement, the highest of: weight, then smallest safe diff, then user value (STANDARDS "What users want"). Use the ponytail rule: the smallest change that fully solves it.
3. Reproduce first. For a bug or a missing behaviour, show it failing end to end (packaged app, CDP probe or a failing test).
4. Make the change, plus a test that fails without it.
5. Run `node tools/autoloop/score.mjs --quick`. Run the full mode before keeping anything that touches the desktop shell, dependencies or the build.
6. For any change to `apps/desktop`, the build or security: package to `release-autoloop` (`npx electron-builder --win --dir -c.directories.output=G:/FILOW/release-autoloop`), launch it on its own profile and ports (`FILOW_USER_DATA_DIR=G:\FILOW\tmp\autoloop-profile FILOW_PORT=4787 FILOW_SESSION_PORT=4788`, plus `--remote-debugging-port=9333` for CDP probes), and prove the app still works. Stop only that test app afterwards.
7. Before editing, copy every file you will touch to `tmp/autoloop/backup/<experiment>/` (other sessions have uncommitted work in this folder, so git cannot be the undo).
8. **Keep** if every gate passes, the score is higher than or equal to the best kept score, and the end-to-end check passed. Equal is allowed only when the change fixes a reproduced bug or adds a missing test. Leave the change in the working tree and list its files in the journal. The user decides when kept work is committed: never commit, push or release on your own.
9. **Discard** otherwise: restore exactly your files from the backup (never `git checkout .` or `git stash`).
10. Stop test apps with their whole process tree (`taskkill /PID <pid> /T /F`), never only the main process. Orphaned children (tunnels) lock the release folder and stay online.
11. Log one line in `docs/autoloop/JOURNAL.md`: date, check id, kept or discarded, score before and after, one sentence on what was learned.

## 3. Boundaries

- Files owned by other sessions, which you must not edit while those sessions are active: `apps/desktop/okfilow*`, `apps/web/lib/buddy`, `apps/web/app/okfilow` (OK Filow session), and `packages/core/src/engine.ts`, `gate.ts`, `docs/gauntlet/corpus` (P1 tracking session). Put the items you find there into `docs/autoloop/HANDOFF.md` for those sessions instead.
- Local first: no paid API calls; Ollama models only for AI-assisted checks. Codex credits are nearly gone, so use Claude subagents for reviews.
- Never write to C:. Never commit `.env` or keys. Never push or release: the user does that. No co-author lines. No em dashes.
- Never edit `tools/autoloop/score.mjs`, `tools/autoloop/checks/` or `STANDARDS.md` during an experiment. Gaming the metric is a failure.
- Stop `next build` hangs before they happen: stop any server running from `apps/web/.next` before building.

## 4. Reviews (elephant and goldfish)

Every 5 kept experiments, or at the end of a daily run:
- **Goldfish:** an `egm:egm-comprehension` agent with no context reads the diff as a newcomer. Unclear code is a finding.
- **Elephant:** an `egm:egm-codebase-details` agent checks the diff against the whole code base for reuse, duplication and drift.
- Findings that are real become the next experiments.

## 5. Recursive improvement (the loop improves the loop)

Once a day, after the experiments:
1. Read `results.tsv` and `JOURNAL.md` for the day. Which kinds of change were kept, which were discarded, and where did time go?
2. Run `last30days` (or a web search) once a week on the competitor list in STANDARDS.md, and add new user complaints or new standards as proposed rows in `docs/autoloop/PROPOSED-STANDARDS.md`. A human promotes them into STANDARDS.md.
3. Propose edits to this `program.md` in `docs/autoloop/PROPOSED-PROGRAM.md` (for example a better order, a new check script). New check scripts may be added to `tools/autoloop/checks/` only in this review step, never mid-experiment, and each new check must be shown able to fail before it counts: either it fails on the current code, or it fails on a deliberate mutation (for example an injected image without alt text for the axe check) and the run that shows this is logged in JOURNAL.md. A check that cannot fail measures nothing.
   End-to-end checks that need the packaged app live in `tools/autoloop/e2e/` and write `tmp/autoloop/<name>.json`; score.mjs reads those files when they are under 48 hours old, and treats a missing or stale file as failing.
4. **The stop condition** ("nothing left to improve"): all gates pass, the full score is 100, every manual item in `MANUAL.md` is marked verified, and a fresh weekly research pass finds no new standard or complaint. Report that to the user; do not stop on your own judgment before it.

## 6. Daily schedule

The scheduled task "filow-autoloop" runs this file once a day: one full score, experiments until about 3 hours have passed or the queue is empty, the reviews, the recursive step, and then a short report in `docs/autoloop/JOURNAL.md`.
