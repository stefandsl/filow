#!/usr/bin/env node
// Measures local speech models for docs/stt/LANGUAGES.md: error rate per language, real-time factor
// with 2 and 4 threads, memory. Runs every model through the sherpa-onnx runtime Filow ships
// (sherpa-onnx-node), on CPU, on the FLEURS clips fetched by fetch-fleurs.sh.
//
//   node --experimental-strip-types tools/stt-bench/bench.mjs all <out-dir> [model ...]
//   node --experimental-strip-types tools/stt-bench/bench.mjs wer <model> <threads> <out.json> [lang,lang]
//   node --experimental-strip-types tools/stt-bench/bench.mjs rtf <model> <threads> <out.json>
//   node --experimental-strip-types tools/stt-bench/bench.mjs report <out-dir>
//
// Models are read from T8_MODELS (default G:/FILOW/tmp/t8-models, filled by fetch-models.sh) and
// clips from T8_AUDIO (default G:/FILOW/tmp/t8-audio). Each measurement runs in its own process so
// the peak memory is that model's alone. Nothing is written outside <out-dir>.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusErrorRate, errorRate } from "../../packages/stt/src/wer.ts";

const MODELS = process.env.T8_MODELS || "G:/FILOW/tmp/t8-models";
const AUDIO = process.env.T8_AUDIO || "G:/FILOW/tmp/t8-audio";
const FLEURS = { en: "en_us", it: "it_it", ru: "ru_ru", ro: "ro_ro", ja: "ja_jp" };
const LANGS = Object.keys(FLEURS);
const CLIPS_PER_LANG = 12;
const RTF_CLIPS = 4;
const RTF_PASSES = 5;
const MAX_CLIP_SECONDS = 25; // Whisper reads at most 30 s at a time; keep every model on the same clips.

const dirOf = (archive) => path.join(MODELS, archive, archive);
const pick = (dir, re) => {
  const name = fs.readdirSync(dir).find((n) => re.test(n));
  if (!name) throw new Error(`no file matching ${re} in ${dir}`);
  return path.join(dir, name);
};
const transducer = (d) => ({
  encoder: pick(d, /^encoder.*\.int8\.onnx$/),
  decoder: fs.readdirSync(d).some((n) => /^decoder.*\.int8\.onnx$/.test(n)) ? pick(d, /^decoder.*\.int8\.onnx$/) : pick(d, /^decoder.*\.onnx$/),
  joiner: pick(d, /^joiner.*\.int8\.onnx$/),
});
const whisper = (size) => ({
  kind: "offline",
  archive: `sherpa-onnx-whisper-${size}`,
  langs: LANGS,
  model: (d, lang) => ({
    whisper: { encoder: path.join(d, `${size}-encoder.int8.onnx`), decoder: path.join(d, `${size}-decoder.int8.onnx`), language: lang, task: "transcribe", tailPaddings: -1 },
    tokens: path.join(d, `${size}-tokens.txt`),
  }),
});

