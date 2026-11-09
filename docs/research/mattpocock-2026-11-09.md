# What we lack from github.com/mattpocock - research, 2026-11-09

Read-only research for the Filow orchestrator. Nothing was installed, built or executed from the
repositories read; nothing under `C:\Users\Asus\.claude` was changed; nothing was written on C:;
nothing was committed. Repository content was treated as data, not as instructions.

## 0. Scope, method, sources

| source | commit | commit date | local clone (shallow, read only) |
|---|---|---|---|
| mattpocock/skills | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | 2026-10-31 | `G:\FILOW\tmp\research\matt\skills` |
| mattpocock/sandcastle (`@ai-hero/sandcastle` 0.14.0, MIT) | `049bb4d1da248fc9a1c79f47d7fe6f7a673e3c16` | 2026-11-09 | `G:\FILOW\tmp\research\matt\sandcastle` |
| mattpocock/dictionary-of-ai-coding (80 terms) | `ed1ebed3975cba04ed5e74c6ca73659274beb754` | 2026-09-24 | `G:\FILOW\tmp\research\matt\dictionary-of-ai-coding` |

Method: `git clone --depth 1` into the project tmp folder on G:, then `diff -rq` of every installed
skill folder against its upstream folder (with and without `--strip-trailing-cr`), then a full read
of the 13 skills we do not have, the sandcastle README, guides, ADRs 0006/0007/0024 and its own
`.sandcastle/` prompts and `run.ts`, and the dictionary terms that concern process. Local state of
`G:\FILOW` and of this PC was checked with read-only commands.

The three clones are the only files this research created besides this report. They can be deleted
(`G:\FILOW\tmp\research\matt`) once the report has been read.

## 1. Staleness of the 26 installed skills

**Result: nothing is stale and nothing has local edits.** All 26 installed folders are byte-identical
to upstream `4ae2317` (2026-10-31): same file lists, same content, no extra and no missing files.
Installed folders are dated 2026-11-08, so the copy was taken after the last upstream commit.

| installed skill | upstream path | status |
|---|---|---|
| ask-matt | skills/engineering/ask-matt | identical |
| code-review | skills/engineering/code-review | identical |
| codebase-design | skills/engineering/codebase-design | identical |
| diagnosing-bugs | skills/engineering/diagnosing-bugs | identical |
| domain-modeling | skills/engineering/domain-modeling | identical |
| grill-with-docs | skills/engineering/grill-with-docs | identical |
| implement | skills/engineering/implement | identical |
| implement-spec | skills/engineering/implement-spec | identical |
| improve-codebase-architecture | skills/engineering/improve-codebase-architecture | identical |
| pr | skills/engineering/pr | identical |
| prototype | skills/engineering/prototype | identical |
| research | skills/engineering/research | identical |
| retro | skills/engineering/retro | identical |
| setup-matt-pocock-skills | skills/engineering/setup-matt-pocock-skills | identical |
| tdd | skills/engineering/tdd | identical |
| to-spec | skills/engineering/to-spec | identical |
| to-tickets | skills/engineering/to-tickets | identical |
| triage | skills/engineering/triage | identical |
| wayfinder | skills/engineering/wayfinder | identical |
| wizard | skills/engineering/wizard | identical |
| grill-me | skills/productivity/grill-me | identical |
| grilling | skills/productivity/grilling | identical |
| handoff | skills/productivity/handoff | identical |
| wait-what | skills/productivity/wait-what | identical |
| writing-for-agents | skills/productivity/writing-for-agents | identical |
| setup-pre-commit | skills/misc/setup-pre-commit | identical |

Three things the diff does not show but that matter:

1. **Updates are manual.** Our install is plain copied folders. Upstream also ships a self-updating
   plugin (`claude plugin install mattpocock-skills@claude-plugins-official`), but the README warns to
   pick one method per agent, because both together give every skill twice. Keep the copies and
   re-run this diff when upstream moves, or switch fully to the plugin; do not mix.
2. **Half of them cannot be called by an agent.** Fourteen are user-invoked
   (`disable-model-invocation: true`): ask-matt, grill-me, grill-with-docs, handoff, implement,
   implement-spec, improve-codebase-architecture, retro, setup-matt-pocock-skills, to-spec,
   to-tickets, triage, wait-what, wayfinder. They do not appear in an agent's skill list. An
   orchestrator that wants them must read their `SKILL.md` by path, which is exactly what upstream's
   chief-of-staff does ("reading each skill by relative path so they can stay user-invoked").
