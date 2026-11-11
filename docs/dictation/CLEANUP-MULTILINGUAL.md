# Dictation cleanup beyond English (2026-11-11)

Owner: "one caveat is only for english but
https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small add this for multilanguage
purpose" and "https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507 or this one".

English dictations are cleaned by S1-mini by Superwhisper (`S1-MINI.md`). This file is about Italian,
Russian, Romanian and Japanese: what the speech engines write by themselves, whether the first model
helps, and what was built. Everything was decided by measurement on this PC (Core i9-13900KF, 128 GB
RAM, Windows 11, busy with other work).

## The decision per language

| Dictation language | Cleanup that applies | Why |
|---|---|---|
| English | S1-mini by Superwhisper (unchanged) | measured in `S1-MINI.md` |
| Russian | hesitation sounds out, then full stops, commas, question marks and capitals where the recognizer left the sentence open | better in 27 of 27 changed dictations (Vosk 15, Nemotron 12), none made worse |
| Japanese | the same | better in 38 of 38 changed dictations (ReazonSpeech 15, Dolphin 8, Nemotron 15), none made worse |
| Romanian | the same | better in 10 of 10 changed dictations (Nemotron), none made worse |
| Italian | the same, **owner to confirm** | better in 11 of 13 changed dictations (Nemotron), 2 made worse: a question mark on an instruction, capitals on "Sala Grande" |
| Any language, when the recognizer already ended the sentence (Parakeet does, always) | hesitation sounds out, nothing else | the model is not asked: 50 of 50 Parakeet dictations were left as they were |

Qwen3-4B as a deep cleanup: **not measured, not built**. The owner allowed one Q4 file "from the
official Qwen GGUF repository on Hugging Face if it exists". It does not: `Qwen/Qwen3-4B-Instruct-2507-GGUF`
answers "not found" and the Qwen organisation lists GGUF files only for the older `Qwen3-4B`. Nothing was
downloaded. Sources that do hold a Q4_K_M file of this model (2.50 GB), for the owner to choose:
`unsloth/Qwen3-4B-Instruct-2507-GGUF` (SHA-256 `3605803b...e597`), `lmstudio-community/Qwen3-4B-Instruct-2507-GGUF`
(`8cdb57cb...41fc`), `bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF` (`2fde00ce...464e`). All three are
conversions by third parties, not by Qwen.

## 1. What each speech engine already writes

65 sentences (15 each in Italian, Russian, Romanian, Japanese, 5 in English; names, numbers, acronyms,
questions, two-sentence dictations: `tools/dictation/cleanup-multi-samples.json`) were spoken by the
Windows voices installed on this PC (Zira, Elsa, Irina, Haruka, Andrei; no cloud) and given to Filow's own
speech session, the one dictation uses (`apps/desktop/stt.js`, the "questions" catalogue), one engine at a
time (`tools/dictation/engine-output.cjs`).

| Engine (where dictation uses it) | Language | Sentence end written | Commas | Capitals |
|---|---|---|---|---|
| Parakeet v3 (first choice on a standard PC for en, it, ru, ro) | en, it, ru, ro | 50 of 50 | yes | yes, names too |
| Nemotron streaming (every install starts with it; first choice on a light PC for en, it) | en | 0 of 5 | no | yes |
| | it | 1 of 15 | in 5 | in 9 of 15 |
| | ru | 3 of 15 | in 5 | in 14 of 15 |
| | ro | 3 of 14 | in 5 | yes |
| | ja | 0 of 15 | no | (no case) |
| Vosk small (Russian, light PC) | ru | 0 of 15 | no | none, all lower case |
| ReazonSpeech (Japanese, standard PC) | ja | 0 of 15 | no | (no case) |
| Dolphin (Japanese, light PC) | ja | 7 of 15 | no | (no case) |

Hold-to-talk and hands-free use the same engine and the same text step; hands-free types phrase by
phrase, so each phrase is one such output. Filow's own step after the engine takes out hesitation
sounds and tidies spaces; it adds no punctuation and no capitals.

Two things the measurement cannot answer: the voices are synthetic (flat questions, so several question
marks were missed by every engine), and the files start at the first sound, so some engines lost the
first word, which the app's buffered start avoids. Neither changes the columns above.

Not done as asked: the brief said to use the packaged QA build with the fake microphone. In that build
the dictated text can only be read from the clipboard (no window has the keyboard in this remote
session), so the engines were driven through the same `stt.js` session outside the app instead. The
packaged build was used for the end-to-end check in section 5.

## 2. Does the punctuation model help?

The model: `Horizon-Labs/multilingual-punctuation-truecase-small`, Apache-2.0 (its LICENSE and NOTICE
were read: fine-tuned from mmBERT-small, MIT, notice to keep). It is not a text generator: it gives every
word a label, one of six marks and one of three casings. It was published on 4 November 2026 and had 113
downloads when this was written. File used: `onnx/model_quantized.onnx`, 268,432,863 bytes, SHA-256
`a732af17...ec57`, with `tokenizer.json`, `tokenizer_config.json` and `config.json`, revision `b18abbd2`;
all four match the repository's `SHA256SUMS`.

