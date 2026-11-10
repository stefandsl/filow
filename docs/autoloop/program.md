# Filow autoloop - program.md

This is the self-improvement loop for Filow, modelled on karpathy/autoresearch:
- `tools/autoloop/score.mjs` and `tools/autoloop/checks/` are fixed, like autoresearch's `prepare.py`.
- The code base is the thing being improved, like `train.py`.
- `docs/autoloop/STANDARDS.md` is the target; `docs/GOAL.md` is the north star and the quality bar.
- This file holds the instructions and is edited by humans (or by the daily review, see section 5).

## 0. Where you work

Never in the main checkout (`G:\FILOW`). One session owns main and merges branches into it at any
hour; uncommitted edits there block its merges or get lost. Every run, scheduled or not, works in its
own git worktree on its own branch, cut from local `main`:

```
git -C G:/FILOW worktree add G:/filow-wt/autoloop-<date> -b autoloop/<date> main
cd G:/filow-wt/autoloop-<date>
export npm_config_cache=G:/caches/npm ELECTRON_CACHE=G:/caches/electron electron_config_cache=G:/caches/electron ELECTRON_BUILDER_CACHE=G:/caches/electron-builder
npm ci                                       # then: node node_modules/electron/install.js if dist is missing
npm run build                                # every app: PowerPoint pane, web, session server, browser extension
(cd apps/desktop && npm run vendor)
```

Build outputs are not in git. A package made after building only the web app has no session server
and shows "Filow failed to start" at launch; `apps/desktop/before-pack.js` now refuses to package
when an output is missing or older than its sources. A test app that does not reach "main window
shown" in its `startup.log` within a minute has failed: the log says why ("startup failed at ...").

Agent worktrees made by the harness are cut from `origin/main`, which is behind local main: check
`git merge-base --is-ancestor main HEAD` and fast-forward before doing anything.

Untracked state is seeded from the main checkout and never written back, except the results log:
- `tmp/autoloop/results.tsv`: copy it in at the start, append your new lines to
  `G:/FILOW/tmp/autoloop/results.tsv` at the end.
- `tmp/autoloop-profile`: copy `settings.json`, `script.md`, `bin` and `models` from
  `G:/FILOW/tmp/autoloop-profile` (installed speech model and cloudflared; nothing is downloaded again).

## 1. The metric

`node tools/autoloop/score.mjs` prints one score (0-100, higher is better) and hard gates.
- **Gates:** every test passes (`npm test`), the typecheck is clean (`npm run typecheck`, full mode)
  and lint is clean (`npm run lint`, 0 errors and 0 warnings). A change that fails a gate is never kept.
- **Score:** the weighted share of the scorecard checks that pass, with partial credit (for example 5 of 8 windows sandboxed).
- **Tracking quality:** the local gauntlet results feed TRK-1 and TRK-2
  (`GAUNTLET=1 GAUNTLET_PROVIDERS=clef-local npx vitest run apps/web/lib/gauntlet/run.test.ts`, local model only).
- **Results log:** every run appends to `tmp/autoloop/results.tsv` (untracked). Read it first: it is the memory of what was already tried.

## 2. One experiment

1. Read `results.tsv`, the failing checks in the last full score, `MANUAL.md` (open rows) and `STANDARDS.md`.
2. Pick **one** improvement, the highest of: weight, then smallest safe diff, then user value (STANDARDS "What users want"). Use the ponytail rule: the smallest change that fully solves it.
3. Reproduce first. For a bug or a missing behaviour, show it failing end to end (packaged app, CDP probe or a failing test).
4. Make the change, plus a test that fails without it (show the mutation).
5. Run `node tools/autoloop/score.mjs --quick`. Run the full mode before keeping anything that touches the desktop shell, dependencies or the build.
6. For any change to `apps/desktop`, the build or security: package inside your worktree (`npx electron-builder --win --dir -c.directories.output=<worktree>/release-autoloop-<letter>`), launch it on the worktree's own profile (`FILOW_USER_DATA_DIR=<worktree>/tmp/autoloop-profile FILOW_PORT=4787 FILOW_SESSION_PORT=4788`, plus `--remote-debugging-port=9344`), and prove the app still works. Check with `netstat` that those ports are free first; if another session holds them, wait, then skip the end-to-end step and say so.
7. Tuning anything against a corpus (prompts, thresholds): keep a held-out corpus you did not tune on, written before you measure, and report both. Never tune on the held-out set.
8. **Keep** if every gate passes, the score is higher than or equal to the best kept score, and the end-to-end check passed. Equal is allowed only when the change fixes a reproduced bug or adds a missing test. Commit it on your branch with a clear message (no co-author lines, no em dash).
9. **Discard** otherwise: `git checkout -- <your files>` inside your own worktree.
10. Stop test apps by their own PID with the whole process tree (`taskkill /PID <pid> /T /F`), never by image name and never only the main process. Orphaned children (tunnels) lock the release folder and stay online.
11. Log one row in `docs/autoloop/JOURNAL.md`: date, check id, kept or discarded, score before and after, one sentence on what was learned. The file merges with the union driver (`.gitattributes`), so rows from parallel branches never conflict: append rows, never rewrite old ones.

