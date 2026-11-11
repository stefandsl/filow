# Script translation on this PC

The owner asked (2026-11-11, in Italian): translation should be possible by default locally too, with
a local model that the install already sets up. Before this, the editor's Translate went to the cloud
only (OpenRouter, or FreeLLMAPI when chosen), behind the outbound notice.

## What the user gets

- The editor ("Edit points") translates on this PC by default. Nothing leaves the computer on that
  path, so there is no notice and no masking of personal data.
- Next to the language there is a small choice, remembered: "On this PC" or "Cloud: <who gets the
  script>". One line under the controls says, before the press, where the text will be worked on and
  with which model.
- The cloud stays a choice. Picking it, or pressing "Use the cloud", shows the existing notice first.
- One is never used instead of the other. When the local path cannot run, the editor says why (Ollama
  is not running, or no translation model is installed) and offers "Use the cloud" and "Open Local
  models". An installed Ollama that is stopped is started by the desktop shell first (nothing is
  downloaded for that).
- Offline mode translates locally. With the cloud picked, offline mode says the cloud is off; it does
  not translate somewhere else instead.

## How a small model is kept honest

`apps/web/lib/translateLocal.ts`. The outline is parsed, and each section's lines (title, then
points) are sent in chunks of at most 6 lines. A chunk goes out as a JSON object with one key per line
(`l1`..`l6`) and must come back as an object with exactly those keys: Ollama's schema-constrained
output holds the shape, and the code checks it again. A line is refused when it is empty, several
times longer than its source, a word-for-word copy of a source sentence, in the wrong writing system
(Latin letters for Russian or Japanese, Chinese characters in a Russian sentence), a sentence with
the small words of another language and none of the target's (a model that rewords the Italian in
Italian; checked for English, Italian, Romanian, German, French and Spanish), or an HTML comment.
A chunk with a refused line is asked once more (other temperature and seed) and only the missing lines
are taken from the second answer. What is still missing stays in the original language, and the
editor says how many lines and in which section. The result always has the source's sections and
points one to one: nothing is dropped, merged or invented. Time targets ("<!-- target: 12 min -->",
"(3 min)") never go to the model; they are taken from the source.

What these checks cannot see: a fluent line with the wrong meaning, a title of one or two words left
as it was, and a reworded line with fewer than two of its language's small words (3 such lines passed
with translategemma:4b below; none with Gemma 4). The editor says "Check it, then
Save" for that reason, and the model choice below rests on reading the output.

## The model: measured before choosing

Fixed input: one Italian outline, 3 sections and 13 points (16 lines with the titles), into English,
Russian, Romanian and Japanese, and the same outline in English into Italian
(`tools/translate-bench/bench.mts`, which calls the real code path). This PC: RTX 3070 with 8 GB,
Ollama 0.40.13, 2026-11-11. Seconds are for the whole outline with the model already loaded. Outputs
were read line by line; "wrong" counts lines whose meaning is wrong or that are not in the language
asked for.

| Model (installed size) | it>en | it>ru | it>ro | it>ja | en>it | Structure | Reading |
|---|---|---|---|---|---|---|---|
| lfm3-vl (1.4 GB), the Lite and Standard screen helper | 9.5 s, 2 wrong | 6.9 s, 7 wrong | 6.5 s, 5 lines left in Italian, 6 wrong | 8.5 s, 6 wrong | 6.7 s, 5 lines with grammar errors | kept | Not acceptable. Invented words in Russian ("Бугионно"), names rewritten ("Филов", "Хелинэкс"), a version line that says something else in Japanese, the e-mail address dropped. |
| qwen3-vl:2b (1.8 GB), the Best quality screen helper | 7.4 s, 1 wrong | 7.8 s, 5 wrong | 7.6 s, 5 lines left in Italian, 4 wrong | 7.1 s, a whole section in English, 3 wrong | 7.5 s, 2 wrong, 4 lines with grammar errors | kept | Not acceptable outside English. Chinese characters inside a Russian sentence, an English word left in ("chase"). |
| gemma4:e2b (4.3 GB) | 2.5 s, 2 wrong | 4.6 s, 2 wrong | 7.2 s, 2 wrong, 4 lines with grammar errors | 3.2 s, 3 wrong | 4.3 s, 0 wrong | kept (a second run with the final checks: 1.4 to 2.8 s per pair, no line refused) | Acceptable as a draft to check. The two wrong lines are the same idioms everywhere ("gobbo" for teleprompter, "spunta i punti"). Romanian is its weakest language. Names of people are written in the target script in Russian and Japanese ("Марта Бьянчи"). |
| gemma4:e4b (6.1 GB) | 68.6 s, 1 wrong | 68.7 s, 1 wrong | 71.7 s, 1 wrong | 70.4 s, 1 wrong | 49.7 s, 0 wrong | kept | Good. Only "gobbo" is wrong. Names, numbers and the address kept everywhere. The seconds are not its normal speed: the graphics card was held by other work during this run and the model ran almost entirely on the processor. |
| translategemma:4b (3.1 GB), pulled for this test | 5.4 s, two of three sections still Italian: 6 lines refused by the checks and reported, 3 reworded lines and 2 two-word titles passed | 3.4 s | 4.9 s, 3 lines left in Italian or reworded | 3.3 s | 3.1 s | kept | Not used. Through this prompt (a JSON object of lines) it rewords the source in its own language on whole chunks, and one line says "translation into Japanese" where the source says "local translation". It expects its own prompt format, one text at a time. Its licence is the Gemma Terms of Use, not Apache 2.0. Not read line by line in Russian and Japanese. |
| qwen3-vl:8b (5.8 GB) | 81.6 s | 146 s | 219 s | 225 s | 221 s | kept | Not used: minutes per outline, names rewritten in Russian and Japanese, and larger than Gemma 4 E4B. |