How Filow uses it (`apps/desktop/truecase-text.js`, `dictation-punctuate.js`):

- only when the recognizer left the sentence open (no full stop, question or exclamation mark at the end);
- it only adds: a full stop, comma or question mark where there was none, a capital where there was a
  small letter. The recognizer's own marks and capitals always stay; no letter or digit changes (checked
  on every dictation, else the dictation is typed as it was);
- its colon and dash are not written (its own card calls them much less reliable);
- no capital right after a comma (the model's known "comma, Capital" weak spot);
- when the recognizer writes capitals itself, the model may only raise the first letter of a sentence;
- in Japanese the comma is "、" and the gap the recognizer leaves between two phrases is closed.

### On real engine output (what the user would get)

`node tools/dictation/truecase-measure.mjs <model dir> out.json --engine <engine-output.json>`

| Engine | Language | Dictations | Left alone (already ended) | Changed | Better | Worse |
|---|---|---|---|---|---|---|
| Vosk small | ru | 15 | 0 | 15 | 15 | 0 |
| Nemotron | ru | 15 | 3 | 12 | 12 | 0 |
| Nemotron | ro | 14 | 4 | 10 | 10 | 0 |
| Nemotron | it | 15 | 1 | 13 | 11 | 2 |
| Nemotron | ja | 15 | 0 | 15 | 15 | 0 |
| ReazonSpeech | ja | 15 | 0 | 15 | 15 | 0 |
| Dolphin | ja | 15 | 7 | 8 | 8 | 0 |
| Parakeet v3 | it, ru, ro | 45 | 45 | 0 | | |

Before and after, as typed:

| Before | After |
|---|---|
| `я не уверен что это сработает но можно попробовать` (Vosk) | `Я не уверен, что это сработает, но можно попробовать.` |
| `кто написал эту часть кода` (Vosk) | `Кто написал эту часть кода?` |
| `цена составляет одна тысяча двести пятьдесят евро включая ндс` (Vosk) | `Цена составляет одна тысяча двести пятьдесят евро, включая НДС.` |
| `Ce părere ai, merită să mai așteptăm o săptămână` (Nemotron) | `Ce părere ai, merită să mai așteptăm o săptămână?` |
| `parlato con giulia ferrari della nato a bruxelles` (Nemotron, first word lost) | `parlato con Giulia Ferrari della NATO a Bruxelles.` |
| `まず鈴木さんにメールを送ってそのあと山田さんに電話します` (ReazonSpeech) | `まず鈴木さんにメールを送って、そのあと山田さんに電話します。` |
| `田中太郎です 東京で働いています` (ReazonSpeech) | `田中太郎です。東京で働いています。` |
| `このコードは誰が書きましたか` (Nemotron) | `このコードは誰が書きましたか？` |

The two made worse, both Italian: `Ricordati di comprare il pane, il latte e le uova` got a question
mark, and `riunione è alle 9 e 30 in sala grande` became `Riunione è alle 9 e 30 in Sala Grande.`
"Better" includes answers that are still incomplete: a question that got a full stop because the voice
was flat (ru-02, ro-02), a misheard word that got a capital.

### On clean text (the expected sentence with marks and capitals removed)

This imitates an engine that writes nothing but words, which Filow has only for Russian (Vosk); it shows
the model's own limits. 15 per language, 4 threads:

| Language | Exact | Acceptable | Incomplete | Harmful | What the harmful ones were |
|---|---|---|---|---|---|
| Italian | 8 | 2 | 3 | 2 | "Sala Grande"; a question mark on "Ricordati di comprare..." |
| Russian | 11 | 2 | 2 | 0 | |
| Romanian | 7 | 4 | 3 | 1 | "Sala Mare" |
| Japanese | 14 | 0 | 1 | 0 | ("nhk" stayed lower case) |

Exact: the expected text, character for character. Acceptable: only commas differ, or a full stop where
the sample has a comma ("Grazie mille per l'aiuto. Ci sentiamo lunedì."). Incomplete: something is still
missing but nothing wrong was added (a question written as a statement, an acronym left in lower case).
Harmful: something wrong was added. The verdict is computed by the script and was read line by line; one
Romanian line the script calls harmful ("Cluj, mă întorc": a comma for a full stop) is counted as
incomplete here.

### Time and memory (CPU only)

| What | Value |
|---|---|
| Per dictation, 4 threads | median 10 ms, 90th percentile 13 ms, worst 20 ms |
| Per dictation, 2 threads | median 15 ms, 90th percentile 18 ms, worst 21 ms |
| Loading the model | 0.8 to 0.9 s |
| Memory of the process with the model | about 630 MB |
| Budget in the app | 400 ms; later than that the dictation is typed as it was; three late answers in a row and it rests until Filow restarts |
| GPU | not used, not needed at 10 ms |

## 3. Qwen3-4B

Not measured: see the decision table. The model card was read (Apache-2.0, 4B parameters, no thinking
mode in this variant). If the owner names a source, the measurement is the same samples plus English
through `llama-server` (already bundled), behind `acceptCleaned` of `dictation-cleanup.js`, CPU and GPU;
the bundled llama.cpp build is CPU only, so a GPU number needs another build of it as well.

## 4. Runtime for the model

| Option | Verdict |
|---|---|
| The onnxruntime inside sherpa-onnx (already shipped) | Not usable. `sherpa-onnx-node` exposes its own speech, voice and punctuation classes, not a general ONNX session; its punctuation classes take sherpa's own model formats, not this one, and it has no tokenizer for it. |
| transformers.js (`@huggingface/transformers`, Apache-2.0) | The model card shows it working (not tried here). It would pull onnxruntime-web and sharp into the desktop app for one pipeline call. Not chosen. |
| **onnxruntime-node 1.30.0 (MIT) + `@huggingface/tokenizers` 0.2.0 (Apache-2.0, pure JavaScript, 0.3 MB)** | **Chosen.** Both were already in the repository's lockfile (the web app's transformers.js depends on them), so no new download. |

