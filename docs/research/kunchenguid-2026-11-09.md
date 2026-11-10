# kunchenguid repos - what to adopt for the Filow orchestration (2026-11-09)

Scope: read-only study of 20 repos by github.com/kunchenguid, to improve how Filow is built
(Claude Code orchestrator + subagents in git worktrees, Codex CLI as second worker, gnhf for
overnight runs, process in docs/GOAL.md).

Method and limits, stated up front:
- Shallow clones in `G:/FILOW/tmp/research/kun/<repo>` (260 MB, gitignored `tmp/`). Read: README,
  docs, SKILL.md, AGENTS.md, install scripts, package.json / go.mod.
- **Nothing was installed, built or executed.** Every OS-support statement below is quoted or
  paraphrased from the repo's own README or badge; none of it was verified by running the tool on
  this PC. Treat "works on Windows" as the author's claim until a trial confirms it.
- Repo content was treated as data. Where a repo's skill tells an agent to fetch and run something,
  that is reported as a flag, not followed.
- Local facts that change the advice (checked on this PC): Node `v22.13.0`, Go `1.21.4`,
  gnhf installed `0.1.43` (latest in repo: `0.1.52`). G:\FILOW is a git repo with origin
  `https://github.com/stefandsl/filow.git`, 10 worktrees, no git hooks installed, no `core.hooksPath`.

Pinned commits (so the findings can be re-checked):

| repo | commit | licence | language | last push |
|---|---|---|---|---|
| firstmate | 315c82a | MIT | Shell | 2026-11-09 |
| no-mistakes | e4ab9d4 | MIT | Go | 2026-11-09 |
| kun | 4576903 | none | JS | 2026-11-09 |
| gh-axi | 911a086 | MIT | TS | 2026-11-08 |
| headless | fe1a381 | MIT | Shell | 2026-11-08 |
| runner-up | 61413c0 | MIT | Go | 2026-11-07 |
| axi | 37fb6cc | MIT | TS | 2026-11-06 |
| treehouse | a28452a | MIT | Go | 2026-11-05 |
| chrome-devtools-axi | 1dbdac1 | MIT | TS | 2026-11-03 |
| gnhf | 3e1179f | MIT | TS | 2026-11-03 |
| backpass | c8d60c2 | MIT | JS | 2026-11-02 |
| lavish-axi | 69bf309 | MIT | JS | 2026-10-29 |
| quota-axi | 5734c41 | MIT | TS | 2026-10-29 |
| compact-adviser | 37fa1a6 | MIT | TS | 2026-10-26 |
| autopreso | 5a9cbc9 | MIT | JS | 2026-09-25 |
| tasks-axi | 9401ff8 | MIT | TS | 2026-09-22 |
| acp-mock | ef9d6dc | MIT | TS | 2026-09-22 |
| vision | 7a20c38 | MIT | HTML | 2026-09-02 |
| dotfiles | 9a4a638 | MIT-0 | Shell | 2026-08-27 |
| superpowers-bench | 6a0e877 | none | TS | 2026-04-16 |

---

## 1. Ranked recommendation

### A - adopt now on Windows, low risk

| # | what | why | exact command | must set |
|---|---|---|---|---|
| A1 | **tasks-axi** (backlog CLI + skill) | Turns "what needs the owner is listed, not guessed" into a file with holds; hand-editable markdown, byte-exact round trip, lockfile for parallel agents | `npx skills add kunchenguid/tasks-axi --skill tasks-axi -g` | `npm_config_cache=G:/caches/npm`; `.tasks.toml` with `[markdown] path = "docs/autoloop/backlog.md"` |
| A2 | **axi** skill (markdown guide only) | 10 rules for agent-readable tool output; apply to `tools/autoloop/score.mjs` and the e2e probes | `npx skills add kunchenguid/axi` | nothing; no runtime |
| A3 | **gnhf flags we already have** | Bounded overnight runs and a machine-readable morning check, no new install | `npm install -g gnhf` (updates 0.1.43 to 0.1.52), then use `--max-run-time 8h --max-tokens <n> --stop-when "<cond>" --worktree` | never `--push`; read `.gnhf/runs/<run>/end-state.json` |
| A4 | **treehouse** (worktree pool) - trial on one track first | Reuses worktrees (keeps `node_modules`) instead of 2 GB + `npm ci` per track; durable leases for agents | `irm https://kunchenguid.github.io/treehouse/install.ps1 \| iex` | `TREEHOUSE_ROOT=G:/FILOW-worktrees`; `.worktreeinclude` for `.env` and `package-lock.json`; `--base main` (see open points) |
| A5 | **vision** skill | Drafts a `VISION.md` as a testable acceptance policy from real history; Filow has North star text but no "resisted" list | `npx skills add kunchenguid/vision -g` | `LAVISH_AXI_TELEMETRY=0` (its review step calls lavish-axi) |
| A6 | **lavish-axi** (optional) | Owner annotates an HTML artifact, agent polls the notes; passive layout-issue detection fits the pixel-perfection rule | `npx skills add kunchenguid/lavish-axi --skill lavish` | `LAVISH_AXI_TELEMETRY=0`, `LAVISH_AXI_STATE_DIR=G:/claude-data/lavish-axi`; never `lavish-axi share` |
| A7 | **quota-axi** - blocked until Node is upgraded | Remaining Claude / Codex quota as data, to pick the worker with runway (Codex 429s and quota loss are in our notes) | `npx skills add kunchenguid/quota-axi --skill quota-axi -g`, run as `npx -y quota-axi --json` | needs Node >= 22.19 (this PC has 22.13.0); `XDG_CACHE_HOME=G:/caches`; reads local credential files |
| A8 | **gh-axi** (optional, read-only use) | Cheaper GitHub reads than raw `gh` or the GitHub MCP | `npx skills add kunchenguid/gh-axi --skill gh-axi -g` | skip `gh-axi setup hooks`; no PR or push commands under Filow rules |

