// What does a speech engine write for a spoken sentence? Feeds WAV files to Filow's own speech session
// (apps/desktop/stt.js, the "questions" catalogue dictation uses, the same worker and model as the app)
// and prints what it committed, as it is and after dictation's own text step (postProcess with the
// hesitation sounds taken out). The engine is chosen by giving a profile that holds only that model.
//
// usage: node tools/dictation/engine-output.cjs <profile dir> <wav dir> <samples.json> <out.json> [lang,lang]
// WAV: mono 16-bit PCM, any rate that is a multiple of 16 kHz or 22050 Hz (resampled by linear steps).
const fs = require("node:fs");
const path = require("node:path");
const [profile, wavDir, samplesFile, outFile, langsArg] = process.argv.slice(2);
const appDir = path.join(__dirname, "..", "..", "apps", "desktop");
const stt = require(path.join(appDir, "stt.js"));
const core = require(path.join(appDir, "dictation-core.js"));
const samples = JSON.parse(fs.readFileSync(samplesFile, "utf8")).filter((s) => !langsArg || langsArg.split(",").includes(s.lang));

function readWav(file) {
  const buf = fs.readFileSync(file);
  const fmtAt = buf.indexOf("fmt ", 12);
  const channels = buf.readUInt16LE(fmtAt + 10);
  const rate = buf.readUInt32LE(fmtAt + 12);
  const dataAt = buf.indexOf("data", fmtAt) + 8;
  const frames = Math.floor((buf.length - dataAt) / 2 / channels);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) pcm[i] = buf.readInt16LE(dataAt + i * 2 * channels) / 32768;
  if (rate === 16000) return pcm;
  const out = new Float32Array(Math.floor((frames * 16000) / rate));
  for (let i = 0; i < out.length; i++) {
    const x = (i * rate) / 16000;
    const a = Math.floor(x);
    out[i] = pcm[a] + (pcm[Math.min(frames - 1, a + 1)] - pcm[a]) * (x - a);
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const results = [];
  let lang = "auto";
  const use = stt.forUse("questions", () => lang);
  const session = new use.SttSession(profile, () => {});
  let committed = [];
  session.onResult = (r) => { if (r.committed) committed.push(r.committed); };
  session.onError = (m) => console.error("error:", m);
  for (const s of samples) {
    lang = s.lang;
    let info;
    try { info = await session.start(s.lang); } catch (e) { console.error(`${s.id}: ${e.message}`); continue; }
    committed = [];
    const pcm = readWav(path.join(wavDir, `${s.id}.wav`));
    // as the app does for a hold dictation: the sound, then 0.8 s of silence so the last word is finished
    const all = new Float32Array(pcm.length + 12800);
    all.set(pcm);
    for (let at = 0; at < all.length; at += 2048) { session.feed(all.slice(at, at + 2048)); await sleep(8); }
    await session.stop();
    await sleep(300);
    const raw = committed.join(" ").replace(/\s+/g, " ").trim();
    const typed = core.postProcess(raw, { language: s.lang, removeFillers: true });
    results.push({ id: s.id, lang: s.lang, model: info.model, streaming: info.streaming, phrases: committed.length, expected: s.text, raw, typed });
    console.log(`${s.id} [${info.model}] ${raw}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  process.exit(0);
})();
