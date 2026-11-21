// Experimental opt-in controller. Audio stays in memory except explicit enrolment.
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULTS, keywordText, blocked, checkRecording, profileCombiner, sensitivity, captureAllowed } = require("./wake-policy");
const { createCaptureWatch } = require("./okfilow-mic");
const { validateProfile } = require("./wake-head");
const { canEnable, replayEnrolment, prefixFallback } = require("./wake-enrolment");
const { verifyModels, ensureModels, FILES, NOTICE } = require("./wake-models");
const { readSample, wav } = require("./wake-pcm");
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
  fs.writeFileSync(keywords, keywordText(profile));
  const head = utilityProcess.fork(path.join(__dirname, "wake-head-worker.js"), [], { stdio: "ignore", serviceName: "Filow wake word" });
  const b = rpc(head);
  try {
    await b.call({ type: "init", dir, profile }, 30000);
    return { feed(samples, at) { return b.call({ type: "feed", samples, at }); }, reset() { return b.call({ type: "reset" }); }, stop() { b.stop(); } };
  } catch (e) { b.stop(); throw e; }
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
  function retireOldRecordings() {
    fs.rmSync(path.join(root, "samples"), { recursive: true, force: true });
  }
  if (profile?.phrase === DEFAULTS.phrase) {
    try { retireOldRecordings(); } catch (e) { error = String(e.message || e).slice(0, 240); }
  }
  const samplesDir = path.join(root, "filow-samples");
  const samplesCount = () => Array.from({ length: 5 }, (_, i) => fs.existsSync(path.join(samplesDir, `${i + 1}.wav`))).filter(Boolean).length;
  const snapshot = () => ({ enabled, listening, error, phase, count, testing, recordings: samplesCount(), negatives: [1,2].filter(i=>fs.existsSync(path.join(samplesDir, `negative-${i}.wav`))).length, prefixFallback: { balanced: prefixFallback(profile, "balanced"), strict: prefixFallback(profile, "strict") }, verification: profile?.verification, trained: Boolean(profile), legacyPhrase: Boolean(profile && !profile.phrase), notice: NOTICE });
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
  async function enable(mode, allowBare = true) {
    stop(); error = ""; phase = "checking"; const token = epoch;
    try {
      await verifyModelsFn(dir);
      if (token !== epoch) return snapshot();
      const saved = JSON.parse(fs.readFileSync(profileFile, "utf8"));
      if (!validateProfile(saved) || saved.models !== FILES.map((f) => f.sha256).join(":")) throw new Error("Record or retrain your wake word for these models");
      const fallback = prefixFallback(saved, sensitivity(mode));
      if (!fallback && !canEnable(saved.verification, sensitivity(mode))) throw new Error("Replay check required: recognise at least 4 of 5 takes and reject personal negatives");
      profile = saved; phase = "checking"; publish();
      const requirePrefix = profile.phrase === DEFAULTS.phrase && (!allowBare || fallback);
      const loaded = await createDetectorsFn(dir, { ...profile, requirePrefix }, utilityProcess);
      if (token !== epoch) { loaded.stop(); return snapshot(); }
      detectors = loaded;
      const times = [];
      for (let i = 0; i < 100; i++) {
        if (token !== epoch) return snapshot();
        times.push((await detectors.feed(new Float32Array(1600), i * 100)).ms);
      }
      times.sort((a, b) => a - b);
      if (times[94] > 30) throw new Error(`Wake detector too slow: ${Math.round(times[94])} ms per 100 ms block (limit 30 ms)`);
      await detectors.reset(); combiner = profileCombiner({ ...profile, requirePrefix }, sensitivity(mode));
      enabled = true; phase = "ready"; publish(); await reconcile();
    } catch (e) { if (token === epoch) fail(e); }
    return snapshot();
  }
  function setBare(mode, allowBare) {
    if (enabled || phase === "checking") return enable(mode, allowBare);
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
  function enrolmentChanged() {
    // Old profiles use a separate set of takes and can still be used during migration.
    if (profile?.phrase) {
      fs.rmSync(profileFile, { force: true });
      profile = null;
    }
    phase = "enrol"; publish(); return snapshot();
  }
  function sample(index, pcm) {
    stop();
    if (!Number.isInteger(index) || index < 0 || index >= 5) throw new Error("Invalid enrolment take");
    const reason = checkRecording(pcm); if (reason) throw new Error(reason);
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.writeFileSync(path.join(samplesDir, `${index + 1}.wav`), wav(pcm));
    return enrolmentChanged();
  }
  function negative(index, pcm) {
    stop();
    if (!Number.isInteger(index) || index < 0 || index > 1) throw new Error("Invalid personal negative");
    fs.mkdirSync(samplesDir, { recursive: true });
    const file = path.join(samplesDir, `negative-${index + 1}.wav`);
    if (pcm === null) fs.rmSync(file, { force: true });
    else { const reason = checkRecording(pcm); if(reason) throw new Error(reason); fs.writeFileSync(file,wav(pcm)); }
    return enrolmentChanged();
  }
  async function train(mode) {
    stop(); error = ""; phase = "training"; publish(); const token = epoch;
    try {
      await verifyModelsFn(dir);
      const recordings = Array.from({ length: 5 }, (_, i) => readSample(path.join(samplesDir, `${i + 1}.wav`)));
      const negatives = [1,2].map(i=>path.join(samplesDir,`negative-${i}.wav`)).filter(file=>fs.existsSync(file)).map(readSample);
      for (const recording of recordings) { const reason = checkRecording(recording); if (reason) throw new Error(reason); }
      const child = utilityProcess.fork(path.join(__dirname, "wake-head-worker.js"), [], { stdio: "ignore", serviceName: "Filow wake training" });
      trainer = rpc(child);
      await trainer.call({ type: "init", dir }, 30000);
      const got = await trainer.call({ type: "train", recordings, negatives, background: path.join(__dirname, "wake-data") }, 120000);
      if (token !== epoch) return snapshot();
      if (!validateProfile(got.profile)) throw new Error("Invalid trained wake word");
      const candidate = { ...got.profile, phrase: DEFAULTS.phrase, models: FILES.map((f) => f.sha256).join(":"), createdAt: new Date().toISOString() };
      const replay = await createDetectorsFn(dir, candidate, utilityProcess);
      try { candidate.verification = await replayEnrolment(replay, candidate, recordings, negatives); }
      finally { replay.stop(); }
      if (token !== epoch) return snapshot();
      if (negatives.length && ["balanced", "strict"].some(m => !canEnable(candidate.verification, m))) {
        const prefixed = { ...candidate, requirePrefix: true };
        const detector = await createDetectorsFn(dir, prefixed, utilityProcess);
        try {
          const checks = await replayEnrolment(detector, prefixed, [], negatives);
          candidate.prefixNegatives = Object.fromEntries(Object.entries(checks).map(([m, row]) => [m, row.negativeAccepts]));
        } finally { detector.stop(); }
        if (token !== epoch) return snapshot();
      }
      if (profile && !profile.phrase && !canEnable(candidate.verification, sensitivity(mode))) {
        throw new Error("Replay check required: record five new takes and retrain");
      }
      fs.writeFileSync(profileFile + ".tmp", JSON.stringify(candidate));
      fs.renameSync(profileFile + ".tmp", profileFile);
      profile = candidate;
      retireOldRecordings();
      phase = "ready"; publish();
    } catch (e) { if (token === epoch) fail(e); }
    finally { if (token === epoch) { trainer?.stop(); trainer = null; } }
    return snapshot();
  }
  function remove() { stop(); fs.rmSync(root, { recursive: true, force: true }); profile = null; error = ""; publish(); return snapshot(); }
  return { status: snapshot, setup, enable, setBare, stop, fail, feed, reconcile, sample, negative, train, remove, test(on) { testing = on === true; count = 0; publish(); return snapshot(); } };
}
module.exports = { createWake, createDetectors, wav, readSample };
