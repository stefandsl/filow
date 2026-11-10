// OK Filow's natural voice on this PC (docs/okfilow/VOICE.md): Supertonic 3 through sherpa-onnx,
// in a worker thread so the UI never waits on it. The answer is cut into sentences and each one is
// sent to the panel as soon as it is ready, so speech starts after the first sentence, not the last.
// The model is downloaded on request with the same pinned-hash, resumable download as the speech
// recogniser (stt.js) and lives next to it under <userData>/models.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const MODEL = {
  id: "supertonic-3-tts-int8",
  archive: "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
  sizeBytes: 128774318,
  sha256: "82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427",
  files: ["duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx", "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin"],
};

/** The languages OK Filow speaks with this voice. */
const LANGS = ["en", "it", "ru", "ro", "ja"];
/** Speakers in the model: 0-4 are the female voices, 5-9 the male ones (measured pitch, VOICE.md). */
const VOICES = 10;
/** Longest answer spoken in one go. */
const MAX_TEXT = 4000;

// `spec` is MODEL everywhere except in tests.
const modelDir = (userData, spec = MODEL) => path.join(userData, "models", spec.id);
const modelReady = (userData, spec = MODEL) => spec.files.every((f) => fs.existsSync(path.join(modelDir(userData, spec), f)));
function removeModel(userData, spec = MODEL) {
  fs.rmSync(modelDir(userData, spec), { recursive: true, force: true });
}

/** Language and speaker for a request; anything unknown falls back to English and the first voice. */
function voiceFor(lang, voice) {
  const l = LANGS.includes(lang) ? lang : "en";
  const n = Number(voice);
  return { lang: l, sid: Number.isInteger(n) && n >= 0 && n < VOICES ? n : 0 };
}

// ---- text that reads well aloud ----

const RU_UNITS = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const RU_TENS = { 2: "двадцать", 3: "тридцать", 4: "сорок", 5: "пятьдесят" };
const ruNumber = (n) => (n < 20 ? RU_UNITS[n] : RU_TENS[Math.floor(n / 10)] + (n % 10 ? " " + RU_UNITS[n % 10] : ""));
const KANA_LETTERS = {
  A: "エー", B: "ビー", C: "シー", D: "ディー", E: "イー", F: "エフ", G: "ジー", H: "エイチ", I: "アイ", J: "ジェー", K: "ケー", L: "エル", M: "エム",
  N: "エヌ", O: "オー", P: "ピー", Q: "キュー", R: "アール", S: "エス", T: "ティー", U: "ユー", V: "ブイ", W: "ダブリュー", X: "エックス", Y: "ワイ", Z: "ゼット",
};
// A clock time such as 9:30 or 21:05, not part of a longer number (1:2:3, 10:30:15).
const CLOCK = /(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;

/** How a clock time is written so the voice reads it right (each form measured, VOICE.md). */
function clock(h, m, lang) {
  const hours = Number(h);
  const minutes = Number(m);
  if (lang === "ru") return `${ruNumber(hours)} ${minutes < 10 ? "ноль " : ""}${ruNumber(minutes)}`;
  if (lang === "ja") return minutes ? `${hours}時${minutes}分` : `${hours}時`;
  if (lang === "en") return `${h}:${m}`;
  return minutes ? `${hours} ${m}` : String(hours);
}

/** The answer as plain speech: no markdown, links, emoji; times and acronyms the voice can read. */
function speakable(text, lang) {
  let s = String(text ?? "").slice(0, MAX_TEXT).normalize("NFC");
  s = s.replace(/```[^\n]*\n?/g, "\n"); // code fences: keep the lines, drop the markers
  s = s.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1"); // [text](url) -> text
  s = s.replace(/\bhttps?:\/\/([^\s/]+)\S*/g, "$1"); // a bare link: say the site, not the path
  s = s.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,2}[.)])[ \t]+/gm, ""); // headings, quotes, list marks
  s = s.replace(/(\*\*|__|~~|`)/g, "");
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, "$1$2"); // *emphasis*
  s = s.replace(/\p{Extended_Pictographic}|‍|️/gu, ""); // emoji, with their joiners and variation marks
  s = s.replace(CLOCK, (_, h, m) => clock(h, m, lang));
  if (lang === "ja") s = s.replace(/(?<![A-Za-z])[A-Z]{2,4}(?![A-Za-z])/g, (w) => [...w].map((c) => KANA_LETTERS[c]).join(""));
  // A line with no end mark still ends a thought: let the voice pause there.
  s = s.split(/\n+/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  return s;
}