Notes on A:
- A4: `go install github.com/kunchenguid/treehouse/v3@latest` is the cleaner route in principle, but
  the module needs Go 1.25.5 and this PC has Go 1.21.4, so Go would download a newer toolchain into
  the Go cache on C:. The PowerShell installer writes one exe to `%LOCALAPPDATA%\treehouse` and edits
  the user PATH: a small write on C: and a PATH change, both worth the owner's yes.
- All `npx skills add ... -g` commands write a skill folder under `~/.claude/skills` (C:, a few KB of
  markdown). The owner's own rule applies first: scan each new skill with skillspector before install.
- Every `*-axi` skill tells the agent to run `npx -y <tool>`: code is fetched from npm at run time.
  Pin a version (`npx -y tasks-axi@<version>`) if reproducibility matters.

### B - adopt the idea, not the tool

| # | idea | from | where it goes |
|---|---|---|---|
| B1 | **Reviewer gets the owner's words as acceptance criteria**, plus the diff, never the author's summary | no-mistakes (`--intent`), kun OPINIONS, firstmate brief scaffold | GOAL.md "The gauntlet loop", step 5 Review: extend "given the code not the conclusion" with "and the owner's request verbatim; a finding is any stated intent not met" |
| B2 | **Brief scaffold with two sections**: `## Owner's intent` (verbatim, never widened) and `## Spec` (in scope / out of scope) + a worktree-isolation assertion as the first step | firstmate | Track briefs; one line under GOAL.md "Rules for tracks" |
| B3 | **Ship vs Scout** task shapes: a scout returns knowledge and never changes code; "a finding is evidence, not authorization" | firstmate | GOAL.md "Orchestration", above the tracks table; every research brief (like this one) is a Scout |
| B4 | **Mechanical push guard and trailer strip**: a `pre-push` hook that refuses pushes to `origin` (by name and by URL) and a `commit-msg` hook that strips AI co-author trailers, installed per worktree through a `core.hooksPath` folder | firstmate `bin/fm-git-push-guard.sh`, `bin/fm-git-strip-ai-trailers.sh` | Enforces GOAL.md Quality bar line 44 ("No push ... No co-author lines") instead of trusting each agent. Plain git hooks, run under Git for Windows. Write our own, do not copy the bash files blindly |
| B5 | **Owner decisions as held backlog items** with a reason and a kind | tasks-axi + firstmate | GOAL.md "What only the owner can do": point at the backlog file, `hold-kind: captain` |
| B6 | **Local gate as a fixed pipeline that can be added to, never shortened** (intent, rebase, review, test, lint) | no-mistakes | GOAL.md "Quality bar", Gates line: name the order and say per-run skips are recorded in the journal |
| B7 | **Budget for always-loaded instructions**: about 5,000 tokens, every addition needs evidence from two sessions, at budget every addition names the removal that pays for it | backpass | A "Maintaining this file" rule at the end of GOAL.md, and for `MEMORY.md` (the index is already long) and `CLAUDE.md` |
| B8 | **Status that tells "working" from "dead"** and durable state on disk so a restart is a non-event | firstmate, kun OPINIONS | "Rules for tracks": each track writes a small status file on G: (state, last step, timestamp); orchestrator reads files, does not poll agents |
| B9 | **Supply-chain guardrails**: frozen installs (`npm ci`), minimum release age, build-script allowlist; single-file length cap in lint | kun OPINIONS | GOAL.md "Quality bar" |
| B10 | **Name the skill in the brief**: Claude under-invokes skills when left to discover them | superpowers-bench results | Track briefs: "use skill X for step Y" stated explicitly |
| B11 | **Two missing global rules**: "simplest direct end-to-end path for one-off work, no wrappers or control planes until a concrete blocker"; "ask before any feature that spawns a large swarm of subagents" | dotfiles `home/AGENTS.md` | Owner's `C:\Users\Asus\.claude\CLAUDE.md` (owner's file, owner decides). The second one conflicts with the owner's "ultracode" preference, so it is a choice, not a fix |
| B12 | **One instruction file for all agents**: `CLAUDE.md` containing only `@AGENTS.md` | dotfiles | Owner's home folder: today `CLAUDE.md` and `AGENTS.md` are two files that can drift |
| B13 | **Deterministic fake worker** for testing orchestration scripts with zero tokens | acp-mock | Only if we script the orchestration; fits "no paid API calls in tests" |
| B14 | **autopreso product ideas** (section 4) | autopreso | Tracks T2, T6, T8 and OK Filow |

