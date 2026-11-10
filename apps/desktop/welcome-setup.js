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

/**
 * What is installed right now; never throws (Ollama down = not running, nothing pulled). browserCache:
 * whether the app's page cache holds anything at all (the Whisper models live there; the main process
 * cannot look inside it, but an empty cache means they are certainly missing).
 */
async function probeSetup({ fetchJson, sherpaReady, browserCache = () => true }) {
  const tags = await Promise.resolve().then(fetchJson).catch(() => null);
  let sherpa, cache;
  try { sherpa = Boolean(sherpaReady()); } catch { sherpa = false; }
  try { cache = Boolean(browserCache()); } catch { cache = true; }
  return { sherpa, ollamaRunning: tags !== null, ollamaModels: installedModels(tags), browserCache: cache };
}

/** true, false, or null when it cannot be known here (a browser model with a non-empty page cache). */
function isInstalled(name, catalog, installed) {
  if (name === "nemotron-streaming") return installed.sherpa;
  if (catalog[name] && catalog[name].ollama) return installed.ollamaModels.some((m) => String(m).replace(/:latest$/, "") === name);
  return installed.browserCache === false ? false : null;
}

/** Recommended models not known to be installed (unknown ones included: the settings page skips what it finds). */
function toInstall(rec, catalog, installed) {
  return rec.models.filter((n) => isInstalled(n, catalog, installed) !== true);
}

/**
 * hw: { ramGb, platform }, rec: { models, ollama } from the recommendation, catalog: sizes and labels,
 * installed: probeSetup(), online: network up, installerChose: the installer already picked models.
 */
function setupOffer({ hw, rec, catalog, installed, online, installerChose = false, profile = null }) {
  const missing = toInstall(rec, catalog, installed);
  // The size counts only what is known to be missing: a Whisper model that may already be cached is not added.
  const known = missing.filter((n) => isInstalled(n, catalog, installed) === false);
  const downloadGb = Math.round(known.reduce((s, n) => s + (catalog[n] ? catalog[n].dl : 0), 0) * 10) / 10;
  return {
    ask: !installerChose && rec.models.length > 0,
    // ready: a first take needs nothing more. The rest of the recommendation (slides, screen helper) is
    // still offered, as an optional download of downloadGb (review T3 finding 4).
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

/**
 * The step's answer as main() expects install choices: null = download nothing now. Only what is not
 * known to be installed; the step offers a download only when that has a size (offer.downloadGb > 0).
 */
function setupChoice(offer, rec, accept, catalog, installed) {
  if (!accept || !offer.online || !(offer.downloadGb > 0)) return null;
  const models = toInstall(rec, catalog, installed);
  if (!models.length) return null;
  return { models, ollama: Boolean(rec.ollama) && models.some((n) => catalog[n] && catalog[n].ollama) };
}

/**
 * The welcome's answer as saved in settings.json (review T3 finding 8: quitting between the welcome and
 * the server check must not bring the native question back). Read back only in its exact shape, with
 * model names from the catalog; anything else = no saved answer.
 */
function savedSetupAnswer(saved, catalog) {
  if (!saved || typeof saved !== "object" || !("choice" in saved)) return null;
  const c = saved.choice;
  if (c === null) return { choice: null };
  if (!c || typeof c !== "object" || !Array.isArray(c.models) || typeof c.ollama !== "boolean") return null;
  if (!c.models.length || !c.models.every((n) => typeof n === "string" && Object.prototype.hasOwnProperty.call(catalog, n))) return null;
  return { choice: { models: [...c.models], ollama: c.ollama } };
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

module.exports = { TAKE_MODELS, installedModels, probeSetup, setupOffer, setupChoice, savedSetupAnswer, createOfferGate };