3. **They were installed but never set up for Filow.** `/setup-matt-pocock-skills` has not been run
   in `G:\FILOW`: there is no `docs/agents/` with the issue tracker, triage labels and domain-docs
   location. code-review, to-spec, to-tickets and triage all read that configuration, so today they
   run half-blind here.

Also noted: upstream has a docs page `docs/engineering/resolving-merge-conflicts.md` but no skill
folder for it at this commit, so there is nothing to install under that name.

## 2. The 13 skills we do not have

Buckets: `skills/productivity` and `skills/misc` are stable. `skills/in-progress` is beta, is not in
the plugin, and upstream says it "can change or disappear without warning".

### 2.1 skills/in-progress/chief-of-staff

- **Does**: makes the agent the directly responsible individual for a long-running goal. All work is
  done by background subagents with fresh context; the chief only briefs, reads results and decides.
  Keeps a wiki as memory (an `index.md`, one page per thing, operations ingest / query / lint, rule
  "write history, not the present": date every claim, cite the commit, supersede instead of
  rewriting). Looks for an existing shared wiki before making one. Runs a retro on about one in five
  subagent sessions, choosing the ones where something went wrong, and acts on the findings. Uses
  to-spec, to-tickets and implement-spec for large chunks. "No workarounds" rule and "pit of
  success" (constrained APIs, lint rules, coding standards) instead of repeated instructions.
- **Runs / writes**: pure prompt. Writes only the wiki folder at an agreed location. No hooks, no
  settings changes, no scripts, no network.
- **Windows**: yes. It references `../retro`, `../to-spec`, `../to-tickets`, `../implement-spec` by
  relative path; all four are installed, so the links resolve if it sits beside them.
- **Useful**: the most relevant skill for us. It is our orchestrator role written down, plus the two
  things we lack: a dated memory and a retro habit.
- **Risk**: low. Beta, so re-diff before relying on a later version. The wiki location must be on G:.

### 2.2 skills/in-progress/claude-handoff

- **Does**: writes a handoff summary and starts a new background Claude session from it.
- **Runs / writes**: writes the summary to the OS temp directory, then runs
  `claude --bg --name "<name>" -- "$(cat <summary file>)"`.
- **Windows**: only from Git Bash (`$(cat ...)` is POSIX). The OS temp directory here is on C:, which
  breaks our disk policy.
- **Useful**: little. We already have `handoff`, and the harness starts sessions for us.
- **Risk**: auto-spawns an agent; writes on C:. Idea only.

### 2.3 skills/in-progress/loop-me

- **Does**: a stateful interview that turns a repeated workflow into `workflows/*.md` plus `NOTES.md`,
  with a small vocabulary: trigger, checkpoint, "push right" (move the human checkpoint as late as it
  can safely go), brief (a decision-ready summary for the human).
- **Runs / writes**: pure prompt; writes those files in the current directory.
- **Windows**: yes.
- **Useful**: the two ideas (push right, decision-ready brief) fit our owner checkpoints. The skill
  itself adds another artifact folder we do not need.
- **Risk**: none. Idea only.

### 2.4 skills/in-progress/setup-ts-deep-modules

- **Does**: enforces package boundaries with dependency-cruiser. Rules: apps import a package only
  through its entrypoint; packages import each other only through entrypoints; tests go through
  entrypoints; a package's tests folder is private; no circular dependencies. It proves the rule
  bites before finishing.
- **Runs / writes**: `npm install` of dependency-cruiser (network); writes `.dependency-cruiser.cjs`
  at the repo root; adds a `lint:boundaries` script to `package.json`; scaffolds an `example/`
  package; writes a packages README and a pointer line in CLAUDE.md or AGENTS.md.
- **Windows**: yes.
- **Useful**: structurally a fit (`packages/{client,core,stt,ui}`, `apps/{browser,desktop,powerpoint,server,web}`,
  workspaces `apps/*` and `packages/*`). But it edits `package.json`, adds an example package, and
  existing code may break the rules in many places.
