# Natural voice investigation

All generated files belong under `G:/FILOW/tmp/voice-natural`. Never play audio
from these scripts. `run.py` redirects caches and temporary files and kills its
own process tree at the deadline. No server, microphone, installed profile,
desktop input, or audio output device is used.

## Corpus and experiments

`corpus.json` fixes 12 Italian and five English, Russian, Romanian and Japanese
answers. It covers pointing, explanations, questions, numbers, dates, product
names, lists and markdown. The current parser removes pointer protocol tags
before progressive speech; the text corpus starts at that plain-text boundary.

`bench.cjs` uses the current desktop `speakable`, `splitSentences`, `trimSilence`
and WAV writer, with sherpa's native CPU synthesis and the app's thread count.
It saves every raw piece as well as each concatenated answer. This isolates
the synthesizer and text processing, without pretending to measure IPC or
physical playback latency. The whole-answer arm still allows sherpa's internal
chunking. `worker-bench.cjs` separately uses the real desktop worker/session and
the real progressive queue, with a fully available simulated token stream.
It does not simulate model/network delay or real-time playback starvation.

The synthesis sweep changes one setting at a time: steps, speaker, speed,
normalization or chunking. Each process warms the model before measuring.
RTF divides synthesis time by trimmed audio including inserted gaps. See [measurement limits](../../docs/okfilow/VOICE-NATURAL-2026-11.md#measurement-limits) for the repeat baseline, first-piece latency and memory definitions.

`candidates.cjs` isolates sherpa 1.12.40 for Piper and Kokoro. It does not change
the shipped 2.0.1 runtime. Kokoro Italian uses `lang: it` and speaker 35 (Sara),
not the export's default English frontend. Japanese requires a suitable frontend;
Russian and Romanian are not Kokoro languages.

`analyse.py` measures pitch, silence, clipping and DNSMOS per answer. `asr.cjs` saves verbatim Whisper hypotheses on four CPU threads. The [measurement report](../../docs/okfilow/VOICE-NATURAL-2026-11.md#measurement-limits) defines the analysis windows, language-specific error rates and interpretation.

## Sources and licences

- Supertonic weights: [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE).
  Commercial use is permitted subject to its use and redistribution conditions.
  The MIT file in the sherpa export describes code, not a replacement weight licence.
- Kokoro v1.0: Apache-2.0, including the licence in the exported model;
  [upstream model card](https://huggingface.co/hexgrad/Kokoro-82M).
- Piper Paola: [dataset CC0 declaration](https://huggingface.co/datasets/paolapersico1/Voice-Dataset-Italian).
  Joe, Denis and Mihai model cards identify CC0 datasets from
  [Nabu Casa](https://github.com/NabuCasa/voice-datasets). Each voice's model card
  is retained with its copied model; these are not a blanket licence for all Piper voices.
- DNSMOS: Microsoft DNS Challenge, [CC BY 4.0](https://github.com/microsoft/DNS-Challenge/blob/master/LICENSE).
  P.808 preprocessing follows [dnsmos_local.py](https://github.com/microsoft/DNS-Challenge/blob/master/DNSMOS/dnsmos_local.py).
  Cite Reddy, Gopal and Cutler, *DNSMOS: A Non-Intrusive Perceptual Objective Speech
  Quality Metric to Evaluate Noise Suppressors*, ICASSP 2021.

Full precision download URLs, byte sizes and SHA-256 values are recorded in
`full-downloads.json`. They are research assets, not yet an approved shipping model.

## Reproduce and inspect

The retained task directory contains the model assets, isolated Python packages
(`python/`) and legacy native runtime (`legacy/`). Scripts intentionally fail
instead of installing to a default C: cache. `fetch.py` downloads full-precision
assets; the int8 and legacy exports were copied from the earlier research directory.
Native package versions: shipped sherpa-onnx-node 2.0.1, isolated legacy 1.12.40.
Analysis uses librosa 0.11 and onnxruntime 1.23.2, plus soundfile and num2words.
Use `run.py SECONDS LOG COMMAND...` for every workload. For example:

```text
python tools/voice-natural/run.py 180 baseline-repeat.log node tools/voice-natural/bench.cjs baseline-repeat
python tools/voice-natural/run.py 180 latency-ro.log node tools/voice-natural/latency.cjs ro 2
python tools/voice-natural/run.py 300 analyse.log python tools/voice-natural/analyse.py
python tools/voice-natural/report.py
python tools/voice-natural/publish-report.py
python tools/voice-natural/listen.py
```

`sweep.py`, `measure.py` and `asr-all.py` orchestrate bounded child runs. Do not
overlap CPU timing with those analysis jobs. `queue-bench.cjs` pins the old queue
to commit 92f28bf and compares it with the working implementation through the
real voice scheduler and a silent AudioContext. `latency.cjs` alternates speaker
order over five repetitions per first piece. `mutate.py` and `mutate-speakers.py`
require a clean test baseline and restore source bytes in finally blocks.

`ui-build.cjs` renders the actual settings component; `ui-capture.cjs` checks it
in an offscreen, hidden Electron window with a separate G: profile. It never
calls play, opens the app main process, or accesses a microphone. The listening
page uses ordinary local WAV controls; only the owner should start playback.
Do not use `--no-sandbox` to work around renderer ACL failures.

## Optional online voice, not implemented

An optional online model could offer expressive delivery and broader voice
selection without a local CPU or model download cost. It would add recurring
cost, network latency, outage dependence and transmission of answer text.
No online voice API is called by this investigation.