/** kind "online" = streaming (text while the person speaks); "offline" = one whole segment at a time. */
const TABLE = {
  nemotron: {
    kind: "online",
    archive: "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
    langs: LANGS,
    streamLanguage: true,
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt") }),
  },
  "nemotron-auto": {
    kind: "online",
    archive: "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
    langs: LANGS,
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt") }),
  },
  "zipformer-8lang": {
    kind: "online",
    archive: "sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10",
    langs: ["en", "ru", "ja"],
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt") }),
  },
  "vosk-small-ru": {
    kind: "online",
    archive: "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16",
    langs: ["ru"],
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt") }),
  },
  "t-one-ru": {
    kind: "online",
    archive: "sherpa-onnx-streaming-t-one-russian-2025-09-08",
    langs: ["ru"],
    model: (d) => ({ toneCtc: { model: path.join(d, "model.onnx") }, tokens: path.join(d, "tokens.txt") }),
  },
  "parakeet-v3": {
    kind: "offline",
    archive: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    langs: ["en", "it", "ru", "ro"],
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt"), modelType: "nemo_transducer" }),
  },
  "fastconformer-10lang": {
    kind: "offline",
    archive: "sherpa-onnx-nemo-fast-conformer-transducer-be-de-en-es-fr-hr-it-pl-ru-uk-20k-int8",
    langs: ["en", "it", "ru"],
    model: (d) => ({ transducer: transducer(d), tokens: path.join(d, "tokens.txt"), modelType: "nemo_transducer" }),
  },
  sensevoice: {
    kind: "offline",
    archive: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",
    langs: ["en", "ja"],
    model: (d, lang) => ({ senseVoice: { model: path.join(d, "model.int8.onnx"), language: lang, useInverseTextNormalization: 1 }, tokens: path.join(d, "tokens.txt") }),
  },
  // The 2025-09-09 asset above is a Cantonese fine-tune (ASLP-lab/WSYue-ASR); this is the original SenseVoice-small.
  "sensevoice-2024": {
    kind: "offline",
    archive: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
    langs: ["en", "ja"],
    model: (d, lang) => ({ senseVoice: { model: path.join(d, "model.int8.onnx"), language: lang, useInverseTextNormalization: 1 }, tokens: path.join(d, "tokens.txt") }),
  },
  "whisper-tiny": whisper("tiny"),
  "whisper-base": whisper("base"),
  "whisper-small": whisper("small"),
  omnilingual: {
    kind: "offline",
    archive: "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-v2-int8-2026-02-05",
    langs: LANGS,
    model: (d) => ({ omnilingual: { model: pick(d, /\.int8\.onnx$/) }, tokens: path.join(d, "tokens.txt") }),
  },
  dolphin: {
    kind: "offline",
    archive: "sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02",
    langs: ["ja", "ru"],
    model: (d) => ({ dolphin: { model: pick(d, /\.int8\.onnx$/) }, tokens: path.join(d, "tokens.txt") }),
  },
  "moonshine-base-ja": {
    kind: "offline",
    archive: "sherpa-onnx-moonshine-base-ja-quantized-2026-02-27",
    langs: ["ja"],
    model: (d) => ({ moonshine: { encoder: path.join(d, "encoder_model.ort"), mergedDecoder: path.join(d, "decoder_model_merged.ort") }, tokens: path.join(d, "tokens.txt") }),
  },
  "reazonspeech-ja": {
    kind: "offline",
    archive: "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01",
    langs: ["ja"],
    model: (d) => ({ transducer: transducer(d), tokens: pick(d, /^tokens.*\.txt$/) }),
  },
};

function clipsFor(lang, sherpa) {
  const dir = path.join(AUDIO, `fleurs-${FLEURS[lang]}`);
  const refs = new Map();
  for (const line of fs.readFileSync(path.join(dir, "dev.tsv"), "utf8").split("\n")) {
    const cols = line.split("\t");
    if (cols.length > 2) refs.set(cols[1], cols[2]); // file name -> transcription as written
  }
  const clips = [];
  for (const name of fs.readdirSync(path.join(dir, "dev")).filter((n) => n.endsWith(".wav")).sort()) {
    if (clips.length >= CLIPS_PER_LANG) break;
    if (!refs.has(name)) continue;
    const wave = sherpa.readWave(path.join(dir, "dev", name));
    const seconds = wave.samples.length / wave.sampleRate;
    if (seconds > MAX_CLIP_SECONDS) continue;
    clips.push({ file: name, seconds, reference: refs.get(name), samples: wave.samples, sampleRate: wave.sampleRate });
  }
  return clips;
}

