// Experimental opt-in controller. Audio stays in memory except explicit enrolment.
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { SPELLINGS, blocked, checkRecording, createCombiner, sensitivity, captureAllowed } = require("./wake-policy");
const { createCaptureWatch } = require("./okfilow-mic");
const { validateProfile } = require("./wake-head");
const { verifyModels, ensureModels, FILES, NOTICE } = require("./wake-models");
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + 2 * i));
  return b;
}
function readSample(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.readUInt32LE(24) !== 16000 || b.readUInt16LE(22) !== 1 || b.readUInt16LE(34) !== 16 || b.toString("ascii", 36, 40) !== "data") throw new Error("Invalid enrolment WAV");
  return Float32Array.from({ length: (b.length - 44) / 2 }, (_, i) => b.readInt16LE(44 + i * 2) / 32768);
}
function rpc(child) {
  let next = 0, closed = false;
  const pending = new Map();
  const fail = (error) => { closed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on("message", (m) => { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(new Error(m.error)); else p.resolve(m); });
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Wake detector exited")));
  return {
    call(message, timeout = 10000) {
      if (closed) return Promise.reject(new Error("Wake detector stopped"));
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Wake detector timed out")); }, timeout);
        pending.set(id, { resolve, reject, timer }); child.postMessage({ ...message, id });
      });
    },
    stop() { fail(new Error("Wake detector stopped")); if (child.terminate) void child.terminate(); else child.kill(); },
  };
}
async function createDetectors(dir, profile, utilityProcess) {
  const keywords = path.join(dir, "keywords.txt");
  fs.writeFileSync(keywords, SPELLINGS.map((s, i) => `${s} :2.5 #0.05 @v${i + 1}`).join("\n") + "\n");
  const kw = new Worker(path.join(__dirname, "wake-worker.js"), { workerData: { dir, keywords } });
  const head = utilityProcess.fork(path.join(__dirname, "wake-head-worker.js"), [], { stdio: "ignore", serviceName: "Filow wake word" });
  const a = rpc(kw), b = rpc(head);
  try {
    await b.call({ type: "init", dir, profile }, 30000);
    return { async feed(samples, at) { const [k, h] = await Promise.all([a.call({ type: "feed", samples, at }), b.call({ type: "feed", samples, at })]); return { at, keyword: k.keyword, phraseEndMs: k.phraseEndMs, score: h.score, ms: k.ms + h.ms }; }, reset() { kw.postMessage({ type: "reset" }); return b.call({ type: "reset" }); }, stop() { a.stop(); b.stop(); } };
  } catch (e) { a.stop(); b.stop(); throw e; }
}
function createWake({ userData, utilityProcess, state, changed, detected, verifyModelsFn = verifyModels, ensureModelsFn = ensureModels, createDetectorsFn = createDetectors }) {
  const dir = path.join(userData, "models", "wake"), root = path.join(userData, "wake");
  const profileFile = path.join(root, "profile.json");
  let enabled = false, listening = false, error = "", phase = "off", count = 0, testing = false;
  let detectors = null, trainer = null, combiner = null, abort = null, epoch = 0, pending = false, at = 0;
  let captureEpoch = 0, desiredPhase = "off";
  let ring = new Float32Array(), profile = null;
  const captureWatch = createCaptureWatch();
  try { const stored = JSON.parse(fs.readFileSync(profileFile, "utf8")); if (validateProfile(stored)) profile = stored; } catch { /* no trained phrase yet */ }
  const samplesDir = path.join(root, "samples");
  const samplesCount = () => Array.from({ length: 5 }, (_, i) => fs.existsSync(path.join(samplesDir, `${i + 1}.wav`))).filter(Boolean).length;
  const snapshot = () => ({ enabled, listening, error, phase, count, testing, recordings: samplesCount(), trained: Boolean(profile), notice: NOTICE });
  const publish = () => changed(snapshot());
  function stop() {
    captureWatch.reset();
    captureEpoch++; desiredPhase = "off";
    epoch++; enabled = false; listening = false; pending = false; phase = "off";
    abort?.abort(); abort = null; detectors?.stop(); detectors = null; trainer?.stop(); trainer = null;
    ring = new Float32Array(); at = 0; combiner?.reset(); publish();
  }
  function fail(e) { stop(); error = String(e?.message || e).slice(0, 240); publish(); }
  function allowed() { return blocked({ ...state(), enabled, models: Boolean(detectors), trained: Boolean(profile) }); }
  async function reconcile() {
    if (!enabled || !detectors) return;
    const reason = allowed();
    const next = !reason;
    const target = reason || "listening";
    if (desiredPhase === target) return;
    desiredPhase = target; const token = ++captureEpoch;
    listening = false; phase = reason || "opening"; ring = new Float32Array(); combiner.reset(); publish();
    try {
      await detectors.reset();
      if (token !== captureEpoch) return;
      listening = next; phase = target; publish();
    } catch (e) { if (token === captureEpoch) fail(e); }
  }
  async function setup(consent) {
    stop(); error = ""; phase = "downloading"; publish();
    const token = epoch;
    abort = new AbortController();
    try {
      await ensureModelsFn(dir, { consent: consent === true, enabled: true, signal: abort.signal });
      if (token !== epoch) return snapshot();
      phase = "enrol"; publish();
    } catch (e) { if (token === epoch) fail(e); }
    return snapshot();
  }
  async function enable(mode) {
    stop(); error = ""; const token = epoch;
    try {
      await verifyModelsFn(dir);
      const saved = JSON.parse(fs.readFileSync(profileFile, "utf8"));
      if (!validateProfile(saved) || saved.models !== FILES.map((f) => f.sha256).join(":")) throw new Error("Record or retrain your wake word for these models");
      profile = saved; phase = "checking"; publish();
      const loaded = await createDetectorsFn(dir, profile, utilityProcess);
      if (token !== epoch) { loaded.stop(); return snapshot(); }
      detectors = loaded;
      const times = [];
      for (let i = 0; i < 100; i++) {
        if (token !== epoch) return snapshot();
        times.push((await detectors.feed(new Float32Array(1600), i * 100)).ms);
      }
      times.sort((a, b) => a - b);
      if (times[94] > 30) throw new Error(`Wake detector too slow: ${Math.round(times[94])} ms per 100 ms block (limit 30 ms)`);
      await detectors.reset(); combiner = createCombiner(profile.thresholds, sensitivity(mode));
      enabled = true; phase = "ready"; publish(); await reconcile();
    } catch (e) { if (token === epoch) fail(e); }
    return snapshot();
  }
  async function feed(samples) {
    const authorized = captureAllowed("wake", { ...state(), enabled, models: Boolean(detectors), trained: Boolean(profile), wakeListening: listening });
    if (captureWatch.frame(authorized)) return fail(new Error("Wake microphone continued after authorization ended"));
    if (!listening || allowed()) { reconcile(); return; }
    if (!(samples instanceof Float32Array) || samples.length !== 1600 || samples.some((x) => !Number.isFinite(x))) return fail(new Error("Invalid wake audio block"));
    if (pending) return fail(new Error("Wake detector cannot keep up with the microphone"));
    const token = epoch, captureToken = captureEpoch; pending = true; at += 100;
    const joined = new Float32Array(ring.length + samples.length); joined.set(ring); joined.set(samples, ring.length); ring = joined.slice(-32000);
    try {
      const result = await detectors.feed(samples, at);
      if (token !== epoch || captureToken !== captureEpoch || !listening || allowed()) return;
      if (combiner.push(result)) {
        count++; publish();
        if (!testing) {
          // Keep only sound after the last keyword token; a head-only wake uses
          // its training window's 80-320 ms trailing context (midpoint 200 ms).
          const end = Number.isFinite(result.phraseEndMs) ? result.phraseEndMs : at - 200;
          const tail = Math.max(0, Math.min(ring.length, Math.round((at - end) * 16)));
          const carry = tail ? ring.slice(-tail) : new Float32Array();
          listening = false; phase = "question"; publish(); detected(carry);
        }
      }
    } catch (e) { if (token === epoch) fail(e); }
    finally { if (token === epoch) pending = false; }
  }
  function sample(index, pcm) {
    stop();
    if (!Number.isInteger(index) || index < 0 || index >= 5) throw new Error("Invalid enrolment take");
    const reason = checkRecording(pcm); if (reason) throw new Error(reason);
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.writeFileSync(path.join(samplesDir, `${index + 1}.wav`), wav(pcm));
    fs.rmSync(profileFile, { force: true }); profile = null; phase = "enrol"; publish(); return snapshot();
  }
  async function train() {
    stop(); error = ""; phase = "training"; publish(); const token = epoch;
    try {
      await verifyModelsFn(dir);
      const recordings = Array.from({ length: 5 }, (_, i) => readSample(path.join(samplesDir, `${i + 1}.wav`)));
      for (const recording of recordings) { const reason = checkRecording(recording); if (reason) throw new Error(reason); }
      const child = utilityProcess.fork(path.join(__dirname, "wake-head-worker.js"), [], { stdio: "ignore", serviceName: "Filow wake training" });
      trainer = rpc(child);
      await trainer.call({ type: "init", dir }, 30000);
      const got = await trainer.call({ type: "train", recordings, background: path.join(__dirname, "wake-data") }, 120000);
      if (token !== epoch) return snapshot();
      if (!validateProfile(got.profile)) throw new Error("Invalid trained wake word");
      profile = { ...got.profile, models: FILES.map((f) => f.sha256).join(":"), createdAt: new Date().toISOString() };
      fs.writeFileSync(profileFile, JSON.stringify(profile)); phase = "ready"; publish();
    } catch (e) { if (token === epoch) fail(e); }
    finally { if (token === epoch) { trainer?.stop(); trainer = null; } }
    return snapshot();
  }
  function remove() { stop(); fs.rmSync(root, { recursive: true, force: true }); profile = null; error = ""; publish(); return snapshot(); }
  return { status: snapshot, setup, enable, stop, fail, feed, reconcile, sample, train, remove, test(on) { testing = on === true; count = 0; publish(); return snapshot(); } };
}
module.exports = { createWake, createDetectors, wav, readSample };
