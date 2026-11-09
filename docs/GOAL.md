# Filow - the goal (rewritten 2026-11-09 from the owner's requests)

Every agent working on Filow reads this first. Detail lives in docs/PRODUCTION-PLAN.md (tracking,
hardening, profiles, memory), docs/OKFILOW-GAUNTLET.md (OK Filow) and docs/autoloop/ (scorecard).

## North star

Filow is a production-ready, cross-platform assistant for **presenters, teachers and students**:
- it follows a talk against its script in real time and shows what is covered, missed and next;
- OK Filow explains anything on screen (pointer, drawings, 3D, whiteboard) when asked by voice;
- it plugs into the tools people already use (PowerPoint today; more Microsoft 365 apps next) so
  everything feels like one product;
- it picks the best setup for the machine it runs on (old laptop to GPU workstation) and keeps
  latency low on old hardware, without the user knowing what a model is;
- onboarding is the best in its class: a first-time user gets a working take in minutes;
- the UI is plain and obvious; nothing needs a manual.

Owner requirements added 2026-11-09 (their words, kept as the acceptance text):
- **Speed**: "the v17 of the app surprised me how fast it works" - that speed is now the bar, and
  local models on low-spec hardware must reach "at least partial or the same result".
- **Data leaving the PC is always visible**: "if the information goes outside we need a visual
  confirmation like an animation of the cursor", every time, at the moment of sending.
- **Informed before the first send**: the user is told plainly that "the screenshot and the
  information as registration voice goes to other servers like google", naming the real recipient,
  and can keep it on the PC instead.
- **A natural voice, locally**: "la voce e troppo robotica serve che sia piu naturale ... tipo
  elevenlabs in locale".
- **Five languages at least**: "che capisca russo inglese italiano rumeno giapponese" - speech
  understood, answers and voice in the same language, then the interface.

Platforms: Windows, macOS, Linux desktop; Android and iOS as companions (phone mirror and remote
today, via the web app). "Done" for a platform means built, installed and checked on that platform,
not "the config exists".

## Quality bar (non-negotiable)

- Evidence over claims: every change is verified the way a user meets it (packaged app, real
  clicks, real audio where it matters) and the evidence goes into docs/autoloop/JOURNAL.md.
- Gates: `npm test`, `npm run typecheck`, `npm run lint` all clean; `node tools/autoloop/score.mjs`
  never lower than before. A new check must be shown able to fail.
- Fix the cause, not the symptom. A bug fix starts by reproducing it end to end.
- Local first: no silent cloud fallback, no paid API calls in tests, no telemetry by default.
- Nothing written to C: (caches, profiles, test data on G:). npm installs use `npm_config_cache=G:/caches/npm`.
- No push, tag or release without the owner. No em dash in any text. No co-author lines.
- Kill only processes you started (by PID, `taskkill /PID <pid> /T /F`), never by image name.

## The gauntlet loop (how work is done)

1. **Measure**: score.mjs plus the e2e probes (tools/autoloop/e2e). Pick the highest-value failing
   or missing row of the scorecard below.
2. **Reproduce**: show the gap in the packaged app (or the closest real setting).
3. **Align** (anything larger than one scorecard row): before code, write the brief - the owner's
   words, what is in and out of scope, acceptance criteria a script or a click can check - and
   cut it into slices that each end in something a user can see. A question only the owner can
   answer goes to docs/OWNER-DECISIONS.md; it is never guessed and never blocks the other slices.
4. **Build** the smallest change that closes it, with tests that fail without it (mutation).
5. **Verify** end to end on a packaged build; record numbers, not adjectives.
6. **Review**, by agents with fresh context that get the code, never the author's conclusion:
   - break it: an adversarial pass on the packaged behaviour;
   - spec: the reviewer receives the owner's request verbatim and the diff. Any stated intent
     not met is a finding. The author's summary is not given;
   - standards: the diff against the Quality bar and the lint rules.
   Fix what survives review.
7. **Keep or discard**: keep only if every gate passes and the score does not drop; journal either way.
8. **Retro** after each merged track: what the brief missed, what broke at merge, what cost a
   retry. One dated line in docs/autoloop/JOURNAL.md (history, not the present state).
9. Repeat. A scheduled daily run (filow-autoloop) keeps going until the scorecard has nothing left
   that this machine can verify; what needs the owner is listed, not guessed.

Brakes, so a loop cannot run away: a slice gets at most three rework rounds after review, then it
stops and goes to the owner with the evidence. The local gate (test, typecheck, lint, score, E2E)
is one fixed pipeline and is never shortened to save time. New automation (a schedule, a hook, a
trigger) is added one at a time and watched for a full run before the next.

## Orchestration

