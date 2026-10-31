# Structural Goldfish review — ARCHITECTURE.md (Mode: REVIEW, standard: feature-spec-standard.md)

Heading map extracted: H1 (line 1) -> H2 §1 (7), §2 (23) with H3 2.1 (44), 2.2 (66), 2.3 (93), §3 (112), §4 (138), §5 (155), §6 (172), §7 (182), §8 (197). Levels nest correctly; no skipped levels. Tables at 97-101 and 184-191 are well-formed. Code fences all closed. Structural failures are against the standard's mandatory content, not Markdown syntax.

---

## Finding 1
Severity: Blocker
Affected Scope: whole document (no matching heading anywhere)
Discrepancy: The standard's Alternatives Rule ("fails this standard if it proposes a single path without proving that other viable designs were considered and rejected") is not met. There is no "Alternatives Considered" section. The only alternative discussed is PWA vs store apps (line 168), buried inside §5. Single-path assertions with no rejected options: WebSocket as transport (line 89), npm workspaces + Turborepo (line 64, "Nothing exotic" is not a rationale), Expo over native/Flutter/Capacitor (line 159), 6-digit code pairing over accounts/links (line 91), notes-as-script (line 116), Next.js app doubling as session server (line 28).
Fix: Add `## Alternatives considered` between §6 and §7 with one row per decision: Option | Rejected because | Cost/complexity note. Minimum rows: transport (WS vs SSE+POST vs WebRTC data channel), monorepo tooling (npm+Turbo vs pnpm vs no split), mobile stack (Expo vs Capacitor vs native), pairing (code vs link vs account), session server location (inside Next.js vs separate Node/WS process). Move the PWA-vs-store paragraph from line 168 into that section.

## Finding 2
Severity: Blocker
Affected Scope: §2.2 line 28-32 and line 89, vs grounding files next.config.ts (output: "standalone") and electron/main.js (requires .next/standalone/server.js, binds HOST 127.0.0.1)
Discrepancy: The document asserts `/ws/session/:id` is served by the "Session server (Next.js)" with no decision record. Next.js standalone output (the build the desktop app and the Debian deploy both depend on, per next.config.ts comment) does not expose a WebSocket upgrade handler from route handlers; this requires either a custom server entry or a separate process, which changes the desktop packaging (electron/main.js requires server.js directly) and the CI build (desktop.yml). Roadmap phase 2 line 187 "desktop app publishes sessions" additionally conflicts with electron/main.js binding to 127.0.0.1 only: a phone cannot reach it. Neither is acknowledged.
Fix: In §2.2 add a "Transport host" paragraph stating where the WS server runs (custom `server.ts` replacing standalone `server.js`, or a sidecar `ws` process on another port), how Electron starts it, and what the bind address becomes (0.0.0.0 on LAN with pairing code, or relay via the public server). Record it as a decision in the new Alternatives section and add a phase-2 roadmap sub-item for the Electron/CI change.

## Finding 3
Severity: Blocker
Affected Scope: §6 lines 172-178 (only risk content); no "Risks & Mitigations", "Goals & Non-Goals" or "Problem Statement" headings
Discrepancy: The standard's Risks & Limits rule requires failure modes, scalability limits and mitigations. §6 covers only security/privacy. Missing entirely: engine disconnect mid-talk (what views show, who can take over), two engines claiming one session (line 35 says "exactly one", line 157 says the phone "can be the engine"; no arbitration), WS reconnect/ordering with `{version, patch}` deltas (line 89), single-server in-memory state (line 176 hand-waves "Redis later"), OpenRouter latency/outage during the 500 ms loop, Office.js/Apps Script API change risk. Goals and Non-Goals are not stated anywhere; the problem statement exists only as one sentence at line 19 without a heading.
Fix: (a) Add `## Problem statement` and `## Goals and non-goals` before the current §2 (promote line 19 into the problem statement; list non-goals explicitly: no accounts in v1, no Present-mode control in Slides, no transcript storage). (b) Rename §6 to `## Risks and mitigations` with sub-headings Security, Availability/failure modes, Scalability, Platform dependency; one bullet each: risk -> mitigation -> owner phase.

## Finding 4
Severity: Major
Affected Scope: §8 lines 199-200 vs §5 line 168, §7 lines 187 and 189, §4 line 149
Discrepancy: Items listed as "Open decisions" are already decided elsewhere in the same document. Open decision 1 (PWA or store apps) is decided at line 168 and encoded in the roadmap rows 187 and 189. Open decision 2 (Slides without Present-mode control) is decided at line 149. The same PWA-then-Expo statement appears three times (168, 187/189, 199). A fresh reader cannot tell what is open.
Fix: Either delete items 1 and 2 from §8 and move them to a `## Decision log` (Decided / Rationale / Date), or strip the recommendations from lines 168 and 149 and leave the roadmap rows marked "pending decision 1". Keep each decision stated once.

