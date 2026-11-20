// Usage: node tools/wake/phrase-eval.cjs MODEL CLIPS BACKGROUND_DIR OUTPUT_DIR [minutes per language] [language] [start minute]
const fs = require("node:fs");
const path = require("node:path");
const { keywordText, createCombiner } = require("../../apps/desktop/wake-policy");
const { createEmbedding, createStream, enrol, background } = require("../../apps/desktop/wake-head");
const { replayEnrolment, canEnable } = require("../../apps/desktop/wake-enrolment");
const { readSample } = require("../../apps/desktop/wake");
const [models, clips, speech, out, minutes = 6, language, offset = 0] = process.argv.slice(2);
const modes = ["strict", "balanced", "sensitive"];

async function run() {
  fs.mkdirSync(out, {recursive: true});
  const embedding = await createEmbedding(models);
  const { createSpotter } = require("../../apps/desktop/wake-worker");
  const data = path.resolve(__dirname, "../../apps/desktop/wake-data");
  const rows = [];
  try {
    for (const lang of language ? [language] : ["en", "it", "ro", "ru", "ja"]) {
      const clip = (name, i) => readSample(path.join(clips, lang, `${name}-${i}.wav`));
      // Common Voice files exported by prepare-qa.py (16 kHz mono PCM).
      const normal = readSample(path.join(speech, `background-${lang}.wav`)).subarray(Number(offset)*60*16000, (Number(offset)+Number(minutes))*60*16000);
      for (const phrase of ["ok", "bare"]) {
        const recordings = Array.from({length:5}, (_, i) => clip(phrase, i));
        const profile = await enrol(embedding, recordings, background(data, phrase === "bare"));
        if (phrase === "bare") profile.phrase = "Filow";
        const file = path.join(out, `keywords-${phrase}.txt`);
        fs.writeFileSync(file, keywordText(profile));
        const kws = createSpotter(models, file);
        const head = createStream(embedding, profile);
        const detector = {
          reset() { kws.reset(); head.reset(); },
          async feed(samples, at) { return {...kws.feed({samples, at}), score: await head.feed(samples)}; },
        };
        const verification = await replayEnrolment(detector, profile, recordings);
        fs.writeFileSync(path.join(out, `profile-${lang}-${phrase}.json`), JSON.stringify({...profile, verification}));
        const counts = Object.fromEntries(modes.map(m => [m, {enabled: canEnable(verification,m), bare:0, ok:0, hey:0, near:0, normal:0}]));
        async function replay(pcm, kind) {
          detector.reset();
          const combiners = modes.map(m => createCombiner(profile.thresholds, m));
          const audio = kind === "normal" ? pcm : new Float32Array(32000 + pcm.length);
          if (kind !== "normal") audio.set(pcm, 16000);
          const hits = new Set();
          for (let i = 0; i < audio.length; i += 1600) {
            const samples = new Float32Array(1600);
            samples.set(audio.subarray(i,i+1600));
            const event = await detector.feed(samples,(i+1600)/16);
            for (const [j,m] of modes.entries()) if (combiners[j].push(event)) {
              if (kind === "normal" || !hits.has(m)) counts[m][kind]++;
              hits.add(m);
            }
          }
        }
        for (const name of ["ok","bare"]) for (let i=5;i<8;i++) await replay(clip(name,i),name);
        await replay(clip("hey",0),"hey");
        for (let i=0;i<4;i++) await replay(clip(`near${i}`,0),"near");
        await replay(normal, "normal");
        rows.push({lang, phrase, seconds:normal.length/16000, counts});
        fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(rows,null,2));
        console.log(lang, phrase, counts);
      }
    }
  } finally { await embedding.dispose(); }
}
run().catch(e=>{console.error(e);process.exitCode=1});
