// Speech-to-text on this PC, run by sherpa-onnx-node in a worker thread. This file owns the model
// catalogue (which model serves which spoken language, measured in docs/stt/LANGUAGES.md), the
// choice of model for a language, a use and a machine, the model downloads and the worker;
// main.js wires the IPC. Every model is fetched from the sherpa-onnx release page, only after the
// user asked for it, and must match its pinned SHA-256 before it is unpacked.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { retryDownload } = require("./stt-download");
const { download } = require("./download");
const { sha256File } = require("./integrity");

/** Spoken languages Filow is measured on; "auto" lets the model decide. */
const LANGUAGES = ["en", "it", "ru", "ro", "ja"];
const LANGUAGE_NAMES = { en: "English", it: "Italian", ru: "Russian", ro: "Romanian", ja: "Japanese" };
const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";

// The streaming model every install starts with. `kind` "online" models write text while the
// speaker talks; "offline" models transcribe one phrase at a time, cut by the voice detector.
const MODEL = {
  key: "nemotron",
  id: "nemotron-3.5-asr-streaming-0.6b",
  label: "Nemotron 3.5 streaming",
  archive: "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
  url: `${RELEASE}/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2`,
  sizeBytes: 475271763,
  // Pinned 2026-11-09; matches the digest GitHub publishes for this release asset (STANDARDS SEC-15).
  sha256: "c6bf5e0df765f9d5b43bc9e0536d4b4b3e7d40bdf5ecf13e45f134c51c05ae3a",
  files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
  kind: "online",
  family: "transducer",
  languages: LANGUAGES,
  // The language is a per-stream option of this model; without it the model detects the language.
  streamLanguage: true,
  licence: "OpenMDW-1.1",
};

