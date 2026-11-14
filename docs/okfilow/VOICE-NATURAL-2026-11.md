# Local voice naturalness investigation

Historical round 1. The owner's blind preferences supersede the proxy-based speaker
recommendations below. See [round 2](VOICE-NATURAL-ROUND2.md) for the current defaults,
pronunciation, number normalization and tail handling. These tables remain historical evidence.

Worktree: `feat-voice-natural`, 2026-11-14. No release, merge, push or installed
profile change. Reproduction tools: `tools/voice-natural/`. Generated evidence:
`G:/FILOW/tmp/voice-natural/`.

## What the measurements establish

There is a scheduling defect in fluent multi-sentence delivery. The progressive
queue waits for playback of one request to finish before synthesizing the next.
When sentences arrive as separate streamed updates, this inserts synthesis time
between sentences even when all remaining text is already available.

The baseline contains pitch variation (Italian mean voiced F0 standard deviation
about 34 Hz on the repeat); it is not literally flat-pitch speech. No clipped
16-bit samples were found in that repeat. Trimming removed a median 1004 ms of
combined leading/trailing near-silence per Supertonic piece (maximum 1299 ms),
while preserving 20 ms before and 60 ms after the threshold crossings. Leaving
all of that padding in would add conspicuous delay; no trimming change was made.
The player creates buffers at the supplied 44.1 kHz, uses unity gain and no
crossfade between pieces. Hardware resampling and physical output were not tested.

The real progressive queue, voice controller, desktop worker and Web Audio
scheduler were exercised with a silent in-memory AudioContext stand-in. No audio
output device was opened. Four Italian sentences produced gaps of 788, 933 and
770 ms before the change. After combining waiting sentences, the gaps were 785,
220 and 220 ms: about 1.27 seconds less dead air. A list went from 220/765/751 ms
to 220/874/220 ms. A two-sentence answer still needs two requests and gains no
structural improvement. Its 1107 versus 1047 ms gap is run-to-run noise.

The first request is never enlarged or held for more text. Later requests combine
already waiting text up to the desktop's 4000-character limit. Newlines preserve
sentence counts, including list items without terminal punctuation. Each request
keeps its starting sentence index and total count for highlighting and Resume.
Stop still cuts the active player and prevents waiting work from starting.

This improves the rhythm of sufficiently long streamed answers; it does not prove
that the owner's complaint about the voice's timbre is resolved.

## Measurement limits

The corpus contains 12 Italian answers and five each in English, Russian,
Romanian and Japanese. Raw pieces and processed WAVs are retained. Synthesis is
CPU-only with the app's four threads on this PC. The baseline under dependency
installation had Italian median first-piece time 1073 ms; a later repeat was
645 ms. Use the repeat and paired comparisons, not the overloaded initial run,
for latency decisions. This is not a controlled mid-range-CPU acceptance test.
The host is an i9-13900KF with 128 GiB RAM. The measured standard profile uses
four threads, five flow-matching steps and speed 1.05. The four-step light profile
was measured with speaker 0, not all recommended speakers. There were 652 answer
renders across 21 variants; the six queue recordings are separate.