/** Builds `transcribe(clip, lang) -> { text, ms }` for one model. Recognizers are kept per language setting. */
function engine(sherpa, key, threads) {
  const spec = TABLE[key];
  if (!spec) throw new Error(`unknown model ${key}; known: ${Object.keys(TABLE).join(", ")}`);
  const d = dirOf(spec.archive);
  const recognizers = new Map();
  let loadMs = 0;
  const recognizerFor = (lang) => {
    const modelConfig = { ...spec.model(d, lang), numThreads: threads, provider: "cpu", debug: 0 };
    const id = JSON.stringify(modelConfig);
    if (!recognizers.has(id)) {
      const t0 = performance.now();
      const config = { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig };
      recognizers.set(id, spec.kind === "online"
        // Same decoding and endpoint rules as apps/desktop/stt-worker.js.
        ? new sherpa.OnlineRecognizer({ ...config, decodingMethod: "greedy_search", enableEndpoint: 1, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20 })
        : new sherpa.OfflineRecognizer({ ...config, decodingMethod: "greedy_search" }));
      loadMs += performance.now() - t0;
    }
    return recognizers.get(id);
  };
  const transcribe = (clip, lang) => {
    const rec = recognizerFor(lang);
    const t0 = performance.now();
    let text;
    if (spec.kind === "online") {
      // Fed like the microphone feeds it: 100 ms at a time, segments closed by the endpoint detector.
      const stream = rec.createStream();
      if (spec.streamLanguage) stream.setOption("language", lang);
      const parts = [];
      const step = Math.round(clip.sampleRate / 10);
      const push = (samples) => {
        stream.acceptWaveform({ samples, sampleRate: clip.sampleRate });
        while (rec.isReady(stream)) rec.decode(stream);
        if (rec.isEndpoint(stream)) {
          parts.push(rec.getResult(stream).text || "");
          rec.reset(stream);
        }
      };
      for (let i = 0; i < clip.samples.length; i += step) push(clip.samples.slice(i, i + step));
      push(new Float32Array(Math.round(clip.sampleRate * 0.8)));
      stream.inputFinished();
      while (rec.isReady(stream)) rec.decode(stream);
      parts.push(rec.getResult(stream).text || "");
      text = parts.join(" ");
    } else {
      const stream = rec.createStream();
      stream.acceptWaveform({ samples: clip.samples, sampleRate: clip.sampleRate });
      rec.decode(stream);
      text = rec.getResult(stream).text || "";
    }
    return { text: text.replace(/\s+/g, " ").trim(), ms: performance.now() - t0 };
  };
  return { spec, transcribe, loadMs: () => Math.round(loadMs) };
}

const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const round = (x, digits = 3) => Number(x.toFixed(digits));

function runWer(key, threads, out, only) {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
  const e = engine(sherpa, key, threads);
  const result = { mode: "wer", model: key, kind: e.spec.kind, threads, langs: {} };
  for (const lang of e.spec.langs.filter((l) => !only || only.includes(l))) {
    const rows = clipsFor(lang, sherpa).map((clip) => {
      const { text, ms } = e.transcribe(clip, lang);
      const score = errorRate(clip.reference, text, lang);
      return { file: clip.file, seconds: round(clip.seconds, 2), ms: Math.round(ms), reference: clip.reference, hypothesis: text, errors: score.errors, units: score.units };
    });
    const pairs = rows.map((r) => ({ reference: r.reference, hypothesis: r.hypothesis }));
    const total = corpusErrorRate(pairs, lang);
    const folded = corpusErrorRate(pairs, lang, { foldDiacritics: true });
    result.langs[lang] = {
      unit: total.unit, clips: rows.length, units: total.units, errors: total.errors,
      rate: round(total.rate, 4), rateWithoutDiacritics: round(folded.rate, 4),
      substitutions: total.substitutions, deletions: total.deletions, insertions: total.insertions,
      rows,
    };
    console.log(`${key} ${lang} ${total.unit === "char" ? "CER" : "WER"} ${(total.rate * 100).toFixed(1)}% (${total.errors}/${total.units}, ${rows.length} clips)`);
  }
  result.loadMs = e.loadMs();
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
}

