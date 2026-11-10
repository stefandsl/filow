# Speech in five languages: English, Italian, Russian, Romanian, Japanese

Owner's requirement (2026-11-09): Filow must understand at least Russian, English, Italian, Romanian and
Japanese, with at least partial results on low-spec hardware using local models only.

This file holds the measurements behind the model choice in `apps/desktop/stt.js` (catalogue,
`CANDIDATES`, `chooseModels`), the choice itself, how tracking copes with each script, and the plan for
adding ru, ro and ja to the interface.

## How it was measured

- Audio: 12 clips per language from Google FLEURS (dev split, CC-BY-4.0), the first 14 MB of each
  language's archive. URLs, sizes and SHA-256 in `G:/FILOW/tmp/t8-audio/audio.tsv`.
- Models: every candidate from the sherpa-onnx `asr-models` release page, run through
  `sherpa-onnx-node` 2.0.1 (the runtime Filow ships), CPU only, int8 where offered. URLs, sizes and
  SHA-256 in `G:/FILOW/tmp/t8-models/models.tsv`.
- Error rate: `packages/stt/src/wer.ts` (unit-tested in `wer.test.ts`). Word error rate after Unicode
  NFKC, lower-casing, removing punctuation and apostrophes, cedilla ş ţ read as ș ț (Romanian) and ё as е
  (Russian); Romanian diacritics are kept, so "si" for "și" counts as an error. Character error rate
  for Japanese, after folding katakana to hiragana and dropping spaces, so a model that writes the same
  word in the other kana is not punished. Lower is better.
- Speed: real-time factor (decode time / audio time, lower is faster; above 1 cannot keep up), 4 clips x
  5 passes, median and worst, with 2 threads (stands for an old 4-core laptop) and 4 threads. Peak memory
  is the process's peak working set with the model loaded. The machine was shared with other builds,
  so the worst values are noisy.
- Tool: `tools/stt-bench/bench.mjs` (one process per measurement). Raw logs:
  `G:/FILOW/tmp/t8-logs/bench-run1.log`, `bench-sensevoice.log`, `segmenter.log`.

## What the shipped model (Nemotron 3.5 streaming) does

| Language | Error rate | Clips |
|---|---|---|
| English | 11.1 % WER | 12 |
| Italian | 12.3 % WER | 12 |
| Russian | 20.4 % WER | 12 |
| Romanian | 29.9 % WER | 12 |
| Japanese | 13.2 % CER | 12 |

Language set per stream (Filow passes the spoken language). With the language left to the model
("auto") English and Italian are the same and the others worse: Russian 20.8 %, Romanian 36.0 %,
Japanese 13.6 %.
Speed: 2 threads RTF 0.60 median, 0.71 worst; 4 threads 0.39, 0.55 worst. Peak 880 MB. Archive 475 MB.
Licence OpenMDW-1.1.

So Nemotron covers all five, streaming, but Romanian is poor (3 words in 10 wrong) and Russian middling.

## Candidates, same clips

| Model | Streaming | Languages measured (error rate) | RTF 2 thr (median / worst) | RTF 4 thr | Peak RAM | Archive | Licence |
|---|---|---|---|---|---|---|---|
| Nemotron 3.5 streaming 0.6b | yes | en 11.1, it 12.3, ru 20.4, ro 29.9, ja 13.2 | 0.60 / 0.71 | 0.39 / 0.55 | 880 MB | 475 MB | OpenMDW-1.1 |
| Parakeet TDT 0.6b v3 | no | en 6.9, it 6.5, ru 9.3, ro 16.9 (no ja) | 0.116 / 0.118 | 0.074 / 0.079 | 1161 MB | 487 MB | CC-BY-4.0 |
| Vosk small ru (zipformer) | yes | ru 19.0 | 0.031 / 0.032 | 0.029 / 0.030 | 208 MB | 24 MB | Apache-2.0 |
| T-one Russian | yes | ru 19.4 | 0.098 / 0.111 | 0.079 / 0.088 | 522 MB | 128 MB | Apache-2.0 (not re-checked) |
| Zipformer 8 languages (PengChengStarling) | yes | en 17.5, ru 16.7, ja 10.8 | 0.193 / 0.203 | 0.162 / 0.169 | 555 MB | 259 MB | none published: excluded |
| NeMo FastConformer 10 languages | no | en 9.2, it 9.2, ru 16.2 | 0.035 / 0.036 | 0.024 / 0.025 | 486 MB | 107 MB | not stated in the archive: not used |
| Omnilingual 300M CTC | no | en 13.4, it 13.5, ru 29.2, ro 27.0, ja 22.8 | 0.275 / 0.373 | 0.146 / 0.153 | 902 MB | 292 MB | Apache-2.0 |
| Whisper tiny | no | en 16.1, it 41.5, ru 50.0, ro 83.1, ja 45.3 | 0.064 / 0.067 | 0.053 / 0.058 | 491 MB | 116 MB | MIT |
| Whisper base | no | en 8.3, it 23.5, ru 25.0, ro 59.7, ja 26.7 | 0.129 / 0.137 | 0.104 / 0.108 | 637 MB | 208 MB | MIT |
| Whisper small | no | en 6.9, it 14.2, ru 11.1, ro 35.3, ja 9.5 | 0.519 / 0.554 | 0.376 / 0.476 | 1216 MB | 639 MB | MIT |
| SenseVoice (2024-07-17) | no | en 9.2, ja 4.7 | 0.067 / 0.077 | 0.040 / 0.073 | 427 MB | 163 MB | FunASR model licence (custom) |
| SenseVoice (2025-09-09) | no | en 35.5, ja 77.6 | 0.054 / 0.060 | 0.035 / 0.036 | 415 MB | 166 MB | FunASR model licence (custom) |
| Dolphin base CTC | no | ja 13.1, ru 51.4 | 0.030 / 0.033 | 0.015 / 0.020 | 542 MB | 81 MB | Apache-2.0 |
| ReazonSpeech zipformer ja | no | ja 8.2 | 0.030 / 0.033 | 0.021 / 0.022 | 697 MB | 713 MB | Apache-2.0 |
| Moonshine base ja | no | ja 6.0 | 0.062 / 0.063 | 0.053 / 0.055 | 418 MB | 104 MB | Moonshine community licence, not verified: not used |

