# Filow - production plan (2026-11-08)

Goal: the presenter app (script tracking while you talk) is production ready. OK Filow (the
HeyClicky-style buddy, docs/OKFILOW-GAUNTLET.md) ships as a beta behind a setting until its own
milestones pass. Input: the user's ChatGPT conversation on NLP/NLU/NLI and Omi
(Documents/Codex/2026-11-08/.../conversazione-philo-flow-trascrizione-disponibile.md), checked
against what Filow already does.

Work is done with Claude (subagents and reviews) and local models. Codex credits are nearly used
up, so no `codex exec` and no Codex reviewers.

## 1. What the conversation proposes vs what Filow already has

| Proposal | Filow today | Decision |
|---|---|---|
| Local streaming STT (sherpa-onnx / whisper.cpp) | sherpa Nemotron streaming, local | keep |
| Cascade: cheap stage first, heavy model only for candidates | embedding gate (`packages/core/src/gate.ts`, multilingual MiniLM) before the decision model | keep, add a lexical stage (below) |
| Lexical stage: RapidFuzz + BM25 | missing | **add**: BM25 + fuzzy token match in TS (no Python), joined with the gate's scores; catches names, numbers, terms the embedding blurs |
| NLI: entailment / contradiction / neutral | the decision model (Clef local or OpenRouter) gives a confidence only | **add a guard**: numbers, percentages, units and negation compared between bullet and evidence; a contradiction never flips a point. Measure first whether an mDeBERTa XNLI ONNX model beats the guard + decision model before shipping it (size ~280 MB) |
| Temporal state machine with hysteresis | confirm rule: 2 confirmations or one at >= 0.85, re-ask while pending | keep (measured: 0 false starts, delay p50 2 s) |
| States mentioned / covered / verified | waiting / active / done | **add "mentioned"** (announced but not explained) to the UI; keep done as the only state that counts |
| Evidence per bullet (time range, text, scores, model version) | not stored | **add**: every flip keeps its evidence; shown on hover ("why is this done?") and in the report |
| Partial transcripts never cause irreversible flips | partial text is part of the window | **check and fix**: flips only on evidence inside committed text |
| Session memory, summaries, action items (Omi) | none | **later (P4)**: SQLite + FTS5 session store, post-talk report, proposed action items; opt-in, local, deletable |
| Hardware profiles (8 / 16 / GPU) | local models page | **add** a profile picker that selects STT, gate and decision model by RAM/GPU |
| Rust core engine | TypeScript core, ONNX in a worker | **not now**: a rewrite adds risk and no measured gain. Revisit only if a profile misses its latency target on real hardware |
| Benchmark IT/EN: precision, recall, false completions, latency | gauntlet harness, 3 synthetic corpora | **extend**: real recorded talks IT and EN, traps for negation, contradiction, numbers, partial revisions |

## 2. Milestones

Each milestone ends with: full test suite, tsc and lint clean, gauntlet numbers recorded in
docs/gauntlet/BASELINE.md, the packaged app installed and checked by hand on this PC, and an
independent Claude review. Commit on a branch only when the user says so.

### P1 - Trustworthy tracking (accuracy first)
1. New gauntlet corpora with traps: contradiction ("costs rose 30%"), negation ("we did not cut costs"), wrong number, announcement only, partial STT revision, out-of-order points; IT and EN.
2. Number/unit/negation guard in core; a guarded contradiction never flips.
3. Lexical stage (BM25 + fuzzy) fused with the embedding gate; measure recall and calls saved.
4. Flips only from committed text; partial text can only raise "active".
5. Evidence records per flip; hover explanation.
Exit: 0 false completions on all trap corpora, recall >= baseline, local profile p95 decision latency within the timeout.

### P2 - Production hardening
1. Crash and error capture to a local log on G: (or userData), with a "Send report" the user triggers; no telemetry by default.
2. Auto-update path verified end to end (the win-unpacked build has no app-update.yml: test with the real installer), code signing status, installer on a clean Windows VM.
3. First-run on a clean profile: model downloads resumable and verified (the user's own STT archive was left half-downloaded and never unpacked: fix resume and show a repair button).
4. Offline mode proven by blocking the network during a full take.
5. Performance budget: RAM and CPU per profile measured in a 45-minute take; no memory growth.
6. Accessibility and i18n pass (IT, EN; RO, RU later), UI checked at 100/125/150 % scaling.
7. Security review of the local server (random password per run already), IPC guards, CSP.

### P3 - Hardware profiles and reports
1. Lite / Standard / Advanced profiles picked from RAM/GPU, switchable.
2. "Mentioned / done / missed" states in the live checklist.
3. Post-talk report: covered, missed, evidence quotes, timing per section; export PDF/MD.

### P4 - Memory (Omi-inspired, local)
1. Opt-in session store (SQLite + FTS5) under a user-chosen folder; visible capture indicator; delete all.
2. Search past talks; proposed action items with source quote, never auto-confirmed.
3. Meeting mode without a script: topics and summary.

### P5 - OK Filow from beta to stable
Follows docs/OKFILOW-GAUNTLET.md milestones M1-M6 (owned by the OK Filow session).

## 3. Rules
Local first, no silent cloud fallback, no paid calls in tests, nothing written to C:, no secrets
committed, no push or release without the user.
