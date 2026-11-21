// node phrase-eval.cjs MODELS CLIPS SPEECH OUT [minutes] [lang] [offset] [ok|bare|prefix]
// Frozen replay takes the manifest SHA-256 after the variant. For legacy OK
// enrolment append the origin/main checkout and the separate OK take directory.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [models, clips, speech, out, minutes = 6, language, offset = 0, variant, manifestHash, legacyRoot, legacyTakes] = process.argv.slice(2);
const legacy = Boolean(legacyRoot);
if (legacy && (variant !== "ok" || speech !== "frozen" || !legacyTakes)) throw new Error("Legacy replay needs frozen, ok, a source checkout and separate OK takes");
const desktop = path.resolve(legacyRoot || path.join(__dirname, "../.."), "apps/desktop");
const policy = require(path.join(desktop, "wake-policy"));
const { createEmbedding, createStream, enrol, background } = require(path.join(desktop, "wake-head"));
const { replayEnrolment, canEnable, prefixFallback } = require(path.join(desktop, "wake-enrolment"));
const { readSample } = require(path.join(desktop, legacy ? "wake" : "wake-pcm"));
const modes = ["strict", "balanced", "sensitive"];
const data = path.join(desktop, "wake-data");

function corpus(lang, bare) {
  const read = file => readSample(path.join(clips, lang, file));
  if (speech === "frozen") {
    if (!bare && !legacy) throw new Error("The frozen corpus enrols the bare phrase");
    const manifest = fs.readFileSync(path.join(clips, "manifest.json"));
    if (crypto.createHash("sha256").update(manifest).digest("hex") !== manifestHash) throw new Error("Frozen manifest digest mismatch");
    const rows = JSON.parse(manifest)[lang];
    for (const row of rows) {
      const bytes = fs.readFileSync(path.join(clips, lang, row.file));
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("Changed frozen file: " + row.file);
    }
    const enrolRows = rows.filter(r => r.kind === "enrol");
    const legacyRows = legacy && JSON.parse(fs.readFileSync(path.join(legacyTakes, "manifest.json")))[lang];
    const recordings = enrolRows.map(r => {
      if (!legacy) return read(r.file);
      const dir = path.join(legacyTakes, lang);
      const receipt = legacyRows.find(t => t.file === r.file);
      const file = path.join(dir, r.file);
      if (receipt?.kind !== "enrol" || receipt.sid !== r.sid || receipt.speed !== r.speed ||
          receipt.text !== rows.find(t => t.kind === "ok").text ||
          crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== receipt.sha256) throw new Error("Invalid legacy enrolment take");
      return readSample(file);
    });
    return { recordings,
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
  const { createSpotter } = require(path.join(desktop, "wake-worker"));
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
          const keywords = legacy
            ? policy.SPELLINGS.map((s, i) => `${s} :2.5 #0.05 @v${i + 1}`).join("\n") + "\n"
            : policy.keywordText(settings);
          fs.writeFileSync(file, keywords);
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
        const prefixSpotter = fallbackModes.length ? spotter({ ...profile, requirePrefix: true, separatePrefix: true }) : null;
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
          const combiners = modes.map(m => legacy ? policy.createCombiner(profile.thresholds, m) : policy.profileCombiner({ ...profile, requirePrefix: profile.requirePrefix || fallbackModes.includes(m) }, m));
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