MOS estimates use Microsoft's local DNSMOS P.808 model, published in the
[DNS Challenge repository under CC BY 4.0](https://github.com/microsoft/DNS-Challenge/blob/master/LICENSE).
It is a noise-suppression speech-quality proxy, not a validated five-language
naturalness score. Human listening is necessary. F0 variation is measured with
pYIN (60-500 Hz); greater variation is not automatically more natural. Silence
statistics use 10 ms RMS windows below 0.003 and runs at least 80 ms long.
Reported memory is sampled process RSS, not peak working set. First-piece
synthesis and worker delivery are not physical speaker latency.

Intelligibility uses local Whisper turbo int8. Keep both the transcripts and
normalized scoring inputs: digits are expanded for word scoring, punctuation and
case are ignored, and Japanese uses character errors. These scores also include
recognizer mistakes. Initial Italian baseline and repeat disagreed on a date:
one transcribed 14 correctly, the other produced an extra numeric sequence.
One take cannot establish a systematic text-normalization defect.

## Licence and coverage findings

- Supertonic 3 covers all five target languages. Its weights use
  [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE),
  including commercial-use and downstream-use conditions. The export's MIT code
  licence does not replace the weight licence. Full precision assets and their
  SHA-256 values are retained in `full-downloads.json`.
- Kokoro v1.0 uses Apache-2.0 weights. Its exported metadata includes Italian
  Sara (35) and Nicola (36). The older exclusion of Italian was too broad:
  setting the legacy runtime's language to Italian produces Italian speech.
  This run measures Sara. The English/Chinese lexicon default is unsuitable.
  Japanese voices exist upstream but need a suitable Japanese frontend;
  Russian and Romanian are unsupported. Italian took about 3757 ms to the first
  piece with RTF 1.41 here, so this configuration fails real-time CPU delivery.
- Piper exports measured here are Paola (Italian), Joe (English), Denis
  (Russian), and Mihai (Romanian), with CC0 datasets identified in their own
  model cards. Paola's older card points to
  [this CC0 dataset](https://huggingface.co/datasets/paolapersico1/Voice-Dataset-Italian);
  the others identify [Nabu Casa's CC0 datasets](https://github.com/NabuCasa/voice-datasets).
  The voice repository declares MIT. These findings do not cover arbitrary Piper
  voices. The latest Paola card describes a retrained Piper 1.5 model; the retained
  sherpa export is the older model, not that retrained checkpoint. Piper lacks
  Japanese. These tests use an isolated sherpa 1.12.40 runtime because the shipped
  2.0.1 runtime removed the embedded espeak frontend.

No online voice was built or called. An online option could offer more expressive
delivery and more speakers without local model costs, at the expense of answer
text leaving the PC, network latency, availability and recurring charges.

## Selection and implementation

[Complete tables](VOICE-NATURAL-TABLES.md) contain every measured variant and
language, including memory, pause statistics, model size and licence. Raw JSON,
per-piece F0, ASR hypotheses and normalized scoring inputs remain in the evidence
directory. Italian results, measured on the same 12 answers:

| Variant | DNSMOS proxy | Word errors | First piece ms | RTF |
|---|---:|---:|---:|---:|
| Current int8 speaker 0, repeat | 3.64 | 3/109 | 645 | .246 |
| Int8 speaker 9 | 3.97 | 0/109 | 669 | .250 |
| Int8 speaker 2 | 3.92 | 1/109 | 668 | .248 |
| Full precision speaker 0 | 3.76 | 0/109 | 578 | .234 |
| Four / six / eight steps | 3.71 / 3.65 / 3.62 | 0 / 2 / 3 of 109 | 495 / 806 / 1049 | .195 / .305 / .410 |
| Whole answer | 3.69 | 2/109 | 731 | .203 |
| Raw text without cleanup | 3.70 | 15/109 | 726 | .183 |
| Piper Paola | 3.66 | 7/109 | 141 | .067 |
| Kokoro Sara | 3.47 | 0/109 | 3757 | 1.409 |

The highest useful gain was speaker choice. Automatic selection uses speaker 9
for Italian and English, 2 for Russian and Romanian, and 4 for Japanese. These
are provisional recommendations balancing the proxy with transcription errors,
not human preference rankings. Some higher-scoring voices had worse intelligibility.
The selection is stored as -1; explicit choices 0 through 9 remain unchanged.
An existing owner profile set to 0 must select Automatico (or Male 5) to try the
Italian recommendation. The installed profile was not modified.

Per-answer first-piece increases against the repeat baseline stayed below 150 ms
for IT/EN/RU/JA (maximum 95/76/94/28 ms). One Romanian result exceeded that budget.
A subsequent alternating-order warm worker test, five repetitions of each of
the five Romanian first pieces, produced paired deltas from -85 to +129 ms.
This supports the local timing gate, not a guarantee on other hardware or cold
startup. The queue change does not delay or enlarge the first request.

No new model is shipped: full precision did not beat the selected int8 speaker,
Piper was faster but had more Italian errors, and this Kokoro configuration was
not real time. Therefore no new download or hash path is needed. The current
pinned download, Windows voice fallback and Stop path are retained. Higher step
counts did not improve the proxy. Speed, precision and trimming remain unchanged.
Existing cleanup materially improved intelligibility over raw text. The corpus
does not support a new language-specific number/date rewrite, which could change
meaning; that remains a possible follow-up after listening and larger samples.
No temperature or noise control is exposed by the current worker. This sweep
does not test every native generation option or random seed.

## Listening

Open `G:/FILOW/tmp/voice-natural/listen/index.html` by double-clicking. It contains
12 Italian and three each EN/RU/RO/JA examples, each with current voice and two
alternatives shuffled independently as A/B/C. The separate `listen-key.json`
identifies them. All 72 WAVs sit next to the HTML. Six additional WAVs demonstrate
the three queue before/after comparisons. Nothing autoplays or loads remotely.
The Italian alternatives are int8 speakers 9 and 2. The other-language selection
is recorded in `selection.json`. No human preference has been collected.

## Verification

The queue regression fails on the old implementation and passes on the change.
Targeted mutations disable batching, enlarge the first request, lose the Resume
count, and remove the length bound. Each must fail an assertion, with the clean
baseline passing first and original source bytes restored afterwards.

The full suite initially exposed a missing generated desktop vendor bundle and
an incorrectly constructed new length-limit fixture. The bundle was generated
with `npm run build:welcome -w apps/desktop`; the fixture was corrected to enqueue
the first sentence separately. The final full run passed 3203 tests (5 skipped),
with 254 files passing and 2 skipped. Typecheck and lint passed.

Four additional assertion-killed mutations cover wrong recommended speaker,
losing explicit speaker 0, losing the automatic setting, and the unset UI default.
All eight mutations restore the exact original source bytes. Hidden offscreen
Electron checks passed in five languages and both themes; the listening page
contained 78 paused local audio elements and no external resources. Screenshots
were inspected without making a window visible or playing audio.

Not verified: human naturalness preference, physical playback/resampling, actual
mid-range hardware, cold start timing, all recommended speakers on the light
profile, Japanese Kokoro, or a packaged installed-app end-to-end run. Stop,
highlighting, Resume and fallback are covered by the existing and new automated
tests, not a live microphone interaction. No online voice was used.