lfm3-vl, qwen3-vl:2b, gemma4:e4b and qwen3-vl:8b were measured before the "copied word for word",
"wrong writing system" and "other language" checks existed; with them, the lines counted above as left in Italian or
written in English are reported to the user as not translated instead of passing (tests cover this;
the models were not run again because the Ollama they are installed in went away during the work).

### Choice

| Setup tier | Translation model | Why |
|---|---|---|
| Any tier, PC with 32 GB of memory or more | gemma4:e4b | Already downloaded by the installer and the first start on these machines (script from slides). Best output measured. |
| Any tier, PC with 8 to 31 GB | gemma4:e2b | Already downloaded by the installer and the first start on these machines. The smallest model measured whose output is usable. |
| Lite on a PC with less than 8 GB | none | The only text model there is lfm3-vl, which does not translate well enough, and Gemma 4 E2B does not fit next to the app. The editor says so and offers the cloud; Settings says why. |

The tier (Lite, Standard, Best quality) does not decide the translation model: memory does, the same
rule the installer already used for the script model (`scriptModel` in `packages/core/src/profile.ts`,
mirrored by `recommend` in `apps/desktop/localai.js` and by the installer's components page). No new
model was added to an install list. What changed there:

- the labels of Gemma 4 E2B and E4B say "script from slides and translation" (installer, 12
  languages; welcome and Settings, 5 languages);
- Settings > Setup for this computer lists the script model with the setup's one-time downloads, so
  "Download now" gets it on a PC where the installer's choice was skipped;
- the sizes shown are the ones Ollama reports once the model is installed: E2B 4.3 GB (was 6), E4B
  6.1 GB (was 9). The installer's disk check uses 5 and 7 GB.

When several are installed the order is gemma4:e4b, then gemma4:e2b. `TRANSLATE_LOCAL_MODEL` names
another installed model for people who want to try one.

### Licence

Gemma 4 (both sizes) is distributed by Ollama under the Apache License 2.0 (the licence text Ollama
returns for `gemma4:e2b`, read 2026-11-11). It allows commercial use and redistribution. Filow does
not ship the weights: the installer and the app download them from Ollama's registry on the user's
PC, as before.

## Placeholder leak ("[PERSON_NAME]" in a saved title)

The owner's saved script had the title "# PARTE I - Che cos'è [PERSON_NAME]?". Cause: before a cloud
call the PII guard replaces names, addresses and numbers with placeholders ("[FULLNAME_1]",
"[EMAIL_1]") and `restore()` puts the values back by exact match. A model that rewrites the
placeholder ("[PERSON_NAME]", "[fullname 1]") leaves text that `restore()` does not recognise, and
both script routes (translate and generate) handed it to the editor. The saved file was not found on
this PC, so which of the two routes wrote that title is not known; both had the hole and both are
closed:

- `restore()` accepts other case and spacing of a known placeholder;
- `placeholderLeaks()` finds what still looks like a placeholder and was not in the user's own text;
- translate (cloud): such a line becomes the source line again and is counted as not translated; when
  the structure was lost too, the translation fails and the editor keeps its text;
- generate: the slide is written once more, and fails with a clear message if it happens again.

The local path masks nothing, so it cannot leak a placeholder.

## Tests

`apps/web/app/api/translate-local.test.ts` (fake Ollama, no real model), `apps/web/lib/translateWhere.test.ts`,
`packages/core/src/profile.test.ts` (scriptModel), `apps/web/components/setupPicker.test.tsx`. Each
check was seen failing with the code broken on purpose. Packaged check with the real model:
`tools/autoloop/e2e/translate.mjs`.