// ---- cutting the answer into pieces that can be spoken one after another ----

const WIDE = /[぀-ヿ㐀-鿿＀-￯]/;
const CLOSERS = "\"'”’»)]」』）";
const lowercase = (ch) => ch !== undefined && ch.toLowerCase() === ch && ch.toUpperCase() !== ch;

function sentences(text) {
  const out = [];
  const chars = [...text];
  let cur = "";
  const push = () => {
    // A piece with no letter or digit (":)", "...") has nothing to say: it is left out.
    if (/[\p{L}\p{N}]/u.test(cur)) out.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\n") { push(); continue; }
    cur += ch;
    const wide = "。！？".includes(ch);
    if (!wide && !".!?…".includes(ch)) continue;
    while (i + 1 < chars.length && (".!?…。！？".includes(chars[i + 1]) || CLOSERS.includes(chars[i + 1]))) cur += chars[++i];
    const next = chars[i + 1];
    if (wide || next === undefined || next === "\n") { push(); continue; }
    if (!/\s/.test(next)) continue; // 3.14, example.com, v2.0
    let j = i + 1;
    while (j < chars.length && /\s/.test(chars[j])) j++;
    // "e.g. the", "es. il": a full stop followed by a small letter does not end the sentence.
    if (ch === "." && lowercase(chars[j])) continue;
    push();
  }
  push();
  return out;
}

const size = (s) => [...s].length;
/** How much longer than the piece before a piece may be: its audio is made while the one before plays. */
const GROWTH = 3;

/**
 * Cuts one sentence at commas and the like. The first piece holds at most `budget` characters when
 * a place to cut exists, the next ones may grow; no piece is shorter than `minHead`. A stretch with
 * no comma stays whole up to `hardMax`, then it is cut between words.
 */