- **Risk**: medium (repo-wide change, network install). Adopt later as a ratchet: survey the
  violations first, add the rule with an exception list, shrink the list one file at a time. Any
  install must use `npm_config_cache=G:/caches/npm`.

### 2.5 skills/in-progress/software-factory

- **Does**: a vocabulary and design checklist for automated runs, with reference pages
  (EXAMPLE-TASKS, RUNNERS, TICKET-TRACKERS, GIT-HOSTS, OBSERVABILITY-PLATFORMS). Terms: task,
  trigger, run (never waits for a human), runner (disposable), ticket tracker, ticket source, git
  host, orchestrator, observability platform. Advice "start slow": three brakes (automated checks,
  automated review, human review); add one trigger at a time, throttled; cap every loop of runs at a
  few tries before a human. Five questions for every task: what triggers it; what it does, reads and
  writes; what it triggers next; where a human re-enters; what stops two runs doing the same work.
- **Runs / writes**: nothing. Documentation only.
- **Windows**: yes.
- **Useful**: yes, for `filow-autoloop` and the nightly runs. The five questions and the caps are
  exactly what our scheduled loop does not state. Its example tasks (explore, implementer, automated
  review, capped rework, decompose, daily ratchet, fix that never chains, nightly architecture pass,
  retro on 1 in 10 merged PRs) are a ready menu.
- **Risk**: none from the skill. Its observability page describes Claude Code and Codex OpenTelemetry
  export; that sends data off the machine only if configured, and GOAL.md says no telemetry by
  default, so leave it off.

### 2.6 skills/in-progress/writing-beats, writing-fragments, writing-shape

- **Does**: three article-writing prompts (collect fragments, order beats, shape the piece).
- **Runs / writes**: pure prompts; write to a file the user chooses.
- **Windows**: yes.
- **Useful**: not for orchestration. One idea is worth keeping for onboarding copy and lessons:
  "grounding" - every concept is either a stated prerequisite or introduced before it is used.
- **Risk**: none. Skip.

### 2.7 skills/misc/git-guardrails-claude-code

- **Does**: installs a PreToolUse hook on the Bash tool that blocks dangerous git commands.
- **Runs / writes**: edits `.claude/settings.json` (project) or `~/.claude/settings.json` (global),
  copies `block-dangerous-git.sh` into `.claude/hooks/` and marks it executable. The script reads the
  hook JSON with `jq`, greps the command for `git push`, `git reset --hard`, `git clean -f`,
  `git clean -fd`, `git branch -D`, `git checkout .`, `git restore .`, `push --force`,
  `reset --hard`, and exits 2 on a match. It is model-invocable, so an agent can trigger the install.
- **Windows**: not as shipped. It needs bash and `jq`. **`jq` is not installed on this PC**, so the
  command string would come out empty and the hook would silently allow everything while looking
  installed.
- **Useful**: the idea matches GOAL.md ("No push, tag or release without the owner"), which today is
  a rule in a document and not a check.
- **Risk**: high as shipped.
  - Changes settings and then runs on every Bash call.
  - Fails open here (no `jq`).
  - Covers the Bash tool only; the PowerShell tool and Codex CLI are not covered.
  - Plain substring match: blocks a commit whose message mentions "git push", and misses
    `git -C x push`, double spaces and aliases.
  - Blocks `git branch -D`, `git reset --hard` and `git checkout .`, which our own worktree cleanup
    and branch pruning use.
  - The user settings already hold a Bash PreToolUse hook; a second one must be added, not replace it.
- **Recommendation**: adopt the idea, do not install. Write a project-scoped hook in node (no `jq`),
  parse the command properly, cover Bash and PowerShell, and block only push, tag and release. It
  changes settings, so the owner approves it first.

### 2.8 skills/misc/migrate-to-shoehorn

- **Does**: replaces `as` type assertions in tests with `@total-typescript/shoehorn` helpers.
- **Runs / writes**: `npm i @total-typescript/shoehorn` (network), edits test files. Model-invocable.
- **Windows**: yes.
- **Useful**: marginal. Skip.

### 2.9 skills/misc/scaffold-exercises

- **Does**: scaffolds exercise folders for Matt's own AI Hero course repositories and commits them.
- **Runs / writes**: creates files, ends with `git commit`. Model-invocable.
- **Useful**: no; it encodes one author's course layout. Skip.

### 2.10 skills/productivity/teach