## Finding 5
Severity: Major
Affected Scope: line 114, line 122, roadmap rows 188 and 191
Discrepancy: Ordering contradiction. §3 promises the PowerPoint add-in advances slides "automatically when a section completes" (114) and the diagram at 122 shows "section advanced (manual or auto)". Section auto-advance is defined as an engine improvement in §2.3 item 2 (line 106) and scheduled in phase 6 (line 191), three phases after the add-in ships in phase 3 (line 188).
Fix: Either move "auto-advance" into phase 2 or 3 in the roadmap, or change line 114 to "advances slides when they tell it to (automatic advance arrives with Engine v2, phase 6)" and drop "or auto" from line 122.

## Finding 6
Severity: Major
Affected Scope: §4 line 145 and list 147-149
Discrepancy: Internal contradiction in the same paragraph: "the add-on does two jobs well and does not pretend to do the third", immediately followed by a three-item numbered list where item 3 is written as a job the add-on does.
Fix: Convert item 3 to a separate "Not supported" sentence under the list. Renumber to two items.

## Finding 7
Severity: Major
Affected Scope: lines 85 and 147
Discrepancy: Two unreconciled ways to load a script: the `loadScript` Command over WS (line 85) and a REST endpoint `POST /api/session/:id/script` (line 147). The REST endpoint does not appear in the session-server box (lines 28-32) and its auth is undefined.
Fix: Add `/api/session/:id/script` to the box, and add one sentence in §2.2 stating that REST script upload is the equivalent of the `loadScript` command for clients without a WS connection, and which credential it requires.

## Finding 8
Severity: Major
Affected Scope: line 89, line 91, line 73 vs line 49
Discrepancy: Undefined terms in the contract section. `patch` has no format; "Short-lived" has no duration, while the session itself has one (2 h); the doc alternates between "Bullet" and "points" with no statement that they are the same entity.
Fix: Line 89: name the patch format and the reconnect rule. Line 91: give the token lifetime. Line 49: state Bullet = point.

## Finding 9
Severity: Major
Affected Scope: §2.1 lines 46-62 vs grounding package.json and .github/workflows/desktop.yml
Discrepancy: The monorepo layout moves the Next app to `apps/web` and Electron to `apps/desktop`, which invalidates every path in package.json `build` and every root script the CI workflow invokes. Roadmap phase 1 claims "web app unchanged for users" but says nothing about desktop packaging or CI, and there is no decision on where electron-builder config lives post-split.
Fix: Add to §2.1 a "Migration impact" list and make it an explicit phase-1 deliverable.

## Finding 10
Severity: Major
Affected Scope: line 93, line 107, line 168, line 201
Discrepancy: Conversation-bound and time-bound references that a fresh reader cannot resolve ("this commit", "the video", "you asked for", "the README").
Fix: Replace each with a self-contained reference.

## Finding 11
Severity: Nit
Affected Scope: lines 84, 54, 164 (terms "take", "Missed tray", "Next strip", "tick")
Discrepancy: Domain vocabulary used before or without definition.
Fix: Add a short `## Glossary` after the intro.

## Finding 12
Severity: Nit
Affected Scope: lines 1-3, §7 table Effort column
Discrepancy: No status, version, date or owner metadata. Effort estimates have no stated basis.
Fix: Add a metadata block under the H1 and a footnote with estimate assumptions.

## Finding 13
Severity: Nit
Affected Scope: line 159
Discrepancy: Dependency list asserted without decision record and partially stale (`expo-barcode-scanner` deprecated in favour of `expo-camera`; `expo-av` audio superseded by `expo-audio`).
Fix: Soften to capabilities, pick exact packages at phase 4.

---

Summary of required structural changes, in document order: metadata block (12); Problem statement + Goals/Non-goals sections (3); Glossary (11); Transport host decision and REST/WS reconciliation in §2.2 (2, 7, 8); migration impact in §2.1 (9); fix §3/§7 auto-advance ordering (5); fix §4 two-vs-three list (6); rename and expand §6 to Risks and mitigations (3); new Alternatives considered section (1, 13); collapse §8 to truly open items and add a Decision log (4); remove conversation-bound references (10). The document does not pass the feature-spec standard until Findings 1-3 are resolved.
