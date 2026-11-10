# OK Filow natural voice: what was measured and what ships

The owner's request (2026-11-09): "la voce e troppo robotica serve che sia piu naturale con possibile
tipo elevenlabs in locale", in Russian, English, Italian, Romanian and Japanese, with "at least partial
or the same result for local models on low spec hardware".

**Choice: Supertonic 3 (Supertone, int8 export by sherpa-onnx), through the sherpa-onnx runtime Filow
already ships for speech-to-text.** It is the only candidate found that speaks all five languages with
one model, runs well inside the realtime budget on 2 CPU threads, and has a licence that allows a
product (OpenRAIL-M, see Licences). Code: apps/desktop/tts.js, tts-worker.js, apps/web/lib/buddy/voice.ts,
apps/web/app/okfilow/panel/voice-settings.tsx.

Naturalness cannot be judged by a script. The owner needs to listen to the samples listed at the end.
Intelligibility was checked objectively: every sample was transcribed by a local speech model
(Whisper large-v3 turbo, int8, sherpa-onnx) and scored against the text it was meant to say.

## How it was measured (2026-11-10)

- This PC: Windows 11, shared with two other agent tracks building and testing at the same time, so
  every number is noisy. Each figure is 5 runs: median and worst are both given.
- Same three sentences per language: a short one, one with a time, a date, a number and an acronym
  ("The meeting starts at 9:30 on March 14, and the PDF has 27 pages."), and a long instruction.
- First audio = time to synthesize the first piece the app would speak (the first sentence, 11 to 31
  characters), model already loaded. RTF (real-time factor) = synthesis time / audio length over all
  three sentences; under 1 means faster than speech. RAM = resident memory of the measuring process
  (Node plus the model) after the runs.
- The shipped voice was measured through the app's own text path (`speakable()` then `splitSentences()`
  from tts.js), at the two settings the app uses: standard (5 synthesis steps) and light (4 steps).