### C - skip

| what | one-line reason |
|---|---|
| no-mistakes (the tool) | Its purpose is to push and open PRs; daemon + Task Scheduler task; telemetry on by default. Conflicts with "No push without the owner". Owner decision, not an agent's |
| firstmate (the tool) | README badge "macOS \| Linux"; needs tmux; can open PRs and post publicly |
| backpass (the tool) | README badge "macOS \| Linux", "Windows remotes are out of scope"; needs `acpx` |
| compact-adviser | macOS and Linux only; sends conversation context to a third party (TypeSafe) and needs a paid key |
| runner-up | Coordinator runs on Linux or macOS; needs repo admin rights and administrator PowerShell; Filow has no CI need today |
| headless | Operator machine must be macOS or Linux; changes system and security settings (auto sign-in, never sleep) |
| dotfiles (as a setup) | Nix on Apple Silicon; only the AGENTS.md text is useful (B11, B12) |
| kun (the skill) | Downloads and runs a remote script on every invocation; no licence |
| chrome-devtools-axi | We already have browser tooling; leaves a detached bridge process, which fights "kill only processes you started" |
| acp-mock (the tool) | We have no ACP client of our own |
| superpowers-bench (the tool) | A benchmark that spends tokens; only the result matters (B10) |
| autopreso (the tool) | Alpha; local speech-to-text ships for macOS only, so on Windows it is cloud-only |

---

## 2. Flags (what pushes, elevates, sends data out, or installs by itself)

| flag | who | detail |
|---|---|---|
| Pushes to remotes / opens PRs | no-mistakes | Forwards the branch to the real remote and opens a PR after the gate; CI step can do guarded force-push repairs |
| | gnhf `--push` | "Push the current branch after each successful iteration". Never use under Filow rules |
| | firstmate | Opens PRs; `+yolo` auto-merge; optional public relay (X / Discord) |
| | lavish-axi `share` | Publishes the artifact to third-party ht-ml.app, "public by default". Explicit command only |
| | gh-axi | Wraps `gh`, so it can do anything `gh` can; keep it to reads |
| Elevated permissions / system changes | headless | Admin changes, auto sign-in, sleep settings, SSH config |
| | runner-up | `gh` admin of each repo (`admin:org` for organisations), administrator PowerShell, sudo |
| | no-mistakes | Installer registers a Task Scheduler task for the daemon |
| | treehouse installer | Edits the user PATH |
| Data to third parties | compact-adviser | Up to the last 64 replies and tool results (32,000 bytes cap) to `api.typesafe.ai`; "Installing the package is consent" |
| | no-mistakes | Release binaries carry a telemetry host and ID; off with `NO_MISTAKES_TELEMETRY=0` |
| | lavish-axi | "anonymous usage telemetry to an Umami server at `https://a.kunchenguid.com`", on by default for `npx -y lavish-axi`; off with `LAVISH_AXI_TELEMETRY=0` |
| | quota-axi | Reads `~/.claude/.credentials.json` and `$CODEX_HOME/auth.json` and sends them to the first-party provider endpoints only; says it "never prints, logs, or caches credential values" |
| | autopreso | Uses cloud speech-to-text whenever an OpenAI key is present |
| | no-mistakes | Can read local agent transcripts to infer intent |
| Installs or updates by itself | all `*-axi` skills | `npx -y <tool>` fetches from npm at run time |
| | kun | Fetches `scripts/pull-kun.mjs` from raw.githubusercontent.com and runs it with node on each use |
| | no-mistakes, treehouse, chrome-devtools-axi | `update` self-update commands |
| | no-mistakes, treehouse | `irm <url> \| iex` installers (remote script piped into PowerShell) |
| | firstmate | Installs missing tools after asking |
| | gnhf `--agent` | Writes the chosen agent into the config as the new default (not a security flag, a gotcha) |

Default state on C: and how to move it to G: (required by the disk policy):

