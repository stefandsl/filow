// node phrase-eval.cjs MODELS CLIPS SPEECH OUT [minutes] [lang] [offset] [ok|bare|prefix]
// With SPEECH set to "frozen", append the frozen manifest SHA-256 after the variant.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { keywordText, profileCombiner } = require("../../apps/desktop/wake-policy");
const { createEmbedding, createStream, enrol, background } = require("../../apps/desktop/wake-head");
const { replayEnrolment, canEnable, prefixFallback } = require("../../apps/desktop/wake-enrolment");
const { readSample } = require("../../apps/desktop/wake-pcm");
const [models, clips, speech, out, minutes = 6, language, offset = 0, variant, manifestHash] = process.argv.slice(2);
const modes = ["strict", "balanced", "sensitive"];
const data = path.resolve(__dirname, "../../apps/desktop/wake-data");

function corpus(lang, bare) {
  const read = file => readSample(path.join(clips, lang, file));
  if (speech === "frozen") {
    if (!bare) throw new Error("The frozen corpus enrols the bare phrase");
    const manifest = fs.readFileSync(path.join(clips, "manifest.json"));
    if (crypto.createHash("sha256").update(manifest).digest("hex") !== manifestHash) throw new Error("Frozen manifest digest mismatch");
    const rows = JSON.parse(manifest)[lang];
    for (const row of rows) {
      const bytes = fs.readFileSync(path.join(clips, lang, row.file));
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("Changed frozen file: " + row.file);
    }
    return { recordings: rows.filter(r => r.kind === "enrol").map(r => read(r.file)),
      tests: rows.filter(r => r.kind !== "enrol").map(r => ({ kind: r.kind, file: r.file, load: () => read(r.file) })) };
  }
  const names = ["bare", "ok"].flatMap(kind => [5, 6, 7].map(i => [kind, `${kind}-${i}.wav`]));
  names.push(["hey", "hey-0.wav"], ...[0, 1, 2, 3].map(i => ["near", `near${i}-0.wav`]));
  const tests = names.map(([kind, file]) => ({ kind, file, load: () => read(file) }));
  if (Number(minutes) > 0) tests.push({ kind: "normal", file: `background-${lang}.wav`,
    load: () => readSample(path.join(speech, `background-${lang}.wav`)).subarray(Number(offset) * 960000, (Number(offset) + Number(minutes)) * 960000) });
  return { recordings: Array.from({ length: 5 }, (_, i) => read(`${bare ? "bare" : "ok"}-${i}.wav`)), tests };
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  const embedding = await createEmbedding(models);
  const { createSpotter } = require("../../apps/desktop/wake-worker");
  const rows = [];
  try {
    for (const lang of language ? [language] : ["en", "it", "ro", "ru", "ja"]) {
      for (const phrase of variant ? [variant] : ["ok", "bare"]) {
        if (!["ok", "bare", "prefix"].includes(phrase)) throw new Error("Unknown profile variant");
        const bare = phrase !== "ok";
        const { recordings, tests } = corpus(lang, bare);
        const profile = await enrol(embedding, recordings, background(data, bare));
        if (bare) profile.phrase = "Filow";
        const file = path.join(out, `keywords-${lang}-${phrase}.txt`);
        const spotter = (settings = profile) => {
          fs.writeFileSync(file, keywordText(settings));
          return createSpotter(models, file);
        };
        let kws = spotter();
        const head = createStream(embedding, profile);
        const detector = {
          reset() { kws.reset(); head.reset(); },
          async feed(samples, at) { return { ...kws.feed({ samples, at }), score: await head.feed(samples) }; },
        };
        const verification = await replayEnrolment(detector, profile, recordings);
        fs.writeFileSync(path.join(out, `profile-${lang}-${phrase}.json`), JSON.stringify({ ...profile, verification }));
        if (phrase === "prefix") {
          profile.requirePrefix = true;
          kws = spotter();
        }
        profile.verification = verification;
        const fallbackModes = modes.filter(m => phrase === "bare" && prefixFallback(profile, m));
        const prefixSpotter = fallbackModes.length ? spotter({ ...profile, requirePrefix: true }) : null;
        const counts = Object.fromEntries(modes.map(m => [m, { enabled: canEnable(verification, m) || fallbackModes.includes(m), prefixFallback: fallbackModes.includes(m), bare: 0, ok: 0, hey: 0, near: 0, normal: 0 }]));
        const totals = { bare: 0, ok: 0, hey: 0, near: 0 };
        let seconds = 0;
        for (const test of tests) {
          const pcm = test.load();
          const normal = test.kind === "normal";
          if (normal) seconds += pcm.length / 16000;
          else totals[test.kind]++;
          const audio = normal ? pcm : new Float32Array(32000 + pcm.length);
          if (!normal) audio.set(pcm, 16000);
          detector.reset();
          prefixSpotter?.reset();
          const combiners = modes.map(m => profileCombiner({ ...profile, requirePrefix: profile.requirePrefix || fallbackModes.includes(m) }, m));
          const fired = new Set();
          for (let i = 0; i < audio.length; i += 1600) {
            const samples = new Float32Array(1600);
            samples.set(audio.subarray(i, i + 1600));
            const event = await detector.feed(samples, (i + 1600) / 16);
            const prefixEvent = prefixSpotter && { ...event, ...prefixSpotter.feed({ samples, at: event.at }) };
            for (const [j, mode] of modes.entries()) {
              if (combiners[j].push(fallbackModes.includes(mode) ? prefixEvent : event) && (normal || !fired.has(mode))) {
                counts[mode][test.kind]++;
                fired.add(mode);
              }
            }
          }
        }
        rows.push({ lang, phrase, seconds, counts, totals });
        fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(rows, null, 2));
        console.log(lang, phrase, counts);
      }
    }
  } finally { await embedding.dispose(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
