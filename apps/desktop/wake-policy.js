// Experimental wake word policy. No device, disk or network access in this module.
const DEFAULTS = Object.freeze({
  enabled: false, phrase: "OK Filow", longerPhrase: false, sensitivity: "balanced",
  followUpMs: 0, interruptSpeech: false, offDuringTake: true, offDuringSlideshow: true,
  eyeStopsWake: true, pauseStopsWake: true, bundleModels: false, retainRecordings: true,
  recordings: 5, threads: 1, reopenMs: 600, agreementMs: 1200, cooldownMs: 2000,
  sampleRate: 16000, blockSamples: 1600, ringSamples: 32000,
});
const SPELLINGS = Object.freeze([
  "OW2 K EY1 F IY1 L OW0", "OW1 K EY1 F IY1 L OW1", "OW2 K EY1 F IH1 L OW0",
  "OW2 K EY1 F AY1 L OW0", "OW2 K EY1 F IY1 L AO1", "AO1 K EY1 F IY1 L AO0",
  "AO1 K EH1 F IY1 L AO1", "OW2 K EY1 F IY0 L OW1", "OW2 K EY1 F IY1 R OW0",
  "OW2 K EY1 HH IY1 R OW0", "OW2 K EY1 F IY1 L UW0", "AH0 K EY1 F IY1 L OW0",
  "OW2 K EY1 F IH1 L AO1", "AO1 K EY1 F IY1 L OW0", "K EY1 F IY1 L OW0",
]);
const sensitivity = (v) => ["strict", "balanced", "sensitive"].includes(v) ? v : DEFAULTS.sensitivity;
function blocked(s) {
  if (!s.enabled || !s.assistantEnabled) return "off";
  if (!s.models) return "models";
  if (!s.trained) return "enrol";
  if (DEFAULTS.offDuringTake && s.take) return "take";
  if (DEFAULTS.offDuringSlideshow && s.slideshow) return "slideshow";
  if (DEFAULTS.eyeStopsWake && s.eyeClosed) return "eye";
  if (DEFAULTS.pauseStopsWake && s.paused) return "paused";
  if (s.locked) return "locked";
  if (s.handsFree || s.dictation || s.mode !== "idle") return "busy";
  if (s.sinceSpeechMs < DEFAULTS.reopenMs) return "speech";
  if (s.light && (s.answering || s.downloading)) return "busy";
  if (!s.indicator) return "indicator";
  return "";
}
function combine(mode, score, kws, thresholds) {
  if (!Number.isFinite(score) || !thresholds || ![thresholds.loose, thresholds.sensitive, thresholds.sure].every(Number.isFinite)) return false;
  if (thresholds.loose > thresholds.sensitive || thresholds.sensitive > thresholds.sure) return false;
  if (sensitivity(mode) === "strict") return kws === true && score > thresholds.loose;
  if (sensitivity(mode) === "sensitive") return score > thresholds.sensitive;
  return score > thresholds.sure || (kws === true && score > thresholds.loose);
}
// Both workers report on the AUDIO clock, never their wall-clock completion order.
function createCombiner(thresholds, mode = "balanced") {
  let last = -Infinity;
  let heads = [], spots = [];
  return {
    reset() { last = -Infinity; heads = []; spots = []; },
    push({ at, score, keyword }) {
      if (!Number.isFinite(at)) return false;
      if (Number.isFinite(score)) heads.push({ at, score });
      if (keyword) spots.push(at);
      heads = heads.filter((h) => h.at >= at - DEFAULTS.agreementMs);
      spots = spots.filter((t) => t >= at - DEFAULTS.agreementMs);
      if (at - last < DEFAULTS.cooldownMs) return false;
      const hit = heads.some((h) => combine(mode, h.score, spots.some((t) => Math.abs(t - h.at) <= DEFAULTS.agreementMs), thresholds));
      if (hit) { last = at; heads = []; spots = []; }
      return hit;
    },
  };
}
function checkRecording(samples) {
  if (!(samples instanceof Float32Array) || samples.length < 8000) return "short";
  if (samples.length > 80000) return "long";
  let energy = 0, clipped = 0, active = 0;
  for (const x of samples) {
    if (!Number.isFinite(x)) return "invalid";
    energy += x * x;
    if (Math.abs(x) >= 0.99) clipped++;
    if (Math.abs(x) > 0.015) active++;
  }
  if (clipped / samples.length > 0.005) return "clipped";
  if (Math.sqrt(energy / samples.length) < 0.008 || active < 1600) return "quiet";
  return "";
}
// No idle capture may borrow the authorization for a question or another audio channel.
function captureAllowed(channel, s) {
  if (channel === "wake") return s.wakeListening === true && s.indicator === true && !blocked(s);
  if (channel === "question") return s.held === true || s.handsFree === true || s.releaseTail === true || s.wakeQuestion === true;
  return false;
}
module.exports = { DEFAULTS, SPELLINGS, sensitivity, blocked, combine, createCombiner, checkRecording, captureAllowed };
