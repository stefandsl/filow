# Comprehension Goldfish report — ARCHITECTURE.md (Mode: REVIEW)

## Paraphrase

**What this proposes**

Filow is a teleprompter that listens to a presenter's speech and automatically ticks off talking points as they are spoken, using an LLM to decide which points have been "started". Today it is a single Next.js page. The document proposes splitting it into one *engine* (the machine with the microphone: it transcribes speech, runs a 500 ms classification loop against an OpenRouter model, and publishes a `SessionState`) and any number of *views* (phone app, PowerPoint task pane, Google Slides sidebar, extra browser tab) that mirror that state over a WebSocket and send back commands such as next/previous section. Views pair with the engine by a 6-digit code or QR, no accounts. Code is reorganised into a monorepo (`core`, `stt`, `ui`, `client` packages; `web`, `desktop`, `powerpoint`, `gslides`, `mobile` apps). For PowerPoint and Google Slides, the slide speaker notes *are* the script (one section per slide, `-` lines are points); PowerPoint syncs slide position both ways, while Google Slides can only export notes and mirror in the editor because its API cannot drive Present mode. A six-phase roadmap of about 19 days follows, with a PWA phone mirror shipped early and a native Expo app later. Section 2.3 also describes classifier-prompt changes that have already landed (open/covered/upcoming lists, confidence rubric) and four future engine improvements.

**How the existing system works, per this document**

One React component (`Teleprompter.tsx`) owns all state and UI. The browser captures the mic, streams audio to a speech-to-text backend, and every 500 ms POSTs the transcript plus the currently open talking points to `/api/decide`, which asks an OpenRouter-hosted model which points have been started. The Markdown script parser lives in `lib/`, STT backends in `lib/stt/`, and there is an Electron shell in `electron/`. The classifier prompt (now) receives open, covered and upcoming point lists and applies a 0.70 confidence threshold.

The document as a whole hangs together; I could paraphrase every section. The gaps below are mostly undefined project terms, references to things outside the document, and a few places where two readings are possible.

## Findings

1. **Major** — Line 9, 25, 51: "which points have been started" / `status: "waiting"|"started"|"missed"`. The core domain concept — what it means for a talking point to be *started* vs *covered* vs *missed* — is never defined. Line 100 introduces "COVERED POINTS" ("already-checked") but `SessionState` has no "covered" status; is covered == started? And how does a point become `missed` (user action via "mark missed" on line 25, or engine inference when the section advances)? I had to guess that "started" is the only positive state and "missed" is set when a section is left with waiting points. This is the system's central mechanic and should be stated once.

2. **Major** — Line 103, 107: "This is the small/medium/large router from the video, done with OpenRouter." Which video? There is no link or title. A fresh reader cannot follow this reference at all. Also line 107's "0.40–0.69 on a point for 3+ ticks" assumes the reader knows what a "tick" is; it is only implied by "500 ms tick" in the diagram on line 13.

