# Gauntlet baseline (Round 0)

How to run: `GAUNTLET=1 GAUNTLET_PROVIDERS=openrouter,clef-local npx vitest run apps/web/lib/gauntlet`
(keys from the shell or from the desktop profile's `.env`). Results land in `docs/gauntlet/results/`.
The harness is `packages/core/src/gauntlet.ts` (unit-tested with an oracle provider); corpora live in
`docs/gauntlet/corpus/<name>/` as `script.md` + `transcript.json` (timed committed segments) +
`labels.json` (when each point really started). Section changes follow the labels, as the presenter
or the slideshow follower would.

## 2026-11-02 · demo-it (SYNTHETIC seed talk, 85 s, 9 points, traps: announcement, shared words, out-of-order point)

Machine: Intel Core Ultra 7 155H, 32 GB, Windows 11. Engine defaults (window 900, confirm 2, sure 0.9, timeout 2500 ms, max 4 questions).

| provider | calls | p50 | p95 | timeouts | correct | false starts | misses | precision | recall | delay p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| openrouter · google/gemini-2.5-flash-lite | 15 | 1477 ms | 2746 ms | 0 | 7 | 0 | 2 | 1.00 | 0.78 | 7 s |
| clef-local · clef-flash | not run here: this PC has Ollama 0.13, Clef needs 0.35.1+ | | | | | | | | | |

Per point: s0b0 correct (0 s), s0b1 late (6 s), s0b2 miss (announced at 21 s, started at 46 s after the
presenter had moved to section 2: by design it ends in the "missed" list), s1b0 miss, s1b1 late (7 s),
s1b2 late (7 s), s2b0 correct (0 s), s2b1 late (7 s), s2b2 late (7 s).

What this already says, before any model change:
- No false starts: the model respects the announcement trap. Good.
- The median delay (7 s) is one transcript segment: the two-call confirm rule costs a whole segment on
  every point, and s1b0 is missed because the matching text left the 900-char window before the
  second confirming call. On a real talk with 4 s Whisper windows this is the 9–12 s mouth-to-tick the
  EGM review predicted. `confirmCalls`, `sureThreshold` and the window are the first levers (T3).
- Per-call latency of the cloud model (1.5 s p50, 2.7 s p95) is itself close to the 2.5 s timeout.

Next measurements: Clef on a machine with Ollama ≥ 0.35 (the owner's desktop, RTX 3070), the same
corpus with `confirmCalls: 1` and `sureThreshold: 0.85`, and a real recorded talk instead of the seed.