function clauses(sentence, budget, hardMax, minHead) {
  const chars = [...sentence];
  const parts = [];
  let part = "";
  chars.forEach((ch, i) => {
    part += ch;
    // "9:30", "1,5" and "a:b" are not places to breathe: a Latin mark counts only before a space.
    if ("、，；：".includes(ch) || (",;:".includes(ch) && /\s/.test(chars[i + 1] ?? ""))) { parts.push(part); part = ""; }
  });
  if (part) parts.push(part);
  const out = [];
  let cur = "";
  let room = budget;
  for (const p of parts) {
    if (size(cur.trim()) >= minHead && size((cur + p).trim()) > room) {
      out.push(cur.trim());
      room = Math.min(hardMax, Math.max(room, GROWTH * size(cur.trim())));
      cur = "";
    }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  if (out.length > 1 && size(out[out.length - 1]) < minHead) {
    const tail = out.pop();
    out[out.length - 1] += (/[、，；：]$/.test(out[out.length - 1]) ? "" : " ") + tail;
  }
  return out.flatMap((piece) => {
    if (size(piece) <= hardMax) return [piece];
    const lines = [];
    let line = "";
    // Between words; text written without spaces is cut between characters.
    for (const w of WIDE.test(piece) ? [...piece] : piece.split(/(?<=\s)/)) {
      if (line && size(line + w) > hardMax) { lines.push(line.trim()); line = ""; }
      line += w;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  });
}

/**
 * The pieces spoken one after another, each made while the one before plays. A sentence is a piece.
 * The first piece is kept short so speech starts quickly (a long opening sentence gives up its
 * first clause), and no piece is much longer than the one before, so the voice does not run dry
 * waiting for it. A one-word opening ("Sure.") is said together with what follows, for the same
 * reason. `pause` is the silence (ms) to leave after the piece.
 */
function splitSentences(text, lang) {
  const source = String(text ?? "");
  const wide = lang === "ja" || WIDE.test(source);
  const hardMax = wide ? 110 : 220; // one piece: at most about 15 s of speech
  const early = wide ? 24 : 48; // the first piece: about 3 s of speech, ready in well under a second
  const minHead = wide ? 6 : 16;
  const list = sentences(source);
  if (list.length > 1 && size(list[0]) < minHead) list.splice(0, 2, list[0] + (wide ? "" : " ") + list[1]);
  const out = [];
  let room = early;
  for (const sentence of list) {
    const pieces = size(sentence) > room ? clauses(sentence, room, hardMax, minHead) : [sentence];
    pieces.forEach((p, i) => out.push({ text: p, pause: i === pieces.length - 1 ? 220 : 60 }));
    room = Math.min(hardMax, Math.max(early, GROWTH * size(pieces[pieces.length - 1])));
  }
  return out;
}

/**
 * The model wraps every piece in 0.3 to 0.7 s of near-silence (measured, VOICE.md). Left in, speech
 * would start that much later and every sentence break would last over a second: keep a short
 * margin and let the caller decide the pause.
 */
function trimSilence(samples, sampleRate, floor = 0.003) {
  let a = 0;
  while (a < samples.length && Math.abs(samples[a]) < floor) a++;
  if (a === samples.length) return new Float32Array(0);
  let b = samples.length - 1;
  while (b > a && Math.abs(samples[b]) < floor) b--;
  const from = Math.max(0, a - Math.round(sampleRate * 0.02));
  const to = Math.min(samples.length, b + 1 + Math.round(sampleRate * 0.06));
  return samples.slice(from, to); // a copy: only these samples travel to the window
}

// ---- which setting this PC can carry ----

const GIB = 1024 ** 3;
/**
 * The voice setting for this hardware. Standard: 5 synthesis steps. Light (4 cores or fewer, or under
 * 8 GB): 4 steps on 2 threads, about a fifth less work and slightly less exact (VOICE.md). Too small
 * for the model (it needs about 420 MB of memory and two cores): the system voice, with the reason.
 */
function pickProfile({ cores = os.cpus().length, memBytes = os.totalmem() } = {}) {
  if (!(cores >= 2)) return { mode: "system", reason: "fewCores" };
  if (!(memBytes >= 3.5 * GIB)) return { mode: "system", reason: "lowMemory" };
  if (cores <= 4 || memBytes < 8 * GIB) return { mode: "natural", level: "light", steps: 4, threads: 2 };
  return { mode: "natural", level: "standard", steps: 5, threads: Math.max(2, Math.min(4, cores - 2)) };
}

/** Speech must be made faster than it is spoken; above this ratio it would stutter. */
const SLOW_RTF = 0.85;
const SLOW_STRIKES = 2;
/**
 * After each answer: two slow answers in a row step the setting down (standard -> light -> system
 * voice, reason "slow"). One slow answer alone is ignored, the PC may just have been busy.
 */
function nextProfile(profile, rtf, strikes = 0) {
  if (profile.mode !== "natural" || !(rtf > SLOW_RTF)) return { profile, strikes: 0 };
  if (strikes + 1 < SLOW_STRIKES) return { profile, strikes: strikes + 1 };
  if (profile.level === "standard") return { profile: { ...profile, level: "light", steps: 4 }, strikes: 0 };
  return { profile: { mode: "system", reason: "slow" }, strikes: 0 };
}

// ---- the worker session ----

const workerScript = () => path.join(__dirname, "tts-worker.js").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
/** The model is unloaded after this long without speech (it holds about 420 MB). */
const IDLE_MS = 10 * 60 * 1000;

class TtsSession {
  constructor(userData, log = () => {}, opts = {}) {
    this.userData = userData;
    this.log = log;
    this.makeWorker = opts.makeWorker || (() => new Worker(workerScript()));
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.model = opts.model || MODEL;
    this.worker = null;
    this.loading = null;
    this.threads = 0;
    this.pending = new Map();
    this.rid = 0;
    this.gen = 0;
    this.idle = null;
  }

  /** Loads the model (once); resolves when the worker can speak. */
  start(threads) {
    if (this.worker && this.threads === threads) return this.loading;
    this.stopWorker();
    const worker = this.makeWorker();
    this.worker = worker;
    this.threads = threads;
    this.loading = new Promise((resolve, reject) => {
      const fail = (message) => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.loading = null;
        for (const p of this.pending.values()) p.reject(new Error(message));
        this.pending.clear();
        reject(new Error(message));
        try { worker.terminate(); } catch { /* already gone */ }
      };
      worker.on("message", (msg) => {
        if (this.worker !== worker) return;
        if (msg.type === "ready") {
          this.log(`tts: model loaded in ${msg.loadMs} ms, ${threads} threads`);
          resolve();
        } else if (msg.type === "audio") {
          this.pending.get(msg.rid)?.resolve(msg);
          this.pending.delete(msg.rid);
        } else if (msg.type === "error") {
          if (msg.rid === undefined) return fail(msg.message);
          this.pending.get(msg.rid)?.reject(new Error(msg.message));
          this.pending.delete(msg.rid);
        }
      });
      worker.on("error", (err) => fail(String((err && err.message) || err)));
      worker.on("exit", (code) => fail(`voice worker stopped (${code})`));
    });
    // The failure is reported to whoever speaks next; a warm-up nobody awaits must not crash the app.
    this.loading.catch(() => {});
    worker.postMessage({ type: "init", dir: modelDir(this.userData, this.model), threads });
    return this.loading;
  }

  say(req) {
    return new Promise((resolve, reject) => {
      const rid = ++this.rid;
      this.pending.set(rid, { resolve, reject });
      this.worker.postMessage({ type: "say", rid, ...req });
    });
  }

  /**
   * Speaks `text` piece by piece: onChunk gets each piece's audio as soon as it exists. A newer
   * speak() or cancel() ends this one at once: nothing more is delivered, { cancelled: true }.
   */
  async speak({ text, lang, sid, speed, steps, threads }, onChunk) {
    const gen = ++this.gen;
    clearTimeout(this.idle);
    const pieces = splitSentences(speakable(text, lang), lang);
    const done = (extra) => {
      if (gen === this.gen) this.idle = setTimeout(() => this.stopWorker(), this.idleMs);
      return { chunks: pieces.length, sent: 0, rtf: 0, firstMs: 0, ...extra };
    };
    if (!pieces.length) return done({ cancelled: false });
    const t0 = Date.now();
    await this.start(threads);
    let work = 0;
    let audio = 0;
    let firstMs = 0;
    for (let seq = 0; seq < pieces.length; seq++) {
      if (gen !== this.gen) return done({ cancelled: true, sent: seq, firstMs });
      const got = await this.say({ text: pieces[seq].text, lang, sid, speed, steps });
      if (gen !== this.gen) return done({ cancelled: true, sent: seq, firstMs });
      const samples = got.samples ? trimSilence(got.samples, got.sampleRate) : [];
      const last = seq === pieces.length - 1;
      // A piece with nothing to say still reports the end, so the listener is never left waiting.
      if (!samples.length && !last) continue;
      work += got.ms;
      audio += (samples.length / got.sampleRate) * 1000;
      if (!firstMs && samples.length) firstMs = Date.now() - t0;
      onChunk({ seq, last, samples, sampleRate: got.sampleRate, pause: pieces[seq].pause, text: pieces[seq].text });
    }
    return done({ cancelled: false, sent: pieces.length, rtf: audio ? work / audio : 0, firstMs });
  }

  /** Stops the current speech: pieces still being made are dropped. */
  cancel() {
    this.gen++;
  }

  stopWorker() {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = null;
    this.loading = null;
    for (const p of this.pending.values()) p.reject(new Error("voice stopped"));
    this.pending.clear();
    if (worker) try { void worker.terminate(); } catch { /* already gone */ }
  }

  dispose() {
    this.gen++;
    this.stopWorker();
  }
}

// ---- wiring into OK Filow's main process ----

/** A mono 16-bit WAV file (test builds only: proof of what was spoken). */
function wavBytes(samples, sampleRate) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
}