function runRtf(key, threads, out) {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
  const e = engine(sherpa, key, threads);
  const lang = e.spec.langs[0];
  const clips = clipsFor(lang, sherpa).slice(0, RTF_CLIPS);
  const seconds = clips.reduce((a, c) => a + c.seconds, 0);
  for (const clip of clips.slice(0, 1)) e.transcribe(clip, lang); // warm-up, not timed
  const passes = [];
  for (let p = 0; p < RTF_PASSES; p++) {
    let ms = 0;
    for (const clip of clips) ms += e.transcribe(clip, lang).ms;
    passes.push(round(ms / 1000 / seconds));
  }
  const result = { mode: "rtf", model: key, kind: e.spec.kind, threads, lang, clips: clips.length, audioSeconds: round(seconds, 1), passes, median: median(passes), worst: Math.max(...passes), loadMs: e.loadMs(), peakRssMb: peakRssMb() };
  console.log(`${key} ${threads} threads RTF median ${result.median} worst ${result.worst} peak ${result.peakRssMb} MB load ${result.loadMs} ms`);
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
}

function runAll(outDir, keys) {
  fs.mkdirSync(outDir, { recursive: true });
  const self = fileURLToPath(import.meta.url);
  const child = (args, out) => {
    if (fs.existsSync(out)) return;
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", self, ...args, out], { stdio: "inherit" });
    if (r.status !== 0) console.log(`FAILED ${args.join(" ")} (exit ${r.status})`);
  };
  for (const key of keys.length ? keys : Object.keys(TABLE)) {
    if (!fs.existsSync(dirOf(TABLE[key].archive))) { console.log(`skip ${key}: not downloaded`); continue; }
    child(["wer", key, "4"], path.join(outDir, `${key}.wer.json`));
    child(["rtf", key, "2"], path.join(outDir, `${key}.rtf2.json`));
    child(["rtf", key, "4"], path.join(outDir, `${key}.rtf4.json`));
  }
}

function report(outDir) {
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(outDir, name), "utf8")); } catch { return null; } };
  const sizes = new Map();
  try {
    for (const line of fs.readFileSync(path.join(MODELS, "models.tsv"), "utf8").split("\n")) {
      const [asset, size] = line.split("\t");
      if (asset) sizes.set(asset.replace(/\.tar\.bz2$/, ""), Number(size));
    }
  } catch { /* sizes stay empty */ }
  console.log("| model | mode | size MB | " + LANGS.map((l) => `${l} ${l === "ja" ? "CER" : "WER"} %`).join(" | ") + " | RTF 2 threads (median / worst) | RTF 4 threads (median / worst) | peak RAM MB | load s |");
  console.log("|---|---|---|" + LANGS.map(() => "---").join("|") + "|---|---|---|---|");
  for (const key of Object.keys(TABLE)) {
    const wer = read(`${key}.wer.json`);
    if (!wer) continue;
    const r2 = read(`${key}.rtf2.json`);
    const r4 = read(`${key}.rtf4.json`);
    const size = sizes.get(TABLE[key].archive);
    const rates = LANGS.map((l) => (wer.langs[l] ? (wer.langs[l].rate * 100).toFixed(1) : "-"));
    const rtf = (r) => (r ? `${r.median.toFixed(2)} / ${r.worst.toFixed(2)}` : "-");
    console.log(`| ${key} | ${wer.kind === "online" ? "streaming" : "whole segment"} | ${size ? Math.round(size / 1e6) : "?"} | ${rates.join(" | ")} | ${rtf(r2)} | ${rtf(r4)} | ${r2 ? r2.peakRssMb : "-"} | ${r2 ? (r2.loadMs / 1000).toFixed(1) : "-"} |`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "wer") runWer(rest[0], Number(rest[1]), rest[2], rest[3] ? rest[3].split(",") : null);
else if (mode === "rtf") runRtf(rest[0], Number(rest[1]), rest[2]);
else if (mode === "all") runAll(rest[0], rest.slice(1));
else if (mode === "report") report(rest[0]);
else {
  console.error("usage: bench.mjs all <out-dir> [model ...] | wer <model> <threads> <out.json> [langs] | rtf <model> <threads> <out.json> | report <out-dir>");
  process.exit(2);
}