Independent tracks run as parallel agents, each in its own git worktree and on its own ports and
profile, so they never share files, processes or app state. The orchestrator owns main: it reviews
every track's branch, reruns the gates on the merged result, and merges only verified work.

| track | goal | owns |
|---|---|---|
| T1 take | a full local take end to end in the packaged app (fake microphone), offline proven with zero outbound connections, memory over a long take | tools/autoloop/e2e/take*.mjs |
| T2 auto-setup | Lite / Standard / Advanced chosen from RAM, CPU, GPU at first run and switchable; low latency on old hardware measured | packages/core profile logic, apps/web/app/api/local, settings/local |
| T3 onboarding | first run to first successful take in minutes, every step checked on a fresh profile in both languages | apps/desktop/welcome*, onboarding pages |
| T4 platforms | Linux build run for real (WSL2 GUI), macOS build config reviewed, phone companion installable (PWA) on Android and iOS | build config, web manifest |
| T5 integrations | PowerPoint verified; next Microsoft 365 integration as chosen by the owner | apps/powerpoint, new integration |
| T6 outbound data | notice naming the recipient before the first send, a visible "going outside" signal on the pointer every time, decline = zero requests; plus the docs/OKFILOW-GAUNTLET.md milestones | apps/web/app/okfilow, apps/desktop/okfilow.js consent, apps/web/lib/buddy/text.ts and providers.ts |
| T7 natural voice | a neural voice on this PC, measured first (licence, size, latency on 2 threads), streamed sentence by sentence, interruptible, lighter voice or system voice on weak machines | apps/desktop/tts*.js, apps/web/lib/buddy/voice.ts |
| T8 languages | speech understood in en, it, ru, ro, ja (measured error rates), tracking on Cyrillic, Romanian diacritics and Japanese, answers in the user's language (`lang` passed to the voice) | apps/desktop/stt.js, packages/stt, tracking tokenisation, docs/stt |
| TRK-2 (separate session) | tracking recall from 0.80 to 0.90 with 0 false completions, branch trk2-recall | packages/core tracking thresholds |

Rules for tracks, learned the hard way:
- A new worktree starts at origin/main, not local main: every track runs `git merge --ff-only main` first.
- One owner per file. Where two tracks meet (the `speak` function, the string files, the hardware
  profile), the brief names the seam: a `lang` field, a pure function taking RAM and cores, a thin
  wrapper. Joining happens at merge, by the orchestrator.
- Each track has its own ports, profile folder and release folder, all on G:.
- A track's report is a claim, not proof: the orchestrator reruns the gates and the end-to-end
  check on the merged result before anything lands on main.

Rules added 2026-11-09 from the review of Kun Chen's and Matt Pocock's repos (docs/research/):
- Two task shapes. Ship: changes code in its own worktree. Scout: returns findings only; a
  finding is evidence, not permission to change code.
- Every brief has `Owner's intent` (their words, never widened) and `Spec` (in scope, out of
  scope, acceptance criteria), and names any skill the track must use. Its first step proves
  isolation: `git rev-parse --show-toplevel` is the track's worktree, not G:/FILOW.
- Dependencies are declared before launch. Two slices that touch the same file are a blocking
  edge even with a named seam; only the unblocked frontier starts.
- Tracks land on an integration branch (`integration/<date>`), the gates and the end-to-end check
  run there, and main moves only by fast-forward to a green integration branch.
- Merge what git says is ahead (`git log main..<branch>`), not what the report says was done.
- Each track keeps a status file, G:/FILOW/tmp/status/<track>.json (state, last step, time), so
  the orchestrator can tell working from dead without asking.
- Agents get pointers, not pastes: file paths and the section to read. Installs are frozen
  (`npm ci`); a dependency is added only with its version pinned.
- Capacity is measured, not assumed: before launching, check free RAM and commit; a track that
  loads a model or builds an installer counts double. Stop launching below 16 GB free RAM.
- Lifecycle: when a track is merged or discarded, the orchestrator removes that track's worktree,
  profile and release folder - only what this run created, never by pattern.
- Open decisions are held items in docs/OWNER-DECISIONS.md with a reason and what waits on them.

## What only the owner can do (listed, never faked)

Code-signing certificates (Windows, Apple), Apple developer and Google Play accounts, a Mac and
real phones for native checks, store listings, the LAN-mode security decision (SEC-09), and product
choices such as which Microsoft 365 integration comes next. Also: anything that changes the
machine outside this repo (git hooks, global tools, installers, settings) and any skill whose
scan is above LOW. The current list, with what each one blocks, is docs/OWNER-DECISIONS.md.

## Maintaining this file

Only what almost every session needs. Rewrite or prune before appending. A new rule needs
evidence from two sessions; a rule nobody has needed for a month is removed.