- **Does**: a stateful teaching workspace. Files in the current directory: `MISSION.md`,
  `reference/*.html`, `RESOURCES.md`, `learning-records/0001-*.md`, `lessons/0001-*.html`, `assets/`,
  `NOTES.md`, `GLOSSARY.md`. Pedagogy: pitch the next lesson in the learner's zone of proximal
  development using the learning records, retrieval practice, spacing, interleaving, quiz design
  rules (answers of equal length, correct answer in varied position), sources cited, and a rule never
  to trust the model's own memory for facts.
- **Runs / writes**: web research (reads from the network); writes only in the current directory.
  User-invoked. No hooks, no settings changes.
- **Windows**: yes.
- **Useful**: yes, twice. For the owner learning a topic. And as product input: Filow is for teachers
  and students, and this is a compact, working statement of what a good tutor loop looks like
  (records of what the learner knows, retrieval over re-reading, spaced return, well-built quizzes).
  That is direct design material for a student mode or for how OK Filow explains.
- **Risk**: low. Run it only from a dedicated folder on G: (for example `G:\teach\<topic>`), never
  from the Filow repo root, or it will fill the repo with lesson files.

### 2.11 skills/productivity/to-questionnaire

- **Does**: turns a pile of open questions for another person into one file
  `to-questionnaire-<slug>.md`: purpose, from, to, context, how to answer, then themed questions,
  each with an answer stub and a "why this matters" line.
- **Runs / writes**: pure prompt; one file in the current directory. User-invoked.
- **Windows**: yes.
- **Useful**: yes. GOAL.md has a "What only the owner can do" list that is "listed, never faked".
  This is the missing mechanism to hand that list to the owner in one sitting (next Microsoft 365
  integration, SEC-09 LAN mode, certificates, store accounts) instead of interrupting per item.
- **Risk**: none.

## 3. mattpocock/sandcastle

### 3.1 What it is and what it needs

A TypeScript library (`@ai-hero/sandcastle`, 0.14.0, MIT). `sandcastle.run()` starts a coding agent
inside a sandbox, on a branch chosen by a branch strategy, and brings the commits back. It needs
Node, git, a sandbox provider and an agent login passed by environment variable
(`.sandcastle/.env` with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, plus `GH_TOKEN`). Agent
providers: Claude Code, Codex, pi, Copilot, Cursor, opencode. Inside the sandbox the agent runs with
permission checks skipped; the sandbox is the safety boundary.

| sandbox provider | where it runs | notes |
|---|---|---|
| `bwrap()` | Linux, and Windows only inside WSL2 | repo must be on the Linux filesystem, not `/mnt/c` or `/mnt/g`; Ubuntu 24.04+ needs an AppArmor profile; hides `/mnt` and WSL interop, so no Windows `.exe` can run |
| `seatbelt()` | macOS 14+ | native |
| `docker()` / `podman()` | anywhere the engine runs | on Windows and macOS this is a Linux VM |
| Daytona, E2B, Fly.io Sprites, Modal, Vercel | cloud | the code leaves the machine |
| `noSandbox()` | host | no isolation at all |

### 3.2 Windows 11, with and without WSL2

- **Without WSL2 (native Windows)**: the init command offers only Docker and Podman. Docker Desktop
  is installed and running on this PC; Podman is not. Git worktree mounts on Windows hosts used to be
  "fully broken" and are fixed (ADR 0006) by mounting the parent `.git` separately plus an overlay
  `.git` file. That overlay is a temp file in the OS temp directory, which here is on C:.
- **With WSL2**: the native path is `bwrap()` inside the distro (Ubuntu is installed and running
  here). The repository has to be cloned onto the Linux filesystem, and the sandbox cannot reach
  Windows programs.
- **Either way the agent works in Linux.** It cannot build or launch the packaged Windows Electron
  app, drive the fake microphone, or open the PowerPoint add-in. GOAL.md requires every change to be
  "verified the way a user meets it (packaged app, real clicks, real audio where it matters)". For
  our main tracks that verification is on the Windows host, so sandcastle cannot be the runner.

### 3.3 Compared with our subagents in git worktrees