| tool | default | relocate with |
|---|---|---|
| no-mistakes | `~/.no-mistakes/` (bare gate repo, worktrees, SQLite, logs) | `NM_HOME` |
| treehouse | `~/.treehouse` | `TREEHOUSE_ROOT`, or `root` in `treehouse.toml`, or `--root` |
| quota-axi | `~/.cache/quota-axi/quotas.json` | `XDG_CACHE_HOME` |
| lavish-axi | `~/.lavish-axi/` | `LAVISH_AXI_STATE_DIR` (port: `LAVISH_AXI_PORT`, default 4387) |
| tasks-axi | file in the repo | `.tasks.toml` or `TASKS_AXI_FILE` |
| npx / npm | npm cache | `npm_config_cache=G:/caches/npm` |
| chrome-devtools-axi | `~/.chrome-devtools-axi/` | none found in the README |
| autopreso | `~/.config/autopreso/` (settings with API keys, logs) | none found in the README |
| gnhf `--worktree` | `<repo>-gnhf-worktrees/<run-slug>/` next to the repo | follows the repo, so it stays on G: |

---

## 3. Per-repo findings

### firstmate
- **What**: an "agent distro" that turns one agent into a first mate who runs a crew of worker
  agents in tmux sessions and worktrees, with a backlog, briefs, status files and PR delivery.
- **Form**: AGENTS.md + skills + bash scripts (not a binary, not a service). MIT.
- **Needs**: README badge "macOS | Linux"; tmux (or another session backend), treehouse, `gh`.
  No Windows support stated.
- **Mechanisms worth taking**:
  - Hard rules: the orchestrator never writes to a project itself; never merges without the
    owner's explicit word; never tears down unlanded work; "Report outcomes faithfully. If work
    failed, say so plainly with the evidence."; "Never add an agent name as a commit co-author."
  - Two task shapes, Ship and Scout. A scout's output is a report, never a PR: "A diagnostic
    request, report, recommendation, or implementation-ready finding is evidence, not authorization
    to change code."
  - Delivery modes `no-mistakes` / `direct-PR` / `local-only`. `local-only` is Filow's default.
  - Brief scaffold: `## Captain's intent` holds the owner's own words and is never widened,
    "because the reviewer treats that subsection as acceptance criteria"; `## Firstmate spec` holds
    only build instructions and names what is out of scope. "The scaffold is a safety contract, not
    a suggestion."
  - Spawn refuses when the target is not a genuine isolated worktree.
  - Serialise tasks only on a true semantic dependency; machine-capacity caps on parallel crew.
  - Backlog contract: the backlog tracks work items only; a decision is a task held for the owner
    with `hold --reason`.
  - Zero-token supervision: workers write sparse status files, the orchestrator reacts to file
    events instead of polling.
  - AGENTS.md maintenance rule: only knowledge useful to almost every session; point to the
    authoritative file; prefer rewriting and pruning over appending.
  - `bin/fm-git-push-guard.sh`: per-task `pre-push` hook that refuses any push whose remote is
    `origin` or one of the shared URLs (also covers `git push <url>` and aliased remotes).
  - `bin/fm-git-strip-ai-trailers.sh`: `commit-msg` hook that strips AI co-author trailers,
    installed through a `core.hooksPath` folder whose wrappers chain to the repo's own hooks.
  - `/ahoy`: walks the owner through open decisions ordered by impact.
- **Flags**: installs tools after consent, opens PRs, optional public posting, `+yolo` auto-merge.

### no-mistakes
- **What**: "puts a local git proxy in front of your real remote. Push to `no-mistakes` instead of
  `origin`, and it spins up a disposable worktree, runs an AI-driven validation pipeline, forwards
  the branch to the configured push target only after every check passes, and opens a clean PR
  automatically."
- **Form**: Go CLI + background daemon + `/no-mistakes` skill. MIT.
- **Needs**: badge "macOS | Linux | Windows"; git, an agent runner (claude, codex, ...), optional
  `gh` / `glab`. Windows install in the README:
  `irm https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.ps1 | iex`,
  which "Installs the binary and restarts the background daemon automatically ... preferring a
  managed Task Scheduler task and falling back to a detached daemon". Alternative:
  `go install github.com/kunchenguid/no-mistakes/cmd/no-mistakes@latest` (no embedded telemetry ID).
- **Mechanisms**:
  - Fixed pipeline `intent -> rebase -> review -> test -> document -> lint -> push -> pr -> ci`.
    "A repository can add to this sequence but never subtract from it." Per-run skips exist
    (`--skip <steps>`), permanent ones do not.
  - Explicit intent: `no-mistakes axi run --intent "the user's goal"`; "Explicit intent is the
    user's goal or request, not a description of the diff."
  - Findings flow: approve / fix / skip / abort; with `auto_fix` the agent fixes and reruns the
    step, then pauses for the human if issues remain.
  - Test step is "Targeted local validation of the change and intent (not a full CI suite)".
  - Rebase step stops when the branch would carry default-branch commits that were never pushed.
    Filow's local main is ahead of origin/main, so this would trip on day one.