## 3. Boundaries

- Files a track owns (table in `docs/GOAL.md`) are off limits while that track's worktree or unmerged branch exists (`git -C G:/FILOW worktree list`, `git branch --no-merged main`). Put what you find there into `docs/autoloop/HANDOFF.md`.
- Never commit on main, merge, push, tag or release. The orchestrating session or the owner merges your branch after reviewing it.
- Local first: no paid API calls; Ollama models only for AI-assisted checks; never call `/api/local/plan` (it can make a paid call). Use Claude subagents for reviews, never `codex exec`.
- Never write to C:. Never commit `.env` or keys. No co-author lines. No em dashes.
- Never edit `tools/autoloop/score.mjs`, `tools/autoloop/checks/` or `STANDARDS.md` during an experiment. Gaming the metric is a failure.
- Never start a server from `apps/web/.next`: it makes `next build` hang.

## 4. Reviews (elephant and goldfish, and the adversary)

Every 5 kept experiments, or at the end of a daily run:
- **Goldfish:** an `egm:egm-comprehension` agent with no context reads the diff as a newcomer. Unclear code is a finding.
- **Elephant:** an `egm:egm-codebase-details` agent checks the diff against the whole code base for reuse, duplication and drift.
- **Adversary**, for any change to tracking, the guard, security or privacy: a fresh agent is given the code and the claim, not your conclusion, and told to break it with its own cases.
- Findings that are real become the next experiments.

## 5. Recursive improvement (the loop improves the loop)

Once a day, after the experiments:
1. Read `results.tsv` and `JOURNAL.md` for the day. Which kinds of change were kept, which were discarded, and where did time go?
2. Run `last30days` (or a web search) once a week on the competitor list in STANDARDS.md, and add new user complaints or new standards as proposed rows in `docs/autoloop/PROPOSED-STANDARDS.md`. A human promotes them into STANDARDS.md.
3. Propose edits to this `program.md` in `docs/autoloop/PROPOSED-PROGRAM.md` (for example a better order, a new check script). New check scripts may be added to `tools/autoloop/checks/` only in this review step, never mid-experiment, and each new check must be shown able to fail before it counts: either it fails on the current code, or it fails on a deliberate mutation (for example an injected image without alt text for the axe check) and the run that shows this is logged in JOURNAL.md. A check that cannot fail measures nothing.
   End-to-end checks that need the packaged app live in `tools/autoloop/e2e/` and write `tmp/autoloop/<name>.json`; score.mjs reads those files when they are under 48 hours old, and treats a missing or stale file as failing.
4. **The stop condition** ("nothing left to improve"): all gates pass, the full score is 100, every manual item in `MANUAL.md` is marked verified, and a fresh weekly research pass finds no new standard or complaint. Report that to the user; do not stop on your own judgment before it.

## 6. Daily schedule

The scheduled task "filow-autoloop" runs this file once a day at 02:01 in a fresh worktree
(`G:/filow-wt/autoloop-<date>`, branch `autoloop/<date>`): one full score, experiments until about 3
hours have passed or the queue is empty, the reviews, the recursive step, a summary row in
`docs/autoloop/JOURNAL.md`, all committed on its branch. It then removes its worktree (the branch
stays) and reports the branch for the orchestrator or the owner to merge.
