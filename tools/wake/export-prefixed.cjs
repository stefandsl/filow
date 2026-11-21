// Export end-aligned examples from phrase-clips.py --training-calls.
// Speakers 8 and 9 are reserved for training. Never pass the evaluation directory.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createEmbedding, speechEnd, FEATURES, WIDTH } = require("../../apps/desktop/wake-head");
const { readSample } = require("../../apps/desktop/wake-pcm");
const [models, clips, original, dest] = process.argv.slice(2);
async function run() {
  const embedding = await createEmbedding(models);
  const chunks = [];
  try {
    for (const lang of ["en", "it", "ru", "ro", "ja"]) {
      const examples = ["ok", "hey"].flatMap(kind => [0, 1, 2, 3].map(i => path.join(clips, lang, kind + "-" + i + ".wav")));
      for (const sid of [8, 9]) {
        for (const speed of [85, 100, 114]) {
          for (const spelling of [0, 1]) {
            examples.push(path.join(original, "pos", `supertonic_v${sid}_${lang}_pos${spelling}_s${speed}.wav`));
          }
        }
      }
      for (const file of examples) {
        const pcm = readSample(file);
        const padded = new Float32Array(16000 + pcm.length + 9600);
        padded.set(pcm, 16000);
        const vectors = await embedding.embed(padded);
        for (const tail of [.08, .16, .24, .32]) {
          const end = (1 + Math.ceil(((1 + speechEnd(pcm) / 16000 + tail - .015) / .01 - 76) / 8)) * WIDTH;
          if (end < FEATURES || end > vectors.length) continue;
          const window = vectors.subarray(end - FEATURES, end);
          chunks.push(Buffer.from(Int8Array.from(window, v => Math.round(127 * v)).buffer));
        }
      }
    }
    const data = Buffer.concat(chunks);
    fs.writeFileSync(path.join(dest, "prefixed.bin"), data);
    fs.writeFileSync(path.join(dest, "prefixed.json"), JSON.stringify({
      windows: chunks.length, scale: 127, sha256: crypto.createHash("sha256").update(data).digest("hex"),
    }, null, 2) + "\n");
  } finally { await embedding.dispose(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