Error rates are percent; ja is CER, the rest WER. Licences were read from each model's README in the
archive where it has one; "not re-checked" means taken from the release page only.

Notes on the candidates:
- No streaming model available through sherpa-onnx is good for Romanian: Nemotron is the only streaming
  one that knows it, at 29.9 %.
- The 8-language zipformer would be the best streaming model for Japanese (10.8 % CER, three times
  faster than Nemotron), but its repository publishes no licence, so Filow cannot ship it.
- SenseVoice 2024 is the most accurate on Japanese (4.7 %) but carries a custom licence (attribution,
  keep the model name, a non-disparagement clause that ends the licence). That is an owner decision,
  see below. Its 2025 export reads Japanese badly on these clips (77.6 %): not a candidate.

## The choice (apps/desktop/stt.js)

Two uses: (a) following a talk against its script, which needs streaming (text while the person
speaks); (b) OK Filow questions, one short utterance, where a phrase model is fine.

| Language | (a) Following a talk, standard PC | (a) light PC | (b) Questions, standard PC | (b) light PC |
|---|---|---|---|---|
| English | Nemotron, 11.1 % | Nemotron | Parakeet v3, 6.9 % | Nemotron |
| Italian | Nemotron, 12.3 % | Nemotron | Parakeet v3, 6.5 % | Nemotron |
| Russian | Nemotron, 20.4 % | Vosk small ru, 19.0 %, 24 MB | Parakeet v3, 9.3 % | Vosk small ru |
| Romanian | Parakeet v3, 16.9 %, phrase by phrase | Parakeet v3, phrase by phrase | Parakeet v3, 16.9 % | Parakeet v3 |
| Japanese | Nemotron, 13.2 % | Dolphin, 13.1 %, phrase by phrase | ReazonSpeech, 8.2 % | Dolphin |
| Auto | Nemotron (detects the language) | Nemotron | Nemotron | Nemotron |