- **Flags**: pushes and opens PRs, daemon, telemetry on by default (`NO_MISTAKES_TELEMETRY=0`),
  self-update, state under `~/.no-mistakes/` unless `NM_HOME` is set, can read agent transcripts.
- **Verdict**: group C as a tool for now, B1 and B6 as ideas. Whether `--skip push,pr,ci` leaves a
  useful local-only gate was not tested.

### treehouse
- **What**: a pool of reusable git worktrees per repo; `treehouse get` hands out a clean one,
  `treehouse return` gives it back.
- **Form**: single Go binary, "No daemon - all operations are inline CLI commands." MIT.
- **Needs**: badge "macOS | Linux | Windows"; git. Install commands in section 1 (A4).
- **Mechanisms**: `get --lease` (non-interactive durable lease, prints the path, `--json`,
  `--lease-holder <label>` or `TREEHOUSE_LEASE_HOLDER`); reuse only when the worktree is idle,
  unleased, clean and its HEAD is merged into the reset target; `status`; `get -b <name>`;
  `--base <branch>` or `base_branch` in `treehouse.toml`; `.worktreeinclude` seeds gitignored files
  (`.env`, lockfile) into each worktree; `prune` is a dry run unless `--yes`; in-use detection by
  process scan; `max_trees = 16`; `post_create` / `pre_destroy` hooks only from the user-level
  config (a repo cannot make it run code).
- **Fit**: our notes record about 2 GB per worktree, `npm ci` failing in fresh worktrees because
  `package-lock.json` is gitignored, and a full disk stopping a run. A pool that keeps
  `node_modules` and seeds the lockfile addresses all three.
- **Caution**: it runs `git fetch origin` on every `get` and resets to the remote base by default,
  while Filow's rule says a new worktree must be brought to local main first. `--base main` may or
  may not resolve to local main: check before relying on it.

### axi
- **What**: "Agent eXperience Interface": 10 design principles for CLIs that agents call, with
  benchmarks and a small SDK (`axi-sdk-js`). Site axi.md.
