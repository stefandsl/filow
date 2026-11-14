# Natural voice round 2: pronunciation, numbers and endings

Local work on `feat-voice-natural`, 2026-11-14. Main was merged into this branch
in `50034e1`, preserving both sides. Nothing was merged into main, pushed, tagged
or installed. Every audio operation rendered files; no playback device or microphone
was opened. Test profiles, audio, caches and logs are under `G:/FILOW/tmp/voice-natural`.

## What the owner chose

These are preferences from **one Italian-speaking listener**, not population MOS.
Italian speaker 0 won 10/11, speaker 9 won once, speaker 2 never. English speaker 5
won 3/3. Russian baseline speaker 0 won 2/3 versus speed100 once. Romanian speaker 9
won 3/3. Japanese, rated later: speed100 won 2/3, baseline once. Russian speed100 also won once.

Automatic now uses model speaker IDs IT 0, EN 5, RU 0, RO 9, JA 0. Japanese 0 is the
default before this branch, verified from `771ddf1:apps/desktop/tts.js`; round 1's
proxy-selected Japanese 4 is withdrawn. Explicit choices, including 0, still win.
Automatic Japanese speaks at speed 1.0 (`liftFor` in `tts.js`, no 1.05 lift); an
explicit Japanese speaker keeps the lift. Russian keeps 1.05: the listening page has
three Russian items with the same round-2 voice at 1.05 and 1.0 to decide it.
No model, synthesis-step count, precision or download changed.

## English words inside other languages

The shipped worker passes `extra: {lang}` to one `generate()` call. The upstream
[Supertonic implementation](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-tts-supertonic-impl.cc)
reads one language for that call, and its
[text processor](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-tts-supertonic-unicode-processor.cc)
wraps the entire text in that language's tags. There is no exposed per-span language
argument. Injecting nested markup is not used.

`tts-spans.js` uses a compact English UI/product vocabulary, bounded uppercase
acronyms and camel-case brand names. Quoted screen-mark labels can extend an English
phrase when it contains an English vocabulary anchor. An arbitrary capitalized
Italian or Romanian word does not qualify. Currency codes next to amounts stay in
the host-language span. The panel forwards current validated mark labels through
the local speech bridge; labels are bounded at the desktop boundary.

Each span uses its own language setting and the **same speaker ID**, speed and steps.
An 8 ms equal-amplitude crossfade joins adjacent spans. Intermediate spans have no
sentence silence. The session retains 8 ms for the next overlap and delivers the
rest immediately. The first mixed-language span gets 120 ms Web Audio scheduling
headroom versus the usual 30 ms, a bounded 90 ms addition to avoid short synthesis
underruns. This is before the first sound, not a pause between words. Existing
progressive sentence batching remains unchanged.

The corpus has 60 sentences each in IT/RU/RO, ten sentence templates and six English
word sets, with 1 to 3 target words per sentence: 130 targets per language. This is
a templated engineering corpus, not 180 independent natural conversations. Whisper
turbo int8 runs locally with its language forced to English. Case, PDF letter
spacing and PowerPoint word spacing are normalized; other near-matches fail.

| Host language | Targets recognized before | After English spans | Respelling fallback |
|---|---:|---:|---:|
| Italian | 121/130 (93.1%) | 129/130 (99.2%) | 120/130 (92.3%) |
| Russian | 128/130 (98.5%) | 127/130 (97.7%) | 126/130 (96.9%) |
| Romanian | 117/130 (90.0%) | 130/130 (100%) | 122/130 (93.8%) |

These are whole-sentence contextual recognition results. English spans are also
transcribed individually. Matched isolated controls render those same spans with
the original host-language tag, retaining the same speaker. They isolate the
language-setting effect but do not preserve the surrounding sentence's prosody.

