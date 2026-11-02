# Priler's Jarvis videos: what they add to the plan (watched 2026-11-02)

Two videos by the author of Priler/jarvis (channel "Хауди Хо"), read from their Russian auto-captions:

1. "Я сделал ДЖАРВИСА через вайбкодинг" (Aug 2025, 15 min): the author vs ChatGPT-5/Claude on a wake-word
   assistant and on voice spell-casting for a game.
2. "Я сделал НАСТОЯЩЕГО ДЖАРВИСА!" (Sep 2024, 54 min): the v0.0.1 Python build, the Rust/Tauri rewrite,
   wake-word training, command system.

Neither contains a measurement usable for Filow (no WER, no model sizes, latency only as spoken claims:
"500 ms STT, 3–4 s to a command" for the naive pipeline, "20–30 ms" for the short-phrase game path). They
are useful for the shape of the pipeline and for the failure modes, not for numbers.

## Confirms what Filow already does

- **Cheap stage first, expensive stage only on a candidate.** Wake word → STT in Jarvis; embedding gate →
  decision model in Filow (`packages/core/src/gate.ts`). Same shape.
- **Streaming partials are the speed path** ("Vosk partial listening"): Filow's sherpa-onnx streaming
  recognizer; match on partials, confirm on finals (plan step 5).
- **Exact string compare fails; fuzzy or semantic is required.** His v0.0.1 used a Levenshtein ratio with an
  acceptance threshold (no value given); he notes that different libraries compute different distances, so
  a threshold is only meaningful for the exact implementation it was tuned on. Filow's thresholds live in
  one place for the same reason (`DEFAULT_GATE`, engine `threshold`/`sureThreshold`).
- **Offline must keep working**: his criticism of the cloud-only Google backend in the AI-written code.
- **Engine abstraction with heavy/light profiles** per hardware: Filow's router and the plan's hardware
  profiles.

## Two additions to the plan

1. **Per-point alias lists for terms the STT mangles** (video 1, 11:37, the "synonymization" that fixed
   recognition of fantasy spell names). For Filow: product names, acronyms, people, Italian/Romanian/Russian
   loanwords. Generate aliases at script-prep time (plan step 4, "make preparation explicit"), score them
   lexically (Unicode-aware tokens, so Cyrillic survives; see `prompter/matcher.py` warning in REUSE.md) next
   to the embedding similarity, and feed the aliases to the decision prompt as "also known as". Measure on
   the gauntlet before keeping it: it is a second signal, not a replacement for the gate.
2. **A follow-up window after a hit** (video 2, 12:12: after a command Jarvis keeps listening 10–15 s
   without the wake word). For Filow: after a point is marked, bias the next calls toward the following
   point in script order for a few seconds (ask it first, lower its `low` gate threshold), since speakers
   mostly go in order. This also answers the plan's question about the 4-question rotation delaying points
   outside the current group: the window keeps the likely next point in every call.

## Pitfalls worth remembering

- Custom wake-word models trained on ~15 voices recognised only those voices (video 2, 31:29). Any
  per-user adaptation in Filow (phrase boosts, enrolment) must be measured per speaker, not assumed.
- Mic bleed of other audio hurt recognition; headphones fixed it (video 1, 14:09). Room audio and the
  presenter's own PC audio are a test case for the long-session step (plan step 12).
- The AI-written attempts picked inefficient stacks and outdated APIs (video 1, 14:19): the reason the
  plan says "measure before adding a dependency".
- Porcupine was a Windows liability for a month (video 2, 31:29); proprietary engines are not on the list.

## Not for Filow

Wake words (a presenter speaks continuously), closed command lists, Vosk/Rustpotter/Porcupine, Rust/Tauri,
TTS and voice cloning, the GPT reply chain.
