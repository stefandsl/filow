// Measures the Japanese word segmentation used by tracking (docs/stt/LANGUAGES.md, "Japanese segmentation").
//   node --experimental-strip-types --no-warnings tools/stt-bench/segmenter.mjs <bench-out-dir> [model ...]
// Reads the <model>.wer.json files bench.mjs wrote (reference and hypothesis per clip) and reports, per model:
//   same clip:  share of the reference's content words that tracking finds in what the recogniser wrote
//   other clip: the same share against the transcripts of the other clips (words matched by accident)
// for the product tokeniser (Intl.Segmenter, packages/core/src/text.ts) and for a character-bigram baseline,
// plus the speed of the tokeniser. No network, no model: text only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FUZZY_MIN, contentTokens, similarity, tokenize } from "../../packages/core/src/text.ts";

const [dir, ...wanted] = process.argv.slice(2);
if (!dir) {
  console.error("usage: segmenter.mjs <bench-out-dir> [model ...]");
  process.exit(2);
}
const models = wanted.length ? wanted : ["nemotron", "reazonspeech-ja", "dolphin"];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "-");

/** Content words of a text, as tracking sees them. */
const words = (text) => [...new Set(contentTokens(text))];
/** Baseline: every pair of adjacent kanji or katakana characters. */
const bigrams = (text) => {
  const out = new Set();
  for (const run of text.match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu) ?? []) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  return [...out];
};
const foundWord = (w, heard) => heard.some((h) => similarity(w, h) >= FUZZY_MIN);

for (const model of models) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(dir, `${model}.wer.json`), "utf8")).langs?.ja?.rows;
  } catch {
    rows = null;
  }
  if (!rows?.length) {
    console.log(`${model}: no Japanese rows`);
    continue;
  }
  const tally = { word: { same: [0, 0], other: [0, 0] }, bigram: { same: [0, 0], other: [0, 0] } };
  rows.forEach((row, i) => {
    const refWords = words(row.reference);
    const refBigrams = bigrams(row.reference);
    rows.forEach((other, j) => {
      const heardWords = words(other.hypothesis);
      const heardBigrams = new Set(bigrams(other.hypothesis));
      const slot = i === j ? "same" : "other";
      tally.word[slot][0] += refWords.filter((w) => foundWord(w, heardWords)).length;
      tally.word[slot][1] += refWords.length;
      tally.bigram[slot][0] += refBigrams.filter((b) => heardBigrams.has(b)).length;
      tally.bigram[slot][1] += refBigrams.length;
    });
  });
  console.log(`${model} (${rows.length} clips)`);
  console.log(`  Intl.Segmenter words   same clip ${pct(...tally.word.same)}   other clips ${pct(...tally.word.other)}`);
  console.log(`  character bigrams      same clip ${pct(...tally.bigram.same)}   other clips ${pct(...tally.bigram.other)}`);
}

// Speed: every Japanese reference of the first model, tokenised repeatedly.
try {
  const rows = JSON.parse(readFileSync(join(dir, `${models[0]}.wer.json`), "utf8")).langs.ja.rows;
  const texts = rows.map((r) => r.reference);
  const chars = texts.reduce((n, t) => n + t.length, 0);
  const passes = [];
  for (let p = 0; p < 7; p++) {
    const t0 = performance.now();
    for (let k = 0; k < 50; k++) for (const t of texts) tokenize(t);
    passes.push((performance.now() - t0) / 50 / (chars / 1000));
  }
  const timed = passes.slice(2); // the first two passes warm the JIT and the segmenter
  console.log(`tokenize(): ${chars} characters per pass, median ${median(timed).toFixed(3)} ms per 1000 characters, worst ${Math.max(...timed).toFixed(3)} (5 timed passes)`);
} catch (err) {
  console.log(`speed: not measured (${err.message})`);
}