- Scripts and raw results: G:/FILOW/tmp/t7-work/bench.cjs, bench2/*.json, wer.cjs, wer2.json.

## Coverage and licences

| Candidate | en | it | ru | ro | ja | Licence (engine / weights) | Download | On disk |
|---|---|---|---|---|---|---|---|---|
| **Supertonic 3 int8** (sherpa-onnx 2.0.1) | yes | yes | yes | yes | yes | Apache-2.0 / OpenRAIL-M (code MIT) | 122.8 MiB | 138.6 MiB |
| Kokoro int8 multi-lang v1.0 (sherpa-onnx) | yes | no (1) | no | no | no (1) | Apache-2.0 / Apache-2.0 | 126.2 MiB | 181.1 MiB |
| Piper medium voices (VITS) | joe, cori | paola | denis | mihai | none | MIT / datasets CC0 or public domain | 64 MiB each (int8: 20 MiB) | 77 MiB each |
| Matcha (sherpa-onnx) | yes | no | no | no | no | not measured: no voice for 4 of the 5 languages | | |

(1) The sherpa-onnx export of Kokoro v1.0 reads English and Chinese only. Fed Italian and Japanese it
produced English-sounding noise: WER 84.8% (it) and CER 93% (ja) in the first measuring run
(G:/FILOW/tmp/t7-work/wer-1.json). Kokoro has no Russian or Romanian voice at all.

Two findings that decide the shortlist:
- **sherpa-onnx 2.0 removed the espeak-ng text front end.** With the runtime Filow ships (sherpa-onnx-node
  2.0.1, needed by the speech recognizer) Piper voices produce no audio at all ("phoneme_codepoints is
  empty, no lexicon"), and Kokoro silently skips every word missing from its lexicon (digits, "PDF").
  Piper and Kokoro were therefore measured with sherpa-onnx-node 1.12.40 in a separate folder. Shipping
  them would mean a second, older native runtime next to the one speech-to-text uses.
- Piper has no Japanese voice, and Kokoro covers only English here. Neither can serve all five languages.

Not measured, excluded on licence or coverage: XTTS-v2 (Coqui Public Model License, non-commercial),
F5-TTS (weights CC-BY-NC), MeloTTS (no Italian, Russian or Romanian), upstream Kokoro Italian and
Japanese (needs the Python misaki front end, not shippable inside Electron).

## Speed and memory (5 runs each, median / worst, machine under load)

| Voice | Threads | en first audio ms | it | ru | ro | ja | RTF median range (worst) | RAM MB |
|---|---|---|---|---|---|---|---|---|
| Supertonic 3, standard (5 steps) | 2 | 389 / 449 | 388 / 436 | 488 / 654 | 468 / 506 | 485 / 596 | 0.18-0.26 (0.34) | 453 |
| Supertonic 3, standard (5 steps) | 4 | 527 / 576 | 385 / 487 | 514 / 598 | 413 / 476 | 529 / 549 | 0.18-0.23 (0.24) | 452 |
| Supertonic 3, light (4 steps) | 2 | 376 / 482 | 359 / 400 | 408 / 532 | 374 / 438 | 320 / 352 | 0.15-0.18 (0.23) | 451 |
| Supertonic 3, light (4 steps) | 4 | 408 / 518 | 407 / 478 | 428 / 432 | 346 / 386 | 362 / 464 | 0.15-0.18 (0.21) | 452 |
| Kokoro int8 (1.12.40) | 2 | 2666 / 3159 | - | - | - | - | 1.27 (1.41) | 532 |
| Kokoro int8 (1.12.40) | 4 | 1663 / 1978 | - | - | - | - | 0.91 (0.96) | 539 |
| Piper joe medium (1.12.40) | 2 | 87 / 1879 | - | - | - | - | 0.06 (0.06) | 336 |
| Piper joe medium int8 (1.12.40) | 2 | 285 / 776 | - | - | - | - | 0.19 (0.21) | 286 |
| Piper cori medium (1.12.40) | 2 | 95 / 770 | - | - | - | - | 0.06 (0.06) | 362 |
| Piper paola / denis / mihai (1.12.40) | 2 | - | 74 / 86 | 102 / 513 | 90 / 377 | - | 0.05 (0.07) | 272-361 |
| Piper, same voices | 4 | 64-80 | 42 / 76 | 82 / 101 | 50 / 72 | - | 0.03-0.05 (0.05) | 272-360 |

- Target "first audio under 800 ms on 2 threads for a short sentence": met for all five languages in
  this run (worst 654 ms). An earlier run of the same command, while another track was building,
  gave a Russian worst of 1836 ms and median 1168 ms (G:/FILOW/tmp/t7-work/bench2-s5-t2-run1.json):
  on a loaded PC the first sentence can take over a second.
- 4 threads is not faster than 2 for a single short sentence on this machine; the app uses 2 to 4
  threads (cores minus two) for the standard setting and 2 for the light one.
- Model load: 0.7 to 1.3 s. The panel loads the model when a question starts (`warm`), so the load
  overlaps the screenshot and the answer, and unloads it after 10 minutes without speech.
- RAM: Supertonic needs about 420 MB once loaded (measured 417-425 MB in the first run, 451-453 MB
  here including Node). That is the reason for the memory floor below.

Synthesis steps (first measuring run, raw text before the time and acronym rules in `speakable()`,
G:/FILOW/tmp/t7-work/wer-1.json): 2 steps garbled Italian (WER 91%) and Romanian (45%), 3 steps still
lost words (WER 9-18%), 5 steps was clean, 8 steps was no better and 2x slower. Hence 5 (standard)
and 4 (light).

## Intelligibility (Whisper turbo transcription of each sample)

| Sample | Error rate | Note |
|---|---|---|
| Supertonic 3 standard: en, it, ru, ro | WER 0% each | |
| Supertonic 3 standard: ja | CER 1.4% | "お手伝いします" heard as "お手伝います" |
| Supertonic 3 light: en, it, ru, ro | WER 0% each | |
| Supertonic 3 light: ja | CER 2.8% | "お手伝いです" |
| Packaged app, real answers (see End to end): en, it, ru, ro, ja | 0% each | |
| Kokoro en (1.12.40) | WER 0% | |
| Piper joe / cori (en) | 0% / 0% | joe int8: 2.5% |
| Piper paola (it) / mihai (ro) | 2.9% / 2.9% | |
| Piper denis (ru) | 10% | "PDF" heard as "PDE", "файл" as "фару" |

Times like 9:30 are rewritten in words for the voice (`speakable()`): without it Supertonic said
"nomo e 30" in Italian and an unrelated word in Russian (first run, WER 12% and 7%). Whisper writes
the time back as digits, so the score compares digits with digits.

## What ships and how it behaves

- Voice choices in the OK Filow panel: "Natural voice (on this PC)" (default once the model is on this
  PC and the PC can carry it), "This PC's voice" (no download, the fallback), "ElevenLabs (cloud)", Off.
  Panel text in English and Italian (apps/web/lib/buddy/text.ts).
- Download only on a click, size shown ("129 MB", decimal megabytes), with the source (GitHub, sherpa-onnx release page)
  and the licence named before the click. Pinned SHA-256
  82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427, resumable from the bytes already on
  disk, stored in <user data>/models/supertonic-3-tts-int8. With FILOW_OFFLINE=1 no download starts;
  an installed voice still speaks.
- Runs in a worker thread of the desktop main process; the UI thread never waits on it. The answer is
  cut into pieces (first piece short, each later piece at most three times the one before), each piece
  is synthesized while the previous one plays.
- The language comes from the answer text (script, then common words; app language on a tie).
- A new question cuts the old speech: the panel stops playback at once and the pieces not yet started
  are never synthesized. A piece the worker is already making cannot be stopped (the native call is
  not interruptible), so the new answer's first piece can wait for it: after a cut its first audio
  was 559-1248 ms (median 781 ms, 5 cuts) against about 570 ms without one. On a PC near the
  step-down limit and a long piece this wait can reach several seconds; restarting the worker instead
  would cost a model load (0.7-1.3 s) every time.
- 10 speakers: 0-4 female (measured pitch 160-197 Hz), 5-9 male (85-135 Hz), chosen in the panel.
  Speed setting 0.75x to 1.5x is applied by the model (measured: 7.8 s, 5.8 s, 3.9 s for the same text).
- Low-spec PCs (pickProfile / nextProfile in tts.js):
  - fewer than 2 cores, or under 3.5 GB of RAM: no natural voice; This PC's voice speaks and the
    panel says why ("This PC has too little memory for the natural voice...");
  - 4 cores or fewer, or under 8 GB: light setting (4 steps, 2 threads), and the panel says so;
  - if two answers in a row are synthesized slower than RTF 0.85 the voice steps down (standard to
    light, light to This PC's voice), with the reason shown.
  The light setting is still under RTF 0.25 on 2 threads here, so a PC several times slower than
  this one keeps up. Piper (RTF 0.05, 270-360 MB) would be the lighter neural option for en, it, ru,
  ro, but needs the older runtime and has no Japanese: not shipped, owner decision below.

## Licences: what the owner must accept

The Supertonic 3 weights are under the BigScience OpenRAIL-M licence
(https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE). It allows commercial use and has no
non-commercial or share-alike clause, but whoever distributes it must pass its use restrictions on to
users as an enforceable term (no impersonation or deepfakes, no unlabelled machine-made content, no
medical advice, no harassment, among others) and give them a copy of the licence. Filow names the
licence next to the download button and lists the restrictions in THIRD_PARTY_NOTICES.md (shipped in
resources/). Filow's own terms of use should carry the restrictions too: owner decision D5.

## End to end on the packaged QA build

release-t7-c (electron-builder --dir, filowQa), profile G:/FILOW/tmp/t7-profile, ports 4851/4852,
CDP 9356. Answers came from OK Filow's real local path (/api/buddy/ask to Ollama /api/chat), with
Ollama replaced by a local stand-in (G:/FILOW/tmp/t7-work/mock-ollama.mjs, OLLAMA_URL) because this PC
has no local model. Questions typed into the panel over CDP; the QA hook wrote the audio the main
process sent to the panel (G:/FILOW/tmp/t7-qa-tts-c/results.json, e2e.log).

- All five languages answered with the natural voice (44.1 kHz Supertonic audio, standard setting,
  4 threads), every piece sent, and the captured audio transcribed with 0% WER/CER in each language.
- First audio from the speak request to the first piece, two packaged runs (release-t7-b and -c):
  warm answers 506-885 ms (8 answers, median about 570 ms; one above the 800 ms target, Russian, 885 ms,
  while the PC was loaded); the first answer after launch 1267-1282 ms because it waits for the model
  load (1.2 s).
- A new question cuts the old speech. Measured as the time from submitting the new question to the
  panel reporting the old audio stopped (its "played ... (interrupted)" line in startup.log), 5 cuts:
  - before the fix (release-t7-b): median 505 ms, worst 532 ms. The panel only noticed the new
    question after an IPC round trip (the "agent, ..." check);
  - after the fix (release-t7-c, page.tsx bumps the turn and stops the speaker first): median 3 ms,
    worst 7 ms. Each time the long answer was cancelled after 2-4 of its 7 pieces, the queued pieces
    were never synthesized, and the new answer played in full.
- The packaged app holds everything the voice needs outside the asar: resources/app.asar.unpacked has
  tts-worker.js, sherpa-onnx-node, and sherpa-onnx-win-x64 with sherpa-onnx.node, onnxruntime.dll,
  onnxruntime_providers_shared.dll, sherpa-onnx-c-api.dll and sherpa-onnx-cxx-api.dll; the model loaded
  and spoke from that layout (no missing DLL).
- Download on a fresh profile (G:/FILOW/tmp/t7-qa-dl-c/dl.log, dl-results.json): the panel offered
  "Download the natural voice (129 MB)" with the source and licence note; a click started it; at 40%
  (16.5 s) the app was killed, leaving a 54,375,912-byte .part file; after a restart the panel offered
  "Resume the download (42% done)"; one click finished it (39.5 s including the hash check and
  unpacking) and the panel showed Listen and Remove. The release host answers a Range request with
  206 (checked with curl), which is what the resume relies on. Then, relaunched with FILOW_OFFLINE=1,
  an Italian question was answered in the natural voice (3/3 pieces). Screenshots were not possible:
  the panel window is hidden and does not paint for CDP.

## Samples to listen to

- Shipped voice, standard: G:/FILOW/tmp/t7-samples/supertonic3-s5/<en|it|ru|ro|ja>.wav
- Shipped voice, light: G:/FILOW/tmp/t7-samples/supertonic3-s4/<lang>.wav
- The ten speakers (English): G:/FILOW/tmp/t7-samples/supertonic3-voices/voice-<0..9>-en.wav
- Captured from the packaged app: G:/FILOW/tmp/t7-qa-tts-c/real-<lang>.wav
- For comparison: G:/FILOW/tmp/t7-samples/piper-*/<lang>.wav, G:/FILOW/tmp/t7-samples/kokoro-int8/en.wav