Packaging (`apps/desktop/package.json`): the two packages are dependencies of the desktop app and are
unpacked next to `app.asar`; only the binaries of the platform being built are kept, and the DirectML
files (36 MB, GPU only) are left out. Added to the Windows x64 app: `onnxruntime.dll` 27.4 MB and the
binding 0.3 MB.

It runs in a process of its own (`truecase-worker.js`, started with Electron's `utilityProcess`,
`truecase-runtime.js`), not in Filow's main process: the speech recognizer there already loads another
version of `onnxruntime.dll`, and two libraries of that name in one process do not mix. The process is
started when the dictation keys go down for one of the four languages, and stopped after ten minutes
without a dictation.

Platforms: built and run on Windows x64 only. The npm package carries binaries for Windows arm64, macOS
arm64 and Linux x64 and arm64 (no macOS x64 in this version); none was run. Where the runtime is not in
the build, Settings says so and dictations are typed as before.

## 5. What was built

- Pipeline (`dictation.js`): recognizer, Filow's text step, then S1-mini for English or the punctuation
  step for it, ru, ro, ja. A late, failed or unprovable answer never stops a dictation.
- The model: downloaded from Settings > Dictation with one button that states the size (289 MB), four
  files, each with a pinned SHA-256, resumable, named only after its check (`truecase-runtime.js`
  `fetchModel`, `verifyDownload`); a wish that could not be met without a network is kept and tried again
  at the next start.
- Settings, five languages: the switch (on by default), what it does and that it never changes words, the
  missing-model and missing-runtime notices, and one sentence that says which cleanup applies to which
  language.
- Report a problem: a line for the model (on or off, on this computer or not, runtime in this build or
  not, running, last error) and a stage per dictation: `punctuation added (12 ms)` or
  `punctuation skipped (already punctuated)`.
- About (a fourth fact, five languages) and THIRD_PARTY_NOTICES (the model, mmBERT-small, ONNX Runtime,
  the tokenizer); the model's LICENSE and NOTICE ship in `apps/desktop/licenses/truecase-small`.
- Tests: `apps/desktop/dictation-punctuate.test.ts` (labels to text, the merge rules, which dictations,
  late and failing answers, the download and its hashes, the process and its idle stop).

### Packaged check (2026-11-11)

Unpacked QA build with the runtime inside, a profile of its own with the Vosk Russian engine and the
model's four files, a Russian recording (Windows voice) as the microphone, the keys sent through the QA
channel, two hold dictations. The model's process was started when the keys went down (`truecase: model
loaded in 1851 ms`, 652 MB working set), each dictation logged `punctuation added (18 ms)` and `(12 ms)`,
release to text 67 and 53 ms, and what was typed was `Я не уверен, что это сработает, но можно
попробовать.` (the engine alone: `я не уверен что это сработает но можно попробовать`). The session had
no window with the keyboard, so the words were read from the clipboard (saved to a file before the run
and put back after it). Not run in the package: Japanese, Italian, Romanian, hands-free, and the
download button (the files were copied into the profile; the download code is covered by a unit test
with a stand-in downloader, not against huggingface.co from inside the app).

## Not built, and open

- **The model in the setup.** It is not on the installer's components page, in the welcome or in the
  setup picker yet: it is fetched from Settings > Dictation. The places are the ones S1-mini uses
  (`S1-MINI.md`, "The model in the setup"). Owner's call before it is built: ticked for everyone, or only
  when the interface or dictation language is one of the four? An English-only user gains nothing from
  289 MB.
- **Italian on or off by default** (2 of 13 made worse).
- **English without S1-mini** (macOS and Linux today, or the model not downloaded): Nemotron leaves
  English sentences open too (0 of 5 ended). The punctuation model fixed all five in a side run, but it
  is not wired for English.
- Qwen3-4B: a source for the file.
- macOS and Linux: the runtime is in the npm package but was not run there.
