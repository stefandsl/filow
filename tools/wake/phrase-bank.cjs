// Convert phrase-clips.py --training-bank output into enrolment inputs. Local synthetic voices only.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {readSample, wav} = require("../../apps/desktop/wake");
const {createEmbedding, speechEnd, FEATURES, WIDTH} = require("../../apps/desktop/wake-head");
const [model, clips, dest] = process.argv.slice(2);
async function run() {
  const embedding = await createEmbedding(model);
  const windows = [];
  try {
    for (const lang of ["en","it","ro","ru","ja"]) {
      for (const name of ["ok","hey","near0","near1","near2","near3"]) {
        const samples = readSample(path.join(clips,lang,`${name}-0.wav`));
        if (name === "ok" || name === "hey") {
          fs.writeFileSync(path.join(dest,`prefix-${lang}-${name}.wav`), wav(samples.subarray(0,speechEnd(samples))));
          continue;
        }
        const padded = new Float32Array(16000 + samples.length + 9600);
        padded.set(samples,16000);
        const vectors = await embedding.embed(padded);
        for(let i=0;i+FEATURES<=vectors.length;i+=2*WIDTH) {
          const window = vectors.slice(i,i+FEATURES);
          windows.push(Buffer.from(window.buffer));
        }
      }
    }
    const bytes = Buffer.concat(windows);
    fs.writeFileSync(path.join(dest,"phrase-negatives.bin"), bytes);
    fs.writeFileSync(path.join(dest,"phrase-negatives.json"),JSON.stringify({
      windows: windows.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    },null,2)+"\n");
  } finally { await embedding.dispose(); }
}
run().catch(e=>{console.error(e);process.exitCode=1});