- "Light" is a PC with under 6 GB of memory or at most 4 logical processors (`tierFor`, pure, takes
  `ramGb` and `cores` as inputs so track T2's hardware profile can feed it at merge).
- `chooseModels({ language, use, ramGb, cores })` is pure and unit-tested
  (`apps/desktop/stt-catalogue.test.ts`); it returns the models best first. The first is what the
  download button fetches (with the Silero voice detector, 0.6 MB, for a phrase model); later entries
  are fallbacks used when they are already on disk.
- Downloads keep the existing path: only after the user presses Download, from the sherpa-onnx release
  page, resumable (`.part` file plus HTTP Range), and each archive must match its pinned SHA-256 before
  it is unpacked. Only the files the recognizer loads are kept.
- Honest fallback: when the language has no streaming model good enough (Romanian), or a light PC runs
  a phrase model (Japanese, Romanian), or only a fallback model is on disk, Settings > Local models says
  so in plain words (`SherpaLanguageNote`, strings `speech.notePhrases`, `speech.noteFallback`,
  `speech.noneForLang`). Phrase by phrase means the script moves after each phrase the voice detector
  closes (pause of 0.4 s, or 8 s of continuous speech) instead of word by word.
- The spoken language is stored by the desktop shell (`settings.speechLanguage`) from Settings and from
  each take, so OK Filow's questions use the same model choice.

## Tracking in each language (packages/core)

- Tokenisation: Russian (Cyrillic, case forms of small numbers), Romanian (comma and cedilla forms of
  ș and ț, and no diacritics at all, fold to the same token: "si" matches "și"), Japanese (no spaces:
  words cut with `Intl.Segmenter("ja")`, built into V8 and Electron, no extra dependency; kanji numerals,
  half-width katakana and full-width letters folded). Tests in `packages/core/src/text.test.ts` and
  `guard.test.ts`.
- Segmenter choice for Japanese, measured on what the models wrote for the 12 FLEURS clips against the
  reference text (`segmenter.log`): with `Intl.Segmenter` words, the share of reference words found in
  the same clip's transcript is 73.6 % (Nemotron) to 86.8 % (ReazonSpeech), and in other clips 0.5 %;
  character bigrams give the same separation (73.9 to 86.6 % against 0.3 %) with more, weaker tokens.
  Words were kept: they are what the script shows and what the guard compares. Speed: 1.2 ms per 1000
  characters median, 1.5 ms worst, 5 passes.
- English and Italian unchanged: the new tokenisation was run against the old one on every line of the
  repository's test files (42 789 lines); the 75 lines that differ are Romanian, Russian or Japanese text
  (`G:/FILOW/tmp/t8-logs/equiv.log`).
- Trap corpora (a gullible model that would tick a point on any shared word): `docs/gauntlet/corpus/
  traps-ru`, `traps-ro`, `traps-ja`, next to `traps-en` and `traps-it`. With the guard: recall 1.0 and 0
  false completions in each; without it the same model makes 6 false completions per corpus, so the
  corpora really contain traps (`packages/core/src/gauntlet.test.ts`).

## Answers in the language of the question

`apps/web/lib/buddy/lang.ts`: the spoken language set by the user wins; else the question's script
(kana or kanji: ja, Cyrillic: ru), Romanian letters, then the commonest short words; else the interface
language (Accept-Language); else English. The prompt says "Answer in Russian." and the answer carries
`lang` (en, it, ru, ro or ja) in the `X-Buddy-Lang` header of `/api/buddy/ask`, for the voice (track T7)
to pick a matching voice.

## Plan for ru, ro and ja in the interface (not done: tracks T2 and T3 are editing the strings)

Where strings live today:
- `packages/core/src/i18n.ts`: the web app, about 490 keys in `en`, the same in `it` (`Lang = "en" | "it"`).
- `apps/desktop/main.js`: four tables, `MENU_TEXT`, `NET_TEXT`, `SPLASH_TEXT`, `LOCAL_AI_TEXT`, en and
  it, picked by `menuLang()`; `apps/desktop/okfilow.js` and the welcome window (`welcome.ts`, T3) have
  their own.
- `apps/desktop/vendor/i18n` is the core dictionary bundled for the shell.

Steps:
1. Widen `Lang` to `"en" | "it" | "ru" | "ro" | "ja"`, add `LANG_LABELS` (Русский, Română, 日本語) and
   `langFromLocale` for ru/ro/ja; keep `Partial<Record<I18nKey, string>>` so a missing key falls back to
   English while translation is in progress.
2. `menuLang()` and the desktop tables: same five codes, English fallback per key.
3. `tools/autoloop/checks/i18n-parity.mjs` already loops over every dictionary: it will report each
   missing key and each placeholder that differs for the new languages without change. Add a QA-1 style
   check that Japanese strings use 。、 and no ASCII full stop inside a sentence, and that Romanian
   strings use the comma-below ș ț (U+0219, U+021B), not the cedilla forms.
4. Fonts: the UI font is Inter (`apps/web/app/theme-tokens.css`), which has Cyrillic, so Russian and
   Romanian render in the same face. Inter has no Japanese glyphs: the stack falls back to the system
   (Yu Gothic UI or Meiryo on Windows, Hiragino on macOS, Noto Sans CJK on Linux only if installed). Add
   `"Yu Gothic UI", "Hiragino Sans", "Noto Sans JP"` after Inter so the fallback is chosen, not left to
   chance, and test on Linux without CJK fonts (the AppImage may need a note).
5. Line breaking: many containers use `overflow-wrap: anywhere`, which is right for Japanese (no
   spaces) but can break before 。 or small kana. Set `:lang(ja) { line-break: strict; word-break: normal; }`
   and use `word-break: auto-phrase` (Chromium 119+, Electron 45 has it) for headings so phrases stay
   whole. Russian words are long: check buttons at 320 px (A11Y-07 reflow probe) in ru.
6. Length: Russian and Romanian run about 20 to 30 % longer than English; the reflow probe and a
   screenshot pass in each language catch clipped buttons.

## Owner decisions

1. SenseVoice for Japanese questions: 4.7 % CER against 8.2 % (ReazonSpeech, Apache-2.0, chosen now) and
   163 MB against 713 MB, but under the FunASR model licence (custom terms, non-disparagement clause).
   Use it or not?
2. Romanian follows a talk phrase by phrase (Parakeet, 16.9 %) instead of word by word with Nemotron
   (29.9 %). The other way round is one line in `CANDIDATES` if word-by-word matters more than accuracy.