| Host language | Isolated spans, host-language tag | Isolated spans, English tag |
|---|---:|---:|
| Italian (59 sentences) | 104/127 (81.9%) | 129/130 (99.2%) |
| Russian (60 sentences) | 124/130 (95.4%) | 129/130 (99.2%) |
| Romanian (59 sentences) | 108/127 (85.0%) | 129/130 (99.2%) |

One Italian and one Romanian control file did not produce a scorable span, so the
control column has 127 targets there.

The experimental pronunciation lexicon is retained in the measurement tools only.
It did not beat English-language synthesis on the contextual test. Russian's
contextual count fell by one word; this run does **not** establish a Russian
intelligibility gain. Recognition cannot establish an English accent or an inaudible
seam. The new blind page is the listening check. Japanese language routing is unit
tested and included in worker timing, but has no 60-sentence recognition evaluation.
Reverse Italian names in English are not implemented.

## Dates, clocks, years, amounts and versions

`tts-numbers.js` uses pinned `n2words` 6.3.0 for the five languages. Its
[MIT licence](https://github.com/forzagreen/n2words/blob/main/LICENSE) was checked
against the installed package's full LICENSE; the package and notice remain in
the production dependency tree. No remote service is needed. Local context rules
handle slash and ISO dates, written month dates, clocks, year context, ordinals,
decimal/thousands separators, percentages, common currencies, versions and ranges.
Structured tokens are protected before the broad numeral pass; invalid dates and
malformed clocks are preserved. Slash dates use day/month/year in every language.

Russian rules cover ordinal dates/years, the common `в ... году` prepositional
pattern, feminine minute/page numerals, decimal fractions and genitive ranges.
They are not a general Russian grammatical inflector. Romanian 2026 expands to
`două mii douăzeci și șase`. Japanese uses written Japanese numerals and counters;
readings and irregular counter pronunciations still depend on the model.

There are at least 40 authored expected-form tests per language. RU/RO/JA cases
are explicitly marked **needs a native check**. Original display text is carried
with each audio span so expanding numbers does not advance highlighting early.

Twelve isolated number/date probes per language were rendered before and after
and transcribed by the corresponding native-language Whisper recognizer. Error
rate below is edit distance over expected spoken-form tokens after normalizing
digits in the hypothesis; Japanese uses characters because it has no word spaces.
Insertions can make the rate exceed 100%. Alternate valid spoken forms, ASR
formatting and hallucinations on very short clips can count as errors. This is
not a semantic numeric-accuracy claim and not a native grammatical review.

| Language | Before errors / tokens | After errors / tokens |
|---|---:|---:|
| Italian | 32/31 (103.2%) | 2/31 (6.5%) |
| Russian | 45/55 (81.8%) | 0/55 (0%) |
| Romanian | 55/58 (94.8%) | 6/58 (10.3%) |
| English | 35/49 (71.4%) | 8/49 (16.3%) |
| Japanese | 54/74 (73.0%) | 16/74 (21.6%) |

Raw hypotheses and per-probe edits are in `round2/scored-numbers-*.json`. The
Romanian currency probe exposed and fixed the RON/English-acronym split. A version
at sentence end exposed and fixed terminal-period handling. Remaining errors
include short English clock/currency clips and Japanese dates, clocks and decimals.

## Endings

The previous trimmer used a sample threshold of 0.003 and kept at most 60 ms after
the last crossing, capped by the source buffer's length. It could remove a quiet
consonant/reverb tail and could not protect a buffer already ending above threshold.
The new path retains trailing material down to 0.0005, keeps a 20 ms margin, applies
a 20 ms fade at the end and appends 80 ms silence. It cannot reconstruct missing
phonemes, and a fade is not proof of natural linguistic prosody.

Across 268 paired renders (180 foreign-word sentences, 60 numeric probes and 28
listening sentences), files over 0.003 RMS in the final 20 ms were **0 before and
0 after**. The maximum final-20-ms RMS fell from 0.001752 to zero. Maximum
final-150-ms RMS fell from 0.097589 to 0.002831. Every rendered after-file ends
silently. The regression test also supplies an actually truncated nonzero waveform
and fails without the fade or padding; a separate quiet-tail fixture verifies that
the lower-level tail is retained.

The owner's particular abrupt English ending was **not reproduced** in the saved
or newly rendered English set. Inspection and existing tests show that the player
waits for the last scheduled buffer; normal completion does not call Stop. No
hardware playback was tested. Tail handling is a demonstrated robustness fix,
not a proven diagnosis of that one heard item.

## Timing and verification

`round2-latency.cjs` runs the real desktop session and worker, before and after, 15
sentences (3 per language) x 3 repeats, alternating order, on a virtual Web Audio
schedule (no device). Time to first audio, ms:

| Language | Before median / mean | After median / mean |
|---|---:|---:|
| Italian | 772 / 846 | 791 / 815 |
| English | 682 / 730 | 702 / 739 |
| Russian | 617 / 860 | 606 / 869 |
| Romanian | 658 / 759 | 634 / 808 |
| Japanese | 779 / 757 | 696 / 757 |
| All 45 | 734 / 791 | 676 / 798 |

No run had an extra gap between pieces. Sentences with English words were faster
(IT -63, RU -101, RO -95 ms mean). **Two date sentences exceed the 150 ms limit**:
Romanian "14 noiembrie 2026 la 14:30" +270 ms and Russian +146 ms. The cause is
length, not the pipeline: the old text swallowed the year and time, so its audio was
5.0 s; the correct reading is 6.6 s and takes longer to synthesize. The sentence has
no comma, so it stays one piece; cutting it between words would add a pause inside
the date. This is left for the owner to judge.

Validation on the final tree: vitest 3525 passed, 7 skipped (261 files); typecheck
and lint (`--max-warnings 0`) clean. Mutation checks: speaker defaults, span language,
span speaker, numbers, tail padding, tail fade, crossfade, dead-air fix, first-span
headroom and currency span (logs `round2-mutation-*.log`), and the Japanese lift
(by hand), were each broken on purpose and each was caught by a test.

The blind page is `G:/FILOW/tmp/voice-natural/listen2/index.html`, with 12 Italian
items (6 English-word, 3 date/time/year, 3 plain), 6 Russian, 6 Romanian and 4 English,
plus 3 Russian speed items (round 2 at 1.05 against 1.0).
Before uses the round-1 preferred speaker for each language, with speed 1.05 and
5 steps; after keeps that speaker and applies round 2. A/B sides are randomized
per sentence; the separate key is `G:/FILOW/tmp/voice-natural/listen2-key.json`.
There are no external resources or autoplay. Hidden muted Chromium inspection
passed 31 items/62 audio files in dark and light themes, with no overflow. Screenshots
and checks are under `round2-ui/`. No audio was played.

## Reproduction and limits

Use `tools/voice-natural/run.py` to set G: caches and hard process deadlines.
`round2-corpus.cjs`, `round2-bench.cjs`, `round2-span-controls.cjs`, `round2-asr.cjs`,
`round2-number-asr.py`, `round2-report.cjs`, `round2-latency.cjs`, `round2-mutate.py`,
`round2-listen.py` and `round2-ui.cjs` contain the file-only harnesses. The frozen
baseline is `G:/FILOW/tmp/voice-natural/round2-before.cjs`, copied from the merged
branch before round-2 changes. Measurements, PCM WAVs, transcripts and manifests
live under `G:/FILOW/tmp/voice-natural/round2`; none are downloads or cloud calls.

Still unverified: owner acceptance of round 2 and its joins, native RU/RO/JA forms,
physical output/stop latency, installed-app behavior, packaged ESM dependency
loading, mid-range CPU performance, and foreign-word detection beyond this compact
vocabulary. The trials use one stochastic render per recognition item; timing uses
repeats. Recognition scores are proxies, especially near the Russian ceiling.