// `files` lists what the recognizer loads (transducers: encoder, decoder, joiner; the token table
// last). `prune` deletes everything else the archive carries (test audio, unquantised copies).
// The hashes below were pinned 2026-11-10 from the downloaded release assets.
const CATALOGUE = {
  nemotron: MODEL,
  "parakeet-v3": {
    key: "parakeet-v3",
    id: "parakeet-tdt-0.6b-v3",
    label: "Parakeet TDT 0.6b v3",
    archive: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    url: `${RELEASE}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    sizeBytes: 487211443,
    sha256: "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9",
    files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    kind: "offline",
    family: "nemo-transducer",
    languages: ["en", "it", "ru", "ro"],
    licence: "CC-BY-4.0",
    prune: true,
  },
  "vosk-small-ru": {
    key: "vosk-small-ru",
    id: "vosk-small-ru-streaming",
    label: "Vosk small Russian streaming",
    archive: "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16",
    url: `${RELEASE}/sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2`,
    sizeBytes: 24110855,
    sha256: "6ba68a01ff3c5445aaf2d61e9b97b026f1149dcc9049d11af3f44f55176341d8",
    files: ["encoder.int8.onnx", "decoder.onnx", "joiner.int8.onnx", "tokens.txt"],
    kind: "online",
    family: "transducer",
    languages: ["ru"],
    licence: "Apache-2.0",
    prune: true,
  },
  "reazonspeech-ja": {
    key: "reazonspeech-ja",
    id: "reazonspeech-ja-zipformer",
    label: "ReazonSpeech Japanese",
    archive: "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01",
    url: `${RELEASE}/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01.tar.bz2`,
    sizeBytes: 713097333,
    sha256: "e0981d0d5d7b446d41010831b59091ebf57d2aa7b79980f67ca37af460b5842d",
    files: ["encoder-epoch-99-avg-1.int8.onnx", "decoder-epoch-99-avg-1.int8.onnx", "joiner-epoch-99-avg-1.int8.onnx", "tokens.txt"],
    kind: "offline",
    family: "transducer",
    languages: ["ja"],
    licence: "Apache-2.0",
    prune: true,
  },
  dolphin: {
    key: "dolphin",
    id: "dolphin-base-ctc",
    label: "Dolphin base",
    archive: "sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02",
    url: `${RELEASE}/sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02.tar.bz2`,
    sizeBytes: 80671385,
    sha256: "6f23da2303c3c2e5fa6445c450fa2a7133cd57e3da070ae5f97ab9e0dfbb4a54",
    files: ["model.int8.onnx", "tokens.txt"],
    kind: "offline",
    family: "dolphin",
    languages: ["ja"],
    licence: "Apache-2.0",
    prune: true,
  },
  // Voice detector that cuts the microphone into phrases for the offline models. A bare file, not an archive.
  "silero-vad": {
    key: "silero-vad",
    id: "silero-vad",
    label: "Silero voice detector",
    archive: "silero_vad.onnx",
    url: `${RELEASE}/silero_vad.onnx`,
    sizeBytes: 643854,
    sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
    files: ["silero_vad.onnx"],
    kind: "vad",
    family: "vad",
    languages: [],
    licence: "MIT",
    bare: true,
  },
};
const VAD = CATALOGUE["silero-vad"];

// Which model to use, best first, per use ("tracking": following a talk as it is spoken;
// "questions": one short utterance), machine tier and language. The order comes from the error
// rates and speeds in docs/stt/LANGUAGES.md. Later entries are fallbacks for when the first is
// not downloaded: Filow says so instead of failing.
const CANDIDATES = {
  tracking: {
    standard: {
      auto: ["nemotron", "parakeet-v3"],
      en: ["nemotron", "parakeet-v3"],
      it: ["nemotron", "parakeet-v3"],
      ru: ["nemotron", "vosk-small-ru", "parakeet-v3"],
      // No streaming model is accurate enough for Romanian (3 words in 10 wrong): phrase by phrase.
      ro: ["parakeet-v3", "nemotron"],
      ja: ["nemotron", "dolphin", "reazonspeech-ja"],
    },
    light: {
      auto: ["nemotron", "parakeet-v3"],
      en: ["nemotron", "parakeet-v3"],
      it: ["nemotron", "parakeet-v3"],
      ru: ["vosk-small-ru", "nemotron", "parakeet-v3"],
      ro: ["parakeet-v3", "nemotron"],
      ja: ["dolphin", "nemotron", "reazonspeech-ja"],
    },
  },
  questions: {
    standard: {
      auto: ["nemotron", "parakeet-v3"],
      en: ["parakeet-v3", "nemotron"],
      it: ["parakeet-v3", "nemotron"],
      ru: ["parakeet-v3", "vosk-small-ru", "nemotron"],
      ro: ["parakeet-v3", "nemotron"],
      ja: ["reazonspeech-ja", "dolphin", "nemotron"],
    },
    light: {
      auto: ["nemotron", "parakeet-v3"],
      en: ["nemotron", "parakeet-v3"],
      it: ["nemotron", "parakeet-v3"],
      ru: ["vosk-small-ru", "nemotron", "parakeet-v3"],
      ro: ["parakeet-v3", "nemotron"],
      ja: ["dolphin", "nemotron", "reazonspeech-ja"],
    },
  },
};

/** "ja-JP" is "ja"; anything Filow has no model choice for is "auto". */
function normaliseLanguage(language) {
  const code = typeof language === "string" ? language.trim().toLowerCase().slice(0, 2) : "";
  return LANGUAGES.includes(code) ? code : "auto";
}

/** "light" for a PC with under 6 GB of memory or at most 4 logical processors; unknown hardware is "standard". */
function tierFor({ ramGb, cores } = {}) {
  return (Number.isFinite(ramGb) && ramGb < 6) || (Number.isFinite(cores) && cores <= 4) ? "light" : "standard";
}

/** The given hardware, or this PC's where a value is missing. */
function hardwareOf(hardware) {
  return {
    ramGb: Number.isFinite(hardware?.ramGb) ? hardware.ramGb : os.totalmem() / 2 ** 30,
    cores: Number.isFinite(hardware?.cores) ? hardware.cores : os.cpus().length,
  };
}

/**
 * Pure: the models to use, best first, for a spoken language, a use and a machine (memory in GB,
 * logical processors). The first entry is the one Filow offers to download.
 */
function chooseModels({ language = "auto", use = "tracking", ramGb, cores } = {}) {
  const lang = normaliseLanguage(language);
  const purpose = use === "questions" ? "questions" : "tracking";
  const tier = tierFor({ ramGb, cores });
  return { tier, language: lang, use: purpose, models: [...CANDIDATES[purpose][tier][lang]] };
}

/**
 * Pure: which of the chosen models to run given the ones on disk. `notes` says what the user should
 * be told: "fallback" (the best model is not downloaded, a less suitable one is used) and "phrases"
 * (a talk is followed phrase by phrase, not word by word, because the model is not a streaming one).
 */
function pickInstalled(choice, installed) {
  const wanted = choice.models[0];
  const model = choice.models.find((k) => installed.includes(k)) ?? null;
  const streaming = model ? CATALOGUE[model].kind === "online" : false;
  const notes = [];
  if (model && model !== wanted) notes.push("fallback");
  if (model && !streaming && choice.use === "tracking") notes.push("phrases");
  return { model, wanted, streaming, notes };
}

/** Rejects a download whose bytes are not the pinned archive (corrupt, truncated or swapped). */
async function verifyArchive(file, expected = MODEL.sha256) {
  const got = await sha256File(file);
  if (got !== expected) throw new Error(`downloaded model failed its integrity check (sha256 ${got.slice(0, 12)}..., expected ${expected.slice(0, 12)}...)`);
}

function modelDir(userData, spec = MODEL) {
  return path.join(userData, "models", spec.id);
}

function specInstalled(userData, spec) {
  const dir = modelDir(userData, spec);
  return spec.files.every((f) => fs.existsSync(path.join(dir, f)));
}

/** Keys of the speech models that can run now: an offline model also needs the voice detector. */
function installedKeys(userData) {
  const vad = specInstalled(userData, VAD);
  return Object.values(CATALOGUE)
    .filter((s) => s.kind !== "vad" && (s.kind === "online" || vad) && specInstalled(userData, s))
    .map((s) => s.key);
}

/** Everything a model needs on disk: itself, plus the voice detector for an offline model. */
function requiredSpecs(key) {
  const spec = CATALOGUE[key];
  if (!spec || spec.kind === "vad") return [];
  return spec.kind === "offline" ? [VAD, spec] : [spec];
}

/** True when some model can listen for this language and use (default: any language, following a talk). */
function modelReady(userData, opts = {}) {
  const choice = chooseModels({ language: opts.language, use: opts.use, ...hardwareOf(opts.hardware) });
  return Boolean(pickInstalled(choice, installedKeys(userData)).model);
}

/** Windows ships bsdtar as tar.exe (bzip2 built in); macOS and Linux have tar with -j. Runs as a child process: a 475 MB bzip2 takes tens of seconds and must not block the app. */
function extract(archive, into) {
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  return new Promise((resolve, reject) => {
    execFile(tar, ["-xjf", archive, "-C", into], { timeout: 15 * 60_000, windowsHide: true, maxBuffer: 1 << 20 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** The download while it is incomplete; it survives failures and restarts so the next try resumes it. */
function partFile(userData, spec = MODEL) {
  return path.join(userData, "models", spec.bare ? `${spec.archive}.part` : `${spec.archive}.tar.bz2.part`);
}

/** How much of the archive is already on disk (0-99), for a "Resume download" label. */
function partialPct(userData, spec = MODEL) {
  try {
    const n = fs.statSync(partFile(userData, spec)).size;
    return n > 0 ? Math.min(99, Math.floor((n / spec.sizeBytes) * 100)) : 0;
  } catch { return 0; }
}

/** Puts a verified bare file (not an archive) in its model folder. */
function installBare(part, dir, spec) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(part, path.join(dir, spec.files[0]));
}

/**
 * Downloads and unpacks one model into userData/models; onStatus gets {state, pct}. `spec` is a
 * catalogue entry (MODEL by default; a fixture in tests). The download resumes from the .part file;
 * the finished file must match the pinned SHA-256 before it is unpacked, and a mismatch deletes it
 * so the next try starts clean.
 */
async function ensureModel(userData, onStatus, spec = MODEL) {
  const dir = modelDir(userData, spec);
  if (specInstalled(userData, spec)) return onStatus({ state: "ready", pct: 100 });
  const models = path.join(userData, "models");
  const part = partFile(userData, spec);
  try {
    fs.mkdirSync(models, { recursive: true });
    // Up to 0.9.30 the archive downloaded under its final name and a failed run left it half written.
    // Its bytes are a prefix of the same file, so it becomes the part to resume.
    const legacy = path.join(models, `${spec.archive}.tar.bz2`);
    if (!spec.bare && fs.existsSync(legacy)) {
      if (fs.existsSync(part)) fs.rmSync(legacy, { force: true });
      else fs.renameSync(legacy, part);
    }
    await retryDownload(async () => {
      if (fs.existsSync(part) && fs.statSync(part).size > spec.sizeBytes) fs.rmSync(part, { force: true });
      if (!(fs.existsSync(part) && fs.statSync(part).size === spec.sizeBytes)) {
        // Resumes the part on disk; the pinned hash below makes a bad resume cost one fresh download, never a corrupt model.
        await download(spec.url, part, { onPct: (pct) => onStatus({ state: "downloading", pct }), fallbackSize: spec.sizeBytes, resume: true });
      }
      onStatus({ state: "extracting", pct: 99 });
      try { await verifyArchive(part, spec.sha256); }
      catch (err) { fs.rmSync(part, { force: true }); throw err; }
      if (spec.bare) return installBare(part, dir, spec);
      const extracted = path.join(models, spec.archive);
      // A failed extraction must not contribute stale files to a later attempt.
      fs.rmSync(extracted, { recursive: true, force: true });
      try {
        await extract(part, models);
        if (!spec.files.every((f) => fs.existsSync(path.join(extracted, f)))) throw new Error("archive did not contain the expected files");
        // Test audio and unquantised copies of the model are never loaded: they only take disk space.
        if (spec.prune) for (const entry of fs.readdirSync(extracted)) if (!spec.files.includes(entry)) fs.rmSync(path.join(extracted, entry), { recursive: true, force: true });
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(extracted, dir);
      } catch (err) {
        fs.rmSync(extracted, { recursive: true, force: true });
        throw err;
      }
      fs.rmSync(part, { force: true });
    }, attempt => onStatus({ state: "downloading", pct: partialPct(userData, spec), message: `download attempt ${attempt}/4` }),
    (attempt, delay, err) => onStatus({ state: "downloading", pct: partialPct(userData, spec), message: `attempt ${attempt} failed: ${err.message}; retry in ${delay / 1000} s` }));
    onStatus({ state: "ready", pct: 100 });
  } catch (err) {
    // The part stays (unless it failed its hash, which deleted it): the next try resumes it.
    onStatus({ state: "error", pct: partialPct(userData, spec), error: String((err && err.message) || err) });
  }
}

/**
 * Downloads the given catalogue entries one after the other, skipping those already on disk.
 * onStatus gets one overall percentage weighted by size, the entry being fetched in `model`, and a
 * single {state: "ready"} at the end; the first failure stops the run with {state: "error"}.
 */
async function ensureAll(userData, specs, onStatus) {
  const missing = specs.filter((s) => !specInstalled(userData, s));
  const total = missing.reduce((n, s) => n + s.sizeBytes, 0) || 1;
  let done = 0;
  for (const spec of missing) {
    let failed = false;
    await ensureModel(userData, (s) => {
      if (s.state === "ready") return;
      if (s.state === "error") failed = true;
      const pct = Math.min(99, Math.floor(((done + (spec.sizeBytes * s.pct) / 100) / total) * 100));
      onStatus({ ...s, pct, model: spec.key ?? spec.id });
    }, spec);
    if (failed) return;
    done += spec.sizeBytes;
  }
  onStatus({ state: "ready", pct: 100 });
}

/** Removes every speech model and every unfinished download. */
function removeModel(userData) {
  for (const spec of Object.values(CATALOGUE)) {
    fs.rmSync(modelDir(userData, spec), { recursive: true, force: true });
    fs.rmSync(partFile(userData, spec), { force: true });
  }
}

/**
 * What the settings page and the prompter need to know for the chosen spoken language. `model` keeps
 * its old meaning for the model Filow wants for following a talk ("ready", "missing", or the state of
 * its download); `usable` is true when any model can listen right now, with `notes` saying what the
 * user gives up ("fallback", "phrases"). `job` is the download in flight: {key, state, pct, error}.
 */
function speechStatus(userData, { language = "auto", hardware, job } = {}) {
  const lang = normaliseLanguage(language);
  const installed = installedKeys(userData);
  const view = (use) => {
    const choice = chooseModels({ language: lang, use, ...hardwareOf(hardware) });
    const pick = pickInstalled(choice, installed);
    const missing = requiredSpecs(pick.wanted).filter((s) => !specInstalled(userData, s));
    const mine = Boolean(job) && job.key === pick.wanted && ["downloading", "extracting", "error"].includes(job.state);
    return {
      tier: choice.tier,
      wanted: pick.wanted,
      wantedLabel: CATALOGUE[pick.wanted].label,
      wantedStreaming: CATALOGUE[pick.wanted].kind === "online",
      state: missing.length === 0 ? "ready" : mine ? job.state : "missing",
      pct: missing.length === 0 ? 100 : mine ? job.pct : 0,
      error: missing.length > 0 && mine && job.error ? job.error : undefined,
      downloadBytes: missing.reduce((n, s) => n + s.sizeBytes, 0),
      partial: missing.reduce((best, s) => Math.max(best, partialPct(userData, s)), 0),
      usable: Boolean(pick.model),
      active: pick.model,
      activeLabel: pick.model ? CATALOGUE[pick.model].label : null,
      streaming: pick.streaming,
      notes: pick.notes,
    };
  };
  const t = view("tracking");
  const q = view("questions");
  return {
    model: t.state, pct: t.pct, error: t.error, partial: t.partial,
    language: lang, tier: t.tier, wanted: t.wanted, wantedLabel: t.wantedLabel, wantedStreaming: t.wantedStreaming, downloadBytes: t.downloadBytes,
    usable: t.usable, active: t.active, activeLabel: t.activeLabel, streaming: t.streaming, notes: t.notes,
    questions: { wanted: q.wanted, wantedLabel: q.wantedLabel, state: q.state, pct: q.pct, downloadBytes: q.downloadBytes, usable: q.usable, active: q.active, notes: q.notes },
  };
}

/** Pure: the sherpa-onnx recognizer configuration for a catalogue entry unpacked in `dir`. */
function recognizerConfig(spec, dir, threads) {
  const file = (name) => path.join(dir, name);
  const modelConfig = { tokens: file(spec.files[spec.files.length - 1]), numThreads: threads, provider: "cpu", debug: 0 };
  if (spec.family === "dolphin") modelConfig.dolphin = { model: file(spec.files[0]) };
  else modelConfig.transducer = { encoder: file(spec.files[0]), decoder: file(spec.files[1]), joiner: file(spec.files[2]) };
  if (spec.family === "nemo-transducer") modelConfig.modelType = "nemo_transducer";
  else if (spec.kind === "online") modelConfig.modelType = "";
  const config = { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig, decodingMethod: "greedy_search" };
  if (spec.kind !== "online") return config;
  // A sentence is "committed" after 1.2 s of silence following speech, or 2.4 s of silence after
  // nothing, or 20 s of continuous speech. The live partial keeps the engine fed meanwhile.
  return { ...config, enableEndpoint: 1, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20 };
}

/**
 * One recognizer worker per session; started on demand, kept across takes (a model load takes 1-4 s)
 * and replaced when the language or the models on disk call for another model.
 * opts: { use: "tracking" | "questions", getLanguage: () => the stored spoken language, hardware }.
 */
class SttSession {
  constructor(userData, log, opts = {}) {
    this.userData = userData;
    this.log = log || (() => {});
    this.use = opts.use === "questions" ? "questions" : "tracking";
    this.getLanguage = opts.getLanguage || (() => "auto");
    this.hardware = opts.hardware;
    this.worker = null;
    this.modelKey = null;
    this.ready = false;
    this.stopping = null;
    this.onResult = () => {};
    this.onError = () => {};
  }

  threads() {
    return Math.max(2, Math.min(4, os.cpus().length - 2));
  }

  /** The language to listen for (an explicit one wins over the stored one) and the model to run. */
  plan(language) {
    const asked = normaliseLanguage(language);
    const lang = asked !== "auto" ? asked : normaliseLanguage(this.getLanguage());
    const choice = chooseModels({ language: lang, use: this.use, ...hardwareOf(this.hardware) });
    return { lang, pick: pickInstalled(choice, installedKeys(this.userData)) };
  }

  async start(language) {
    await this.stopping;
    const { lang, pick } = this.plan(language);
    if (!pick.model) throw new Error(lang === "auto" ? "model not downloaded" : `no speech model for ${LANGUAGE_NAMES[lang]} is downloaded`);
    const spec = CATALOGUE[pick.model];
    const info = { model: pick.model, streaming: pick.streaming, notes: pick.notes, language: lang };
    if (this.worker && this.ready && this.modelKey === pick.model) {
      this.worker.postMessage({ type: "language", language: lang });
      return { loadMs: 0, ...info };
    }
    // Another model (or a worker that never became ready): one recognizer in memory at a time.
    this.dispose();
    const script = path.join(__dirname, "stt-worker.js").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    const worker = new Worker(script);
    this.worker = worker;
    this.modelKey = pick.model;
    const threads = this.threads();
    return new Promise((resolve, reject) => {
      worker.on("message", (m) => {
        if (this.worker !== worker) return;
        if (m.type === "ready") {
          this.ready = true;
          // "stt: <key> ready" is what tools/autoloop/e2e/linux.mjs looks for.
          this.log(`stt: ${pick.model} ready in ${m.loadMs} ms (${threads} threads, ${spec.label}, ${this.use}, ${lang})`);
          resolve({ loadMs: m.loadMs, ...info });
        } else if (m.type === "result") this.onResult(m);
        else if (m.type === "error") {
          this.log(`stt error: ${m.message}`);
          if (!this.ready) reject(new Error(m.message));
          this.onError(m.message);
        }
      });
      worker.on("error", (err) => {
        this.log(`stt worker crashed: ${err.message}`);
        if (this.worker !== worker) return reject(err);
        const wasReady = this.ready;
        this.ready = false;
        this.worker = null;
        this.modelKey = null;
        if (!wasReady) reject(err);
        this.onError(err.message);
      });
      worker.on("exit", () => {
        // A worker replaced or disposed while it was loading must not leave its caller waiting.
        reject(new Error("speech recognition stopped before it was ready"));
        if (this.worker !== worker) return;
        this.ready = false;
        this.worker = null;
        this.modelKey = null;
      });
      worker.postMessage({
        type: "init",
        kind: spec.kind,
        config: recognizerConfig(spec, modelDir(this.userData, spec), threads),
        vad: spec.kind === "offline" ? path.join(modelDir(this.userData, VAD), VAD.files[0]) : null,
        streamLanguage: Boolean(spec.streamLanguage),
        language: lang,
      });
    });
  }

  feed(samples) {
    if (this.worker && this.ready) this.worker.postMessage({ type: "feed", samples }, [samples.buffer]);
  }

  stop() {
    if (this.stopping) return this.stopping;
    const worker = this.worker;
    if (!worker || !this.ready) return Promise.resolve();
    this.stopping = new Promise((resolve) => {
      const finish = () => {
        worker.off("message", onMessage);
        worker.off("error", finish);
        worker.off("exit", finish);
        resolve();
      };
      const onMessage = (m) => {
        if (m.type === "stopped") finish();
      };
      worker.on("message", onMessage);
      worker.once("error", finish);
      worker.once("exit", finish);
      // The worker sends its final result before this acknowledgement.
      try { worker.postMessage({ type: "stop" }); }
      catch (err) { finish(); this.onError(err.message); }
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }

  dispose() {
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    this.modelKey = null;
    this.ready = false;
  }
}

/**
 * The same module surface (modelReady, SttSession) bound to one use and to the stored spoken
 * language, for a caller that only knows "start listening" (OK Filow asks questions).
 */
function forUse(use, getLanguage = () => "auto") {
  return {
    modelReady: (userData) => modelReady(userData, { use, language: getLanguage() }),
    SttSession: class extends SttSession {
      constructor(userData, log) {
        super(userData, log, { use, getLanguage });
      }
    },
  };
}

module.exports = {
  MODEL, CATALOGUE, LANGUAGES, normaliseLanguage, tierFor, chooseModels, pickInstalled, installedKeys, requiredSpecs, recognizerConfig, speechStatus,
  modelDir, modelReady, ensureModel, ensureAll, removeModel, partFile, partialPct, SttSession, forUse, verifyArchive, sha256File,
};