/**
 * Registers the okfilow:tts:* channels. `ours(webContents)` says whether a sender is one of
 * OK Filow's windows; `qaDir` (test builds only) gets a WAV and a JSON line per spoken answer.
 */
function wireTts({ ipcMain, ours, userData, logLine = () => {}, isOffline = () => false, qaDir = "", hardware, session, download, model = MODEL, onChange = () => {} }) {
  const stt = require("./stt");
  const fetchModel = download || ((onStatus) => stt.ensureModel(userData, onStatus, model));
  const tts = session || new TtsSession(userData, logLine, { model });
  const installed = () => modelReady(userData, model);
  let profile = pickProfile(hardware);
  let strikes = 0;
  let state = { state: "idle", pct: 0, error: "" };
  let downloading = null;
  let spoken = 0;
  let current = 0;
  const watchers = new Set();

  const status = () => {
    const here = installed();
    return {
      installed: here,
      state: here && state.state !== "downloading" && state.state !== "extracting" ? "ready" : state.state,
      pct: here ? 100 : state.state === "idle" || state.state === "error" ? stt.partialPct(userData, model) : state.pct,
      error: state.error,
      sizeBytes: model.sizeBytes,
      voices: VOICES,
      // "natural" with its level, or "system" with the reason this PC cannot carry the model.
      mode: profile.mode,
      level: profile.level || "",
      reason: profile.reason || "",
    };
  };
  const push = () => {
    const s = status();
    for (const wc of watchers) {
      if (wc.isDestroyed()) watchers.delete(wc);
      else wc.send("okfilow:tts:status", s);
    }
    onChange(s);
  };
  const watch = (wc) => {
    if (!ours(wc)) throw new Error("Denied");
    watchers.add(wc);
  };

  ipcMain.handle("okfilow:tts:status", (event) => {
    watch(event.sender);
    return status();
  });

  // The click on "Download" is the consent. One download at a time: a second click joins the first.
  ipcMain.handle("okfilow:tts:download", (event) => {
    watch(event.sender);
    if (installed()) return status();
    if (isOffline()) return { ...status(), state: "error", error: "offline" };
    if (!downloading) {
      state = { state: "downloading", pct: stt.partialPct(userData, model), error: "" };
      logLine("tts: model download started");
      downloading = Promise.resolve()
        .then(() => fetchModel((s) => {
          state = { state: s.state, pct: Math.round(s.pct ?? state.pct), error: s.error ? String(s.error) : "" };
          push();
        }))
        .catch((err) => { state = { state: "error", pct: 0, error: String((err && err.message) || err) }; })
        .then(() => {
          downloading = null;
          if (state.state !== "error") state = { state: "idle", pct: 0, error: "" };
          logLine(`tts: model download ${installed() ? "finished" : "failed: " + state.error}`);
          push();
        });
    }
    return status();
  });

  ipcMain.handle("okfilow:tts:remove", (event) => {
    watch(event.sender);
    if (downloading) return status();
    tts.dispose();
    removeModel(userData, model);
    try { fs.rmSync(stt.partFile(userData, model), { force: true }); } catch { /* nothing to remove */ }
    state = { state: "idle", pct: 0, error: "" };
    push();
    return status();
  });

  /** Loads the model ahead of the answer (the panel calls it when a question starts). */
  ipcMain.handle("okfilow:tts:warm", (event) => {
    watch(event.sender);
    if (profile.mode !== "natural" || !installed()) return false;
    clearTimeout(tts.idle);
    tts.idle = setTimeout(() => tts.stopWorker(), tts.idleMs);
    void tts.start(profile.threads).catch(() => {});
    return true;
  });

  ipcMain.handle("okfilow:tts:speak", async (event, req) => {
    const wc = event.sender;
    watch(wc);
    if (!installed()) return { ok: false, reason: "notInstalled" };
    if (profile.mode !== "natural") return { ok: false, reason: profile.reason };
    const r = req && typeof req === "object" ? req : {};
    const id = Number(r.id) || 0;
    const { lang, sid } = voiceFor(r.lang, r.voice);
    // The same small lift as the system voice (1.05), so "normal" sounds alike in both.
    const speed = 1.05 * Math.min(1.5, Math.max(0.75, Number(r.speed) || 1));
    const used = profile;
    const n = ++spoken;
    current = id;
    const kept = [];
    let rate = 44100;
    try {
      const out = await tts.speak({ text: String(r.text ?? ""), lang, sid, speed, steps: used.steps, threads: used.threads }, (chunk) => {
        if (qaDir) {
          rate = chunk.sampleRate;
          kept.push(chunk.samples, new Float32Array(chunk.last ? 0 : Math.round((rate * chunk.pause) / 1000)));
        }
        if (!wc.isDestroyed()) wc.send("okfilow:tts:chunk", { id, seq: chunk.seq, last: chunk.last, samples: chunk.samples, sampleRate: chunk.sampleRate, pause: chunk.pause });
      });
      logLine(`tts: ${lang} voice ${sid} ${used.level} ${out.sent}/${out.chunks} pieces, first audio ${out.firstMs} ms, rtf ${out.rtf.toFixed(2)}${out.cancelled ? ", cut short" : ""}`);
      if (qaDir) {
        try {
          fs.mkdirSync(qaDir, { recursive: true });
          const all = new Float32Array(kept.reduce((a, s) => a + s.length, 0));
          kept.reduce((at, s) => { all.set(s, at); return at + s.length; }, 0);
          const name = `tts-${String(n).padStart(3, "0")}`;
          if (all.length) fs.writeFileSync(path.join(qaDir, `${name}.wav`), wavBytes(all, rate));
          fs.writeFileSync(path.join(qaDir, `${name}.json`), JSON.stringify({ id, text: String(r.text ?? ""), lang, sid, speed, level: used.level, steps: used.steps, threads: used.threads, ...out }));
        } catch (err) {
          logLine(`tts: qa capture failed: ${String((err && err.message) || err)}`);
        }
      }
      if (!out.cancelled && out.sent) {
        const next = nextProfile(profile, out.rtf, strikes);
        if (next.profile !== profile) logLine(`tts: this PC is too slow for the ${profile.level} setting (rtf ${out.rtf.toFixed(2)}), now ${next.profile.level || "system voice"}`);
        profile = next.profile;
        strikes = next.strikes;
        if (profile !== used) push();
      }
      return { ok: true, cancelled: out.cancelled, chunks: out.chunks, sent: out.sent, level: used.level };
    } catch (err) {
      const error = String((err && err.message) || err);
      logLine(`tts: failed: ${error}`);
      return { ok: false, reason: "failed", error };
    }
  });

  // With an id, only that answer is cut: a late "stop" for an old answer never silences the new one.
  ipcMain.handle("okfilow:tts:cancel", (event, id) => {
    watch(event.sender);
    if (id === undefined || id === null || Number(id) === current) tts.cancel();
  });

  // What the panel really played (for the log; nothing leaves this PC).
  ipcMain.on("okfilow:tts:played", (event, info) => {
    if (!ours(event.sender) || !info || typeof info !== "object") return;
    const line = `tts: played ${Number(info.seconds || 0).toFixed(1)} s of id ${Number(info.id) || 0}${info.interrupted ? " (interrupted)" : ""}, audio ${String(info.state || "").slice(0, 20)}`;
    logLine(line);
    if (qaDir) try { fs.appendFileSync(path.join(qaDir, "played.log"), line + "\n"); } catch { /* test folder gone */ }
  });

  return {
    status,
    installed,
    /** The model is here and this PC can carry it. */
    usable: () => profile.mode === "natural" && installed(),
    dispose: () => tts.dispose(),
  };
}

module.exports = { MODEL, LANGS, VOICES, modelDir, modelReady, removeModel, voiceFor, speakable, splitSentences, trimSilence, pickProfile, nextProfile, TtsSession, wireTts, wavBytes };