- **Form**: a markdown skill ("a detailed guide with examples for each principle that your coding
  agent can reference while building"). MIT. No OS limits (it is text).
- **The 10 principles**: 1 token-efficient output (TOON, about 40% smaller than JSON); 2 minimal
  default schemas; 3 truncation with size hints and `--full`; 4 pre-computed aggregates;
  5 definitive empty states; 6 structured errors and exit codes, idempotent, no prompts, fail loud
  on unknown flags; 7 ambient context; 8 content first; 9 contextual disclosure (next-step hints);
  10 consistent help.
- **Benchmarks quoted in the README**: GitHub tasks - `gh` CLI 86% success at $0.054, GitHub MCP
  87% at $0.148; browser tasks - chrome-devtools-mcp 99% at $0.101.
- **Fit**: `score.mjs` and the e2e probes are read by agents every loop; a compact default, a
  one-line aggregate, a clear "nothing failing" state and a next-step hint cut tokens on each pass.

### gh-axi
- **What**: "Wraps the official `gh` cli with token-efficient TOON output, contextual next-step
  suggestions, and structured error handling."
- **Form**: npm CLI run through `npx` + a skill. MIT. Badge "macOS | Linux | Windows",
  "Node 20+ required", needs `gh` installed and signed in.
- **Numbers**: 100% success, $0.050 per task, 15.7 s, against raw `gh` at 86% and $0.054;
  "Against the GitHub MCP server it is 66% cheaper, with 74% fewer input tokens and half the turns."
- **Fit**: low today (no PR flow without the owner). Useful later for reading issues and CI.
- `gh-axi setup hooks` edits agent session hooks: skip it.

### chrome-devtools-axi
- **What**: an AXI-style CLI over chrome-devtools-mcp; "57% fewer input tokens, 26% lower cost, and
  27% fewer agent turns" against the raw MCP.
- **Form**: npm CLI + skill, with a persistent detached bridge process (PID file
  `~/.chrome-devtools-axi/bridge.pid`) and headless Chrome. MIT. Badge "macOS | Linux | Windows".
- **Worth copying**: the skill tells agents "to verify state-changing actions with a fresh
  snapshot, `eval`, or screenshot before reporting success".
- **Verdict**: skip the tool; we have the Browser pane and our own e2e probes, and a detached
  process that we did not start by PID is exactly what the Quality bar warns about.

### tasks-axi
- **What**: a backlog CLI that "edits a hand-editable `backlog.md` in place with a byte-exact
  round-trip".
- **Form**: npm CLI run through `npx` + a minimal skill. MIT. Badge "macOS | Linux | Windows",
  Node 20+.
- **Format**: sections `## In flight`, `## Queued`, `## Done`; lines `- [ ] id - title` with tags
  `(repo: X)`, `blocked-by:`, `(kind: X)`, `(priority: 0-4)`, `(hold: <reason>)`,
  `(hold-kind: captain|external|load|parked|future)`, `(hold-until: YYYY-MM-DD)`.
- **Commands**: `add <id> "title" --kind ship --priority 2`, `start`, `done <id>`, `reopen`,
  `block <id> --by <id>`, `hold <id> --reason "..." --kind captain`, `unhold`, `ready`,
  `show <id> --full`, `update`, `prune --keep 10`, `render`, `mv`.
- **Safety**: advisory lockfile + atomic write, so parallel tracks can update one file.
- **Fit**: Filow tracks live in a table inside GOAL.md and owner-only items in prose. A backlog
  file with holds makes "ready", "blocked by T7" and "waiting for the owner" queryable.

### quota-axi
- **What**: reports quota windows for Claude, Codex, Cursor, Copilot, OpenRouter, ElevenLabs,
  Higgsfield and others. "It is data only: it never routes, recommends a provider, model, harness,
  credential, or route, proxies, intercepts, logs in, imports browser cookies, or mints or rotates
  a credential."
- **Form**: npm CLI run through `npx` + skill. MIT. Badge "macOS | Linux | Windows"; "requires
  Node.js 22.19 or newer" (this PC: 22.13.0, so it will refuse or misbehave until Node is updated).
- **Flags**: `--provider`, `--json`, `--full`, `--no-credential-refresh`, `--max-age`. Reads live
  credential files; cache under `~/.cache/quota-axi/` or `$XDG_CACHE_HOME`.
- **Fit**: before a long run, check which worker has runway and brief accordingly.

### backpass
- **What**: reads real agent session transcripts and proposes evidence-backed edits to AGENTS.md /
  CLAUDE.md / skills, each one approved by a human.
- **Form**: npm CLI. MIT. "Requires **Node >= 22.5** and `acpx` on your PATH"; badge
  "macOS | Linux"; "Windows remotes are out of scope".
- **Rules worth taking**: "every `add`, `rewrite`, or `remove` edit needs evidence from at least
  two distinct sessions"; budget "Default: 5,000 estimated tokens (~20KB) for the always-loaded
  surface"; "At or over budget, the synthesis prompt goes zero-sum: every addition must name the
  removal or extraction that pays for it."

### vision
- **What**: a skill (`/vision`) that mines merged PRs and commits and drafts `VISION.md` "as a
  testable acceptance policy": identity, principles, non-goals, "aligns" and "resisted" tests, 8 to
  12 fault-line hypotheticals. "every principle cites real merged PRs or commits; generic
  engineering virtues are banned".
- **Form**: markdown skill + an HTML review board opened through `npx -y lavish-axi`. MIT. No OS
  limit stated; needs git history (or `gh`) and Node for the review step.
- **Fit**: GOAL.md says what Filow is; it has no list of what Filow refuses to become. A reviewer
  agent can test a change against a "resisted" list.

### compact-adviser
- **What**: a plugin that answers "should I /compact now?" using TypeSafe's Jev model.
- **Form**: agent plugin (Pi, Claude Code, Codex CLI, Grok Build). MIT. Badge "macOS | Linux";
  "Windows is not supported this ship"; Node 22+; paid `TYPESAFE_API_KEY`; Claude Code needs the
  experimental `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Flag**: "Installing the package is consent to send eligible checkpoint context to TypeSafe".
- **Idea only**: compact at the boundary of a unit of work, not mid-task.

### lavish-axi
- **What**: turns an agent-written HTML file into a local review surface. The human annotates
  text and elements, the agent runs `lavish-axi poll` and receives the notes as prompts. Also flags
  layout problems (overflow, clipped text) across viewports.
- **Form**: npm CLI + detached local server (port 4387) + skill `lavish`. MIT. Badge
  "macOS | Linux | Windows"; Node 22+.
- **Local-first claim**: "Review local HTML artifacts with a local CLI and no cloud dependency in
  the core feedback loop; hosted sharing through third-party ht-ml.app is explicit and opt-in."
- **Flags**: telemetry on by default; `share` is public by default; detached server process.

### runner-up
- **What**: self-hosted GitHub Actions runners with a fresh container, VM or OS account per job.
- **Form**: Go coordinator service + workers. MIT. Workers on macOS, Linux and Windows ("account or
  Hyper-V on Windows"), but "one coordinator on Linux or macOS".
- **Flags**: `gh` admin of each repository, SSH, administrator PowerShell, sudo.

### headless
- **What**: a skill that configures a machine to run unattended over SSH (never sleeps, signs in
  after restart, keys only, optional Tailscale).
- **Form**: skill + scripts. MIT. Targets include "Windows 11 and Windows Server 2025 with a
  rerunnable PowerShell script over OpenSSH", but the operator side is "macOS or Linux with bash,
  ssh and tar".
- **Flags**: system and security settings, auto sign-in. Outside what an agent should change.

### dotfiles (agent config parts)
- **What**: the author's nix-darwin + home-manager Mac setup. MIT-0. Not a product.
- **Useful**: `home/CLAUDE.md` contains only `@AGENTS.md`; `home/AGENTS.md` is the source of most
  rules already in the owner's global CLAUDE.md (em dash, no co-author, CHANGELOG, quality over
  cost, E2E repro, pixel perfection). The owner's copy lacks two entries (B11) and the
  "Maintaining this file" section ("Prefer rewriting or pruning existing entries over appending
  new ones").

### kun (OPINIONS.md, TOOLS.md, ENTRY.md)
- **What**: a skill (`/kun`) that pulls the author's current opinions, tools and recipes.
- **Form**: skill that fetches and runs a remote script on each use. No licence. Skip the tool.
- **ENTRY.md recipes**: feature = research, planning, implementation, validation; bug fix =
  research, reproduction, implementation, validation; refactor = research, guardrails (missing
  tests first), implementation, validation. Validation = the no-mistakes gate when a remote exists,
  otherwise an adversarial subagent review that reports "when any specified intent was not
  satisfied".
- **OPINIONS.md, the ones we do not already follow**: pass reviewers the original intent, keep
  author and reviewer isolated; reviewers "treat complexity like a disease and demand empirical
  proof from the implementer"; agent-written unit tests are a second copy of the agent's own
  reading, trust end-to-end tests that mirror the user; reviewer and fixer in separate persistent
  sessions; status that separates "still working" from "dead"; pick the model with the most quota
  runway; lint cap on file length (about 1000 lines); supply-chain guardrails; a daily agent audit
  of the last 24 hours; overnight loops only for verifiable objectives; no heavy orchestration
  until the pain is clear; HTML for human review, markdown for skills.

### acp-mock
- **What**: "Test ACP clients E2E without spending tokens or trusting a live agent": a
  deterministic ACP agent over stdio (fixed replies, tool calls, workspace edits, trace replay).
- **Form**: npm dev dependency (`pnpm add -D acp-mock`). MIT. Badge "macOS | Linux | Windows".
- **Fit**: none today. Idea B13.

### superpowers-bench
- **What**: measures whether agents pick the right obra/superpowers skill without being told
  (20 tasks, baseline against a "triggered" hint).
- **Form**: benchmark run from source; no licence; spends tokens.
- **Results (results/report.md)**:

| agent | baseline pass / recall / F1 | triggered pass / recall / F1 |
|---|---|---|
| claude (opus-4-6) | 33% / 38% / 40% | 39% / 42% / 43% |
| claude-opus-4-7 | 44% / 69% / 70% | 56% / 69% / 72% |
| codex (gpt-5.4) | 44% / 92% / 83% | 78% / 98% / 92% |
| opencode-gpt-5-4 | 50% / 73% / 74% | 56% / 86% / 82% |

- **Lesson**: Claude models miss skills they should use (low recall). A brief that needs a skill
  must name it. The models tested are older than the ones we run, so the size of the gap today is
  unknown; the direction is the useful part.

### gnhf (installed: 0.1.43, latest: 0.1.52) - what the current README has that we may not use
- `--worktree`: isolated worktree per run under `<repo>-gnhf-worktrees/<run-slug>/`; kept when it
  has commits, removed when it has none; rerunning the same prompt resumes. Must start from a
  non-gnhf branch.
- `--stop-when "<condition>"`: natural-language stop condition, saved with the run.
- Caps: `--max-iterations`, `--max-tokens` (can abort mid-iteration; counts input, output and
  cache), `--max-run-time 8h`, `--max-rate-limit-wait` (default 24h).
- Usage-limit waits: waits out the Claude 5-hour window and retries the same iteration without
  counting a failure.
- `end-state.json` under `.gnhf/runs/`: exit status, stop condition, agent error, counters. This is
  the machine-readable morning check (our notes say `pgrep`-based "is it alive" checks always
  answer no on Git Bash).
- Abort rules: permanent agent errors (for example low credit) abort at once; 3 failures in a row
  abort; a failed iteration is `git reset --hard`.
- Agents: Claude Code, Codex, GitHub Copilot CLI, Pi, Cursor CLI, Rovo Dev, OpenCode natively, plus
  ACP targets through bundled `acpx` (`acp:gemini`, `acp:grok-build`, custom command).
- Config: `agentPathOverride`, `agentArgsOverride`, `agentModel`, `acpRegistryOverrides`.
- Gotchas: `--agent` rewrites the default agent in the config; `--push` and `--current-branch`
  exist and must stay off; `--prevent-sleep on|off`.
- Skill `skills/gnhf/SKILL.md` (ships in the npm package): Hands-Off mode against Companion mode
  (host polls, steers and reviews between rounds). "GNHF completion is not user acceptance."
  "Core rule: the host agent orchestrates; GNHF executes." Pre-launch check: `git status --short`,
  `git branch --show-current`, `git log --oneline --max-count=5`.

---

## 4. autopreso - product ideas for Filow

What it is: "autopreso runs a local web app with a live Excalidraw canvas and a listening agent.
You speak; transcripts stream to a model; the model draws, labels, and rearranges the whiteboard in
real time." Alpha. `npm install -g autopreso` or `npx autopreso`; server on
`http://127.0.0.1:3210` (loopback only). Pipeline: browser microphone at 24 kHz, then
speech-to-text (Moonshine locally or OpenAI Realtime), then a whiteboard agent (OpenAI, Codex
subscription or Ollama), then tool calls that edit the scene. Platform limit: "Local Moonshine
transcription ships as an optional native sidecar for `darwin-arm64` and `darwin-x64`. On other
platforms, choose OpenAI Realtime in the STT panel."

| # | idea | Filow track |
|---|---|---|
| 1 | **Staging then live**: content is prepared before the talk and the tool switches to live on a clear action | T3 onboarding, take flow |
| 2 | **Bias transcription toward the prepared text and labels**: the script is a vocabulary hint for the recogniser | T8 languages, TRK-2 recall (names, Cyrillic, diacritics) |
| 3 | **Warm-up loop**: the agent is primed on the staging content "so the first sentence you say doesn't get a cold model" | T2 latency on old hardware, T7 first-sentence delay |
| 4 | **Live session cost card**: token and audio cost per talk, local providers show $0.0000 | T6: sits next to the "going outside" signal; shows what left the PC and what it cost |
| 5 | **Provider auto-detection with a published precedence table** | T2 auto-setup. Take the table, not the behaviour: autopreso moves to cloud speech-to-text as soon as a key exists, which is the opposite of Filow's "no silent cloud fallback" |
| 6 | **Per-talk agent instructions** (up to 100,000 characters) | OK Filow: a per-deck note on audience, level, terms to use |
| 7 | **Voice-driven drawing** on a whiteboard | OK Filow, as a later capability: "draw this as a diagram" |
| 8 | **Native speech engine as an optional per-platform package** (`packages/moonshine-darwin-arm64`, `-x64`, with a sidecar config) | T4 platforms, T7 and T8: a packaging pattern for local STT and TTS engines so the base installer stays small |
| 9 | **Moonshine as a local recogniser to measure** for low latency | T8, only as a candidate: language coverage for ru, ro, ja was not checked here |

---

## 5. Proposed wording for GOAL.md (for the orchestrator to accept or reject; nothing was edited)

- Quality bar, after line 44: "The push and co-author rules are enforced by git hooks in every
  worktree (`pre-push` refuses origin, `commit-msg` strips AI trailers), not by trust."
- Quality bar: "Installs are frozen (`npm ci`); a new dependency younger than N days needs a reason
  in the journal."
- Gauntlet step 5: "The reviewer receives the owner's request verbatim and the diff. Any stated
  intent not met is a finding. The author's summary is not given."
- Orchestration, before the table: "Two task shapes. Ship: changes code in its own worktree.
  Scout: returns findings only; a finding is evidence, not permission to change code."
- Rules for tracks: "Every brief has `Owner's intent` (their words, never widened) and `Spec`
  (in scope, out of scope), and names any skill the track must use."
- Rules for tracks: "Each track keeps a status file on G: (state, last step, time) so the
  orchestrator can tell working from dead without asking."
- What only the owner can do: "Open decisions are held items in the backlog with a reason."
- New last section "Maintaining this file": "Only what almost every session needs. Rewrite or
  prune before appending. A new rule needs evidence from two sessions."

---

## 6. Open points (not verified)

1. No tool was run. Windows support is the README's claim in each case.
2. treehouse: whether `--base main` uses local main or `origin/main`. Filow's local main is ahead
   of origin, so a wrong answer hands a track a stale tree. Trial on one track and compare
   `git rev-parse HEAD` with local main.
3. treehouse and no-mistakes via `go install`: need Go 1.25.5, this PC has 1.21.4; Go would fetch a
   toolchain into its cache on C: unless `GOPATH` / `GOMODCACHE` point at G:.
4. quota-axi on Node 22.13.0: below its stated minimum (22.19).
5. no-mistakes with `--skip push,pr,ci`: whether a local-only gate remains useful.
6. `npx skills add`: which package serves `skills`, and exactly where it writes on Windows, was not
   inspected. Run it once by hand and look before letting an agent do it.
7. superpowers-bench numbers are from April 2026 models.
8. C: free space dropped from about 281 GB to 175 GB during this session (other agents are
   running). Still above the 20 GB stop line; worth a look by the orchestrator.