3. **Major** — Line 157, 159: "the phone can be the engine" / "use this phone as microphone". Section 2 states the engine is "exactly one per session" (line 35) and that the laptop that captures audio runs it. If the phone becomes the engine, what is the laptop then, and how does the hand-off happen (does the laptop become a view, is the session re-created)? Not explained; two readings possible (phone replaces laptop as engine vs. phone streams audio to the laptop's engine, which "second mic" on line 157 also suggests).

4. **Major** — Line 147: `POST /api/session/:id/script` is used by the Google Slides export, but this endpoint is not in the session-server box (lines 28-33), which only lists `/api/session/*` generically. Also: when a view pushes a script, is that the same as a `loadScript` Command (line 85) over the WebSocket, or a separate REST path? Two mechanisms for the same thing with no statement of which is canonical.

5. **Major** — Line 89: "deltas (`{version, patch}`)". The patch format is not specified (JSON Patch? shallow merge? custom?). Combined with "Views are stateless and can reconnect at any time", the reader must guess whether a view that misses a version has to re-request full state or whether the server resends it.

6. **Major** — Line 91 vs line 175: "a view enters the code ... and gets a short-lived session token" vs "tokens are random 128-bit, expire with the session" and line 174 "Engine gets short-lived STT tokens only". Three token kinds (pairing code, session token, STT token) with lifetimes described as "short-lived", "expire with the session", and "2 h after the engine disconnects" (line 91). Which lifetime applies to which token is ambiguous.

7. **Major** — Line 114, 122, 106: PowerPoint "advances slides when they tell it to (or automatically when a section completes)" and line 122 "engine: section advanced (manual or auto)". But line 106 says auto-advance only *suggests* "Next section" (phone vibrates, button highlights). Does the engine advance automatically or only suggest? Two sections contradict, or the reader has to assume PowerPoint has a different policy.

8. **Major** — Line 93 heading: "(shipped in this commit)". A design document referring to "this commit" is unreadable without the VCS context; a fresh reader does not know which commit or whether the rest of section 2.3 is shipped too. The sentence on line 103 ("Next steps for the engine") is the only thing that separates shipped from planned.

9. **Nit** — Line 25: "mark missed" is listed as a command views send, but the `Command` type (lines 81-86) has `markStarted` and `clearMissed` and no `markMissed`. Either the prose or the type is wrong.

10. **Nit** — Line 25, 13: "STT" is used in the diagram (line 13) and `/api/stt/*` (line 30) before "transcription" is linked to it; the expansion "speech-to-text" never appears. General engineering term, borderline, but the first use is in a diagram with no expansion.

11. **Nit** — Line 77: `SttBackendId` is used in the type but never defined or enumerated (ElevenLabs, OpenAI, Web Speech are mentioned at lines 30, 132, 143, so I guessed those three).

12. **Nit** — Line 49: `Script, Section, Bullet` — the type is called `Bullet` but the rest of the document says "point(s)" everywhere (`points`, "OPEN POINTS", `PointList`). Same concept or different? I assumed same.

13. **Nit** — Line 83-84: `startTake` / `stopTake`, and line 147 "runs the take". "Take" is never defined. I inferred it means one recording/rehearsal run; the term is project-specific.

14. **Nit** — Line 54: `MissedTray` and line 164 "Missed tray as a swipe-up sheet" — the "missed tray" UI concept is used but not described until section 5, and even there only as a screen element.

15. **Nit** — Line 129: "the task pane *is* the engine" plus line 131 "falls back to keyboard-free 'selected slide' sync in Normal view". "Keyboard-free" is unexplained; I could not tell what keyboard interaction it is avoiding.

16. **Nit** — Line 168: "store apps are what you asked for" and line 201 "the Debian box from the README" — second-person references to a conversation and to an external README that is not linked. The hosting decision (line 201) depends on a Caddy setup described only in that README.

17. **Nit** — Line 76: `stats.cost` — currency/unit not stated (USD? credits?); line 108 "Cost cap: per-session budget" inherits the same ambiguity.

18. **Nit** — Line 78/86: `slide` on SessionState is "set by PowerPoint / Slides when linked", and `slideChanged` Command maps a slide index to a section. The mapping rule (slide n == section n because notes are one-section-per-slide) is only implied by line 115/120; if a user loads a hand-written script instead, what does `slideChanged` do? Unstated.

19. **Nit** — Line 143 vs 132: "`getUserMedia` does work in the sidebar iframe" (Google) and "Web Speech is not available inside Office web views" (PowerPoint). The document never says what "Web Speech" is in relation to the STT backends, i.e. that it is the free browser-native backend the web app uses today. A reader has to infer why its absence forces paid STT.

## Summary

No Blocker: every section could be paraphrased. The eight Major findings are mostly cross-section inconsistencies (engine count vs. phone-as-engine, auto-advance vs. suggest, `markMissed` missing, two script-loading paths, token lifetimes) and two unreachable external references ("the video", "this commit"). Defining "started / covered / missed" once near the top of section 2 and adding a one-paragraph glossary (tick, take, point/bullet, STT backend ids, missed tray) would resolve most of the Nits.