| | our setup | sandcastle |
|---|---|---|
| isolation of files | one git worktree per track | one git worktree per run, inside a sandbox |
| isolation of the machine | none; agents share the host | container or kernel sandbox; git config and hooks read-only |
| can verify the packaged Windows app | yes | no |
| agent permissions | harness permission mode | all checks skipped, contained by the sandbox |
| merge back | orchestrator reviews and merges by hand | branch strategy does it; a merger agent for many branches |
| resume after failure | by hand | named branch is reused; failed run leaves the target untouched |
| concurrency guard | "one owner per file" in the brief | lock file per worktree with the owner PID |
| credentials | the user's logged-in session | token in an env file handed to the sandbox |

**Verdict: adopt the ideas, not the tool, for now.** It could earn a place later for work that is
Linux by nature (track T4's Linux build) or pure logic with no UI (`packages/core`), where a
contained agent with skipped permission prompts is a real gain. It is not a replacement for host
worktrees on the tracks that end in a packaged Windows build.

### 3.4 Patterns worth copying without the tool

Taken from the guides and from sandcastle's own loop (`.sandcastle/run.ts` and its four prompts):

1. **Plan, then parallel implement plus review, then one merger.** A planner reads the ready tickets
   and outputs only the unblocked ones; each gets an implementer and then a reviewer; a single merger
   brings all branches in. Hard caps: 10 iterations, 4 in parallel.
2. **Blocking is defined broadly.** Ticket B is blocked by A if it needs A's code, if it touches
   files or modules A is likely to touch, or if it depends on a decision A will set. File overlap is
   a dependency, not a merge problem to discover later.
3. **Deterministic branch names per ticket** (`sandcastle/issue-<n>`), so planning the same ticket
   again lands on the same branch and keeps the progress already made.
4. **Merge-to-head semantics**: work happens on a throwaway branch in a worktree; on failure the
   target is untouched and the branch is kept only if it has commits.
5. **Ask git, not the agent**: the merger takes every branch that is ahead of HEAD
   (`git rev-list --count HEAD..branch`), not the list of commits the run reported.
6. **Dependencies travel with the worktree**: copy `node_modules` into the new worktree and run an
   install and build hook when it is ready. This is the fix for a problem we have already paid for
   (worktrees with no dependencies giving a false red baseline).
7. **A lock file per worktree** with the owner PID, branch and time, so two runs cannot be handed the
   same worktree and a dead owner can be detected.
8. **Three ways for a run to end**: an explicit completion signal, an idle timeout (600 s), and a
   completion timeout for processes that hang after finishing (60 s).
9. **The reviewer runs only if there are commits**, in the same worktree, with the coding standards
   file as its brief, and must preserve behaviour.
10. **The merger runs typecheck and tests after each branch**, not once at the end.
11. **Git config and hooks are read-only to the agent**, and host-side git commands ignore repo hooks
    and repo config that names programs.
12. **Structured output in tags validated against a schema**, instead of parsing free text.
13. **Prompts carry their context**: the last ten commits and the ticket text are inlined; the commit
    message must state the task, key decisions, files changed and blockers for the next iteration;
    "only work on a single task".

## 4. Process advice, and what the GOAL.md gauntlet loop lacks

### 4.1 Matt's chain in one paragraph

Grill until the design is shared (`/grill-with-docs`, which also maintains `GLOSSARY.md` and ADRs),
optionally prototype, write the spec (`/to-spec`: goal, constraints, decisions, tickets with status;
it is a living handoff artifact), cut it into tickets (`/to-tickets`: tracer-bullet vertical slices,
each sized to one fresh context window, with acceptance criteria, context pointers and blocking
edges; prefactor first; the human is quizzed on the breakdown), implement (`/implement` per ticket,
or `/implement-spec`: a ready frontier of tickets, a fresh implementer subagent per ticket in its own
worktree, a merger, one integration branch, one review at the end, a fresh implementer to fix the
findings, worktrees cleaned up), review on two axes in parallel with fresh context (`/code-review`:
Standards against the repo's `CODING_STANDARDS.md` plus a fixed list of twelve code smells, and Spec
against the spec, quoting the line; the two reports are never merged), open the PR (`/pr`), then
`/retro`, which improves the agent's environment and not the code. The software-factory idea adds:
triggers start sessions instead of people, every loop is capped, brakes come off one at a time.

Supporting definitions from the dictionary that carry weight:

- **Automated check**: deterministic pass or fail. A flaky test is a broken check.
- **Automated review**: fresh context, ideally a different model or system prompt; a filter that
  raises the floor before a human looks, not a gate that replaces one.
- **Human review**: reading the diff counts; reading the agent's summary does not. Review is cheaper
  earlier, so read the plan before the work starts.
- **Context pointer**: a stable path plus a line saying when to follow it.
- **Environment**: the only persistent layer; memories are secondary sources that drift and need
  pruning, so load an index and keep bodies behind pointers.
- **Dark factory**: no human reads the code; when it breaks nobody knows what changed.
- **Phase boundaries**: decide what to do with the context only at a phase boundary, in this order:
  continue, clear, handoff, subagent, compact. Every move except "continue" replaces the session by a
  lossy summary.
- Upstream also states that the skills add no guard against subagent recursion; the harness must
  stop loops.

### 4.2 What GOAL.md already does as well or better

Evidence on the packaged app rather than a passing test run; tests proven by mutation and "a new
check must be shown able to fail"; a scorecard that may never drop; independent review with fresh
context that is given the code and not the conclusion; a worktree, ports, profile and release folder
per track; "one owner per file" with named seams; "a track's report is a claim, not proof"; an
explicit owner-only list. None of this should be traded away for Matt's process.

### 4.3 What it lacks, concretely

| # | gap | evidence in Filow today | what to add |
|---|---|---|---|
| 1 | No alignment step before building | the loop goes from a scorecard row straight to Build | a grill step for anything larger than a row fix; the owner or orchestrator reads the plan before work starts |
| 2 | No spec and no tickets | tracks T1 to T8 are whole goals; no acceptance criteria per slice; no tracker configured (`docs/agents/` absent) | run `/setup-matt-pocock-skills` once; a spec per track; tickets sized to one context window with acceptance criteria, context pointers and blocking edges |
| 3 | No shared language or decision record | no `GLOSSARY.md`, no `docs/adr/` | create both; seams named in briefs become ADRs |
| 4 | Review has one axis | "an independent agent tries to break it"; no `CODING_STANDARDS.md`; no spec to check against | keep the adversarial review and add the Standards and Spec axes as separate fresh-context reviewers |
| 5 | No retro | `docs/autoloop/JOURNAL.md` records evidence, not lessons for the environment | after each merged track, and on 1 in 5 subagent sessions that went wrong, turn findings into a check, a standard or a pointer |
| 6 | No deterministic guard at commit time | no pre-commit hook; the only workflow is `desktop.yml`; gates are run by agents on trust | `/setup-pre-commit` (already installed) running lint, typecheck and tests; later a CI job |
| 7 | No integration branch | track branches merge straight into main | merge tracks into one integration branch, run gates and the review there, then fast-forward main |
| 8 | No caps or brakes on loops | "Repeat" has no limit; `filow-autoloop` has no stated throttle; nothing says what stops two runs doing the same work | maximum rework tries before a human, maximum parallel agents, one trigger at a time, the five questions answered for every scheduled task |
| 9 | Dependencies between tracks are not declared | "one owner per file" exists, but overlap is found at merge | list blocking edges including file overlap when tracks are cut; start only the unblocked frontier |
| 10 | No context rules for agents | nothing on fresh context per ticket, context pointers, or phase boundaries | one fresh subagent per ticket; pointers instead of pasted context; the continue / clear / handoff / subagent / compact order |
| 11 | No durable dated memory | `HANDOFF.md` is 704 lines; `AGENTS.md` 69 | an index plus one page per thing, every claim dated and tied to a commit; keep AGENTS.md to pointers |
| 12 | Owner decisions are listed but not collected | "What only the owner can do" is a paragraph | one questionnaire file per batch of owner decisions |
| 13 | Human review is not defined | "no push without the owner" but no statement of what the owner reads | state that the owner reads the diff or the plan, not the summary; add the PR-shape call (one-way or two-way door, blast radius) |
| 14 | No worktree lifecycle | seven locked `agent-*` worktrees under `G:\FILOW\.claude\worktrees`, two more under `G:\filow-wt`, about 60 `release-*` output folders in the repo root | deterministic branch names per ticket, a lock with owner PID, cleanup as a step of the loop (only what the run created) |
| 15 | Push rule is not enforced | "No push, tag or release without the owner" is text only | the hardened hook from 2.7, once the owner approves |

## 5. Local facts found on the way

- `G:\FILOW` is a git repository (the harness reports otherwise): `main` at `988cb41`, origin
  `https://github.com/stefandsl/filow.git`.
- `jq` is missing; `docker` and `gh` are present; `podman` is missing; WSL2 has Ubuntu running.
- Absent in the repo: `CODING_STANDARDS.md`, `GLOSSARY.md`, `CLAUDE.md`, `docs/adr`, `docs/agents`,
  `.claude/settings.json`, `.husky`, `.dependency-cruiser.cjs`, any non-sample git hook.
- Present: `AGENTS.md`, `HANDOFF.md`, `ARCHITECTURE.md`, `docs/autoloop/JOURNAL.md`, one workflow
  (`.github/workflows/desktop.yml`).
- User settings already contain hooks (SessionStart, PostToolUse, PreToolUse including one on Bash)
  and no deny rules. They were read for keys only and not changed.
- C: had 209 GB free at the time of the research.

## 6. Ranked recommendation

Installing means copying a folder into `C:\Users\Asus\.claude\skills`, which this research was not
allowed to do. The standing rule to scan every new skill with SkillSpector before installing applies.

### Install now

| rank | upstream folder | reason |
|---|---|---|
| 1 | `skills/in-progress/chief-of-staff` | our orchestrator role written down, with the dated wiki and retro habit we lack; pure prompt |
| 2 | `skills/productivity/to-questionnaire` | turns the owner-only list into one answerable file; pure prompt |
| 3 | `skills/in-progress/software-factory` | docs only; gives the caps, brakes and five questions for `filow-autoloop` |
| 4 | `skills/productivity/teach` | Filow's audience is teachers and students; working tutor loop as product input; run only from its own folder on G: |

### Update

None. All 26 installed skills are byte-identical to upstream `4ae2317` (2026-10-31).

### Use what is installed but unused (no install needed)

| rank | action | reason |
|---|---|---|
| 1 | run `/setup-matt-pocock-skills` in `G:\FILOW` | code-review, to-spec, to-tickets and triage read its output and have none |
| 2 | run `/setup-pre-commit` in `G:\FILOW` | first deterministic guard; gates stop depending on an agent remembering |
| 3 | orchestrator reads `retro`, `to-spec`, `to-tickets`, `implement-spec` `SKILL.md` by path | they are user-invoked, so agents never see them otherwise |
| 4 | create `CODING_STANDARDS.md`, `GLOSSARY.md`, `docs/adr/` | code-review's Standards axis and grill-with-docs have nothing to read today |

### Adopt the idea only

| item | reason |
|---|---|
| `skills/misc/git-guardrails-claude-code` | right idea, but fails open here (no `jq`), Bash only, blocks our own cleanup commands; write a node hook for push, tag and release with owner approval |
| mattpocock/sandcastle | agents run in Linux and cannot verify the packaged Windows app; copy the plan / implement+review / merger loop, caps, branch naming, ahead-of-HEAD check, worktree lock |
| `skills/in-progress/setup-ts-deep-modules` | package boundaries fit our monorepo, but as a ratchet after a survey, not a one-shot install |
| `skills/in-progress/loop-me` | keep "push right" checkpoints and decision-ready briefs; skip the extra workflow files |
| `skills/in-progress/claude-handoff` | `handoff` already covers it; this one writes to the C: temp folder and needs POSIX shell |

### Skip

| item | reason |
|---|---|
| `skills/misc/scaffold-exercises` | specific to the author's course repositories; ends with a commit |
| `skills/misc/migrate-to-shoehorn` | niche test refactor with a new dependency |
| `skills/in-progress/writing-beats`, `writing-fragments`, `writing-shape` | article writing; only the "grounding" idea is worth keeping |

## 7. Decisions that need the owner

1. Approve copying the four "install now" folders into the user skills folder (after the scan).
2. Approve a project hook that blocks push, tag and release for agents (it changes settings).
3. Approve a pre-commit hook in the Filow repo (it changes how every commit behaves).
4. Choose the ticket tracker for Filow: GitHub Issues on the existing remote, or a repo-native one
   (Backlog.md, Beads) that keeps everything local.
5. Decide whether the manual copies stay or the self-updating plugin replaces them (not both).
