// The welcome's "speech setup" step (docs/welcome/ONBOARDING-V2.md): the hardware recommendation and what is
// already installed in, the plain offer the step shows out. It replaces the first-start native dialog, which
// opened behind the splash and listed five model names. Track T2 (setup profiles) fills `profile`; the shape
// of the offer stays the same.

/** Models a take cannot start without: the speech model and a local decision model. */
const TAKE_MODELS = new Set(["nemotron-streaming", "clef-flash", "clef"]);

/** Ollama /api/tags to bare model names ("clef-flash:latest" -> "clef-flash"). */
function installedModels(tags) {
  const list = tags && Array.isArray(tags.models) ? tags.models : [];
  return list.map((m) => String(m && m.name || "").replace(/:latest$/, "")).filter(Boolean);
}

/** What is installed right now; never throws (Ollama down = not running, nothing pulled). */
async function probeSetup({ fetchJson, sherpaReady }) {
  const tags = await Promise.resolve().then(fetchJson).catch(() => null);
  let sherpa;
  try { sherpa = Boolean(sherpaReady()); } catch { sherpa = false; }
  return { sherpa, ollamaRunning: tags !== null, ollamaModels: installedModels(tags) };
}

function isInstalled(name, catalog, installed) {
  if (name === "nemotron-streaming") return installed.sherpa;
  if (catalog[name] && catalog[name].ollama) return installed.ollamaModels.some((m) => String(m).replace(/:latest$/, "") === name);
  return false; // browser models (Whisper) live in the page cache, which the main process cannot see
}

/**
 * hw: { ramGb, platform }, rec: { models, ollama } from the recommendation, catalog: sizes and labels,
 * installed: probeSetup(), online: network up, installerChose: the installer already picked models.
 */
function setupOffer({ hw, rec, catalog, installed, online, installerChose = false, profile = null }) {
  const missing = rec.models.filter((n) => !isInstalled(n, catalog, installed));
  const downloadGb = Math.round(missing.reduce((s, n) => s + (catalog[n] ? catalog[n].dl : 0), 0) * 10) / 10;
  return {
    ask: !installerChose && rec.models.length > 0,
    ready: !missing.some((n) => TAKE_MODELS.has(n)),
    downloadGb,
    needsOllama: Boolean(rec.ollama) && !installed.ollamaRunning && missing.some((n) => catalog[n] && catalog[n].ollama),
    labels: rec.models.map((n) => (catalog[n] && catalog[n].label) || n),
    device: hw.platform === "darwin" ? "mac" : "pc",
    ramGb: hw.ramGb,
    online: Boolean(online),
    profile,
  };
}

/** The step's answer as main() expects install choices: null = download nothing now. */
function setupChoice(offer, rec, accept) {
  if (!accept || !offer.online || offer.ready) return null;
  return { models: rec.models, ollama: Boolean(rec.ollama) };
}

/**
 * The offer needs a hardware scan that can take seconds on a slow PC (and, while it is synchronous, holds
 * the main process). So it is never computed before the welcome window is on screen: get() before open()
 * waits, and the scan starts one turn after open(), once the show has gone out. Computed once; a failed
 * scan is not kept, so the next get() tries again.
 */
function createOfferGate(compute, defer = (fn) => setTimeout(fn, 0)) {
  let opened;
  const shown = new Promise((resolve) => { opened = resolve; });
  let pending = null;
  return {
    open() { opened(); },
    get() {
      if (!pending) {
        pending = shown.then(() => new Promise((resolve) => defer(resolve))).then(compute);
        pending.catch(() => { pending = null; });
      }
      return pending;
    },
  };
}

module.exports = { TAKE_MODELS, installedModels, probeSetup, setupOffer, setupChoice, createOfferGate };
