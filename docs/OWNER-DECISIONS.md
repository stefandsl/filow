# Owner decisions (held items)

One place for everything only the owner can decide. Agents add an item here instead of guessing
and keep working on what is not blocked. An item leaves this file when the owner answers; the
answer and its date go to docs/autoloop/JOURNAL.md.

Format: what is asked, the options, what waits on it. Opened 2026-11-09.

## Product

| id | question | options | waits on it |
|---|---|---|---|
| D1 | What is "microsoft tondo integration"? | Microsoft To Do (tasks from a talk), Teams (present and track inside a meeting), or another Microsoft 365 app | track T5 has not started |
| D2 | Startup: the main window opens after 7.7 s (budget 3 s) because it waits for the public link | keep the wait; open at once and refresh once when the link is ready; open at once and update the QR code in place (no reload, most work, best result) | PERF-01 stays failing |
| D3 | Phone mirror on the local network: the web server listens on every network card | token on every route plus a Host check (keeps the feature); off by default with a switch; remove | SEC-09 |
| D4 | Does the local voice sound natural enough? | listen to the samples track T7 produces | T7 acceptance (only the owner's ears count) |
| D5 | Licences of voices and speech models, if a track flags one that is not free for commercial use | accept, replace, or pay | T7, T8 |

## Release

| id | question | options | waits on it |
|---|---|---|---|
| D6 | Code signing for Windows | Azure Trusted Signing, OV or EV certificate | SIGN-01..04, SmartScreen-free install |
| D7 | Apple developer and Google Play accounts, a Mac, real phones | buy or lend | macOS and iOS checks, store listings |
| D8 | Push local main to GitHub (ahead of origin since 2026-11-09) | push now; push after the tracks merge | nothing is pushed without a yes |

## How agents work on this machine

| id | question | options | waits on it |
|---|---|---|---|
| D9 | A git hook that refuses push, tag and release unless the owner allowed it | install (core.hooksPath in this repo only); keep the written rule only | the push rule is a promise, not a lock |
| D10 | A pre-commit hook (lint, typecheck) and a commit-msg hook (no em dash, no co-author line) | install via /setup-pre-commit; keep the gates manual | errors are caught at merge instead of at commit |
| D11 | Where slices and their acceptance criteria live | GitHub Issues; files in the repo (Backlog.md or Beads) | the Align step writes briefs by hand until then |
| D12 | docs/CODING_STANDARDS.md, docs/GLOSSARY.md and docs/adr/ | let the orchestrator draft them from the code for review; skip | the standards review axis uses the Quality bar until then |
| D13 | The nightly filow-autoloop task now works in its own worktree and branch (autoloop/<date>), never on main | keep; revert | changed by the TRK-2 session on 2026-11-09 |
| D14 | Remove about 60 old release-* folders, the merged P1 worktree and the research clones in tmp/research | remove all; keep the last two releases; keep everything | disk on G: and a clear folder |

## Tools and skills that change the machine or fetch code

Scan reports: tmp/research/scans/. Rule: install on SAFE/LOW only; MEDIUM and above is the owner's call.

| id | item | scan | why it is held |
|---|---|---|---|
| D15 | tasks-axi skill (Kun) | 7/100 LOW | runs `npx -y tasks-axi` unpinned: code is fetched from npm at run time. Fine if pinned to a version. |
| D16 | axi skill (Kun) | 33/100 MEDIUM, CAUTION | a design guide for agent-friendly command-line tools; it tells an agent to add hooks to ~/.claude/settings.json and to use unpinned `npx`. Useful only if we build such a tool. |
| D17 | vision skill (Kun) | 24/100 MEDIUM, CAUTION | writes a project vision by review board; its HTML template carries instructions for the agent in a comment and opens with unpinned `npx -y lavish-axi` (telemetry on unless LAVISH_AXI_TELEMETRY=0). |
| D18 | gnhf 0.1.43 to 0.1.52 | not a skill | global tool the night runs depend on; update when no run is active. |
| D19 | treehouse (worktree pool) | not scanned | its installer edits the user PATH. Would replace the hand-made worktree lifecycle. |
| D20 | Matt Pocock skills as a plugin instead of 30 copied folders | all copies byte-identical to upstream 4ae2317 | a plugin updates itself; copies stay frozen until copied again. |
| D21 | Two additions to the global agent rules (B11, B12 in docs/research/kunchenguid-2026-11-09.md) | - | global rules are the owner's file. |
| D22 | The claude-mem observer (a bun worker plus the claude.exe it starts) held about 124 GB of committed memory on 2026-11-10, with 5 GB of RAM free and a 180 GB pagefile on C: | restart it; cap it; leave it | not started by this project, so no agent stops it. If memory runs out, the parallel tracks crash. |
