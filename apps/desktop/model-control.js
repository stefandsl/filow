// The models Filow keeps in its profile, for Settings: what is on disk, what is in use, and the two
// things the user can do with them: stop a download, delete a model. One list, one "stop by id", one
// "delete by id" for every kind (speech, natural voice, S1-mini, punctuation) and for the two other
// downloads (the Ollama installer, cloudflared). main.js wires the IPC and hands in the parts.
const path = require("node:path");
const { sizeOf } = require("./model-files");
const { modelUse } = require("./model-use");

/** Ids that are downloads only (nothing to list or delete). */
const DOWNLOAD_ONLY = ["speech", "ollama-installer", "cloudflared"];

/**
 * deps: { userData, logLine, downloads (model-files.js createDownloads), stt (stt.js), tts (tts.js),
 *   speech: { language(), job(), clearJob(), downloading(): Promise|null, release(): Promise, loaded(): [keys], changed() },
 *   voice(): the wired voice ({ usable(), loaded(), remove() }) or null,
 *   okFilow(): { enabled, voice, offline } or null, dictation(): { enabled, language, cleanup, punctuate },
 *   cleanup(): the S1-mini runtime, punctuation(): the punctuation runtime (status, cancelFetch, remove),
 *   clearWish(kind): forget "download this at the next start" for "cleanup" | "punctuation" }
 */
function createModelControl(deps) {
  const log = deps.logLine || (() => {});
  const models = path.join(deps.userData, "models");
  const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

  /** { models: [{ id, kind, name, installed, bytes, uses: [{ use, language }], loaded }], downloading: [ids] } */
  function status() {
    const ok = deps.okFilow ? deps.okFilow() : null;
    const voice = deps.voice ? deps.voice() : null;
    const s1 = deps.cleanup().status();
    const tc = deps.punctuation().status();
    const use = modelUse({
      speech: { installed: deps.stt.installedKeys(deps.userData), language: deps.speech.language() },
      // The voice that speaks: a cloud voice while offline is the system voice (the panel shows it so).
      okFilow: { enabled: Boolean(ok && ok.enabled), voice: ok ? (ok.offline && ok.voice === "cloud" ? "system" : ok.voice) : "off", voiceUsable: Boolean(voice && voice.usable()) },
      dictation: deps.dictation ? deps.dictation() : {},
      cleanup: { installed: s1.model, runtime: s1.runtime },
      punctuation: { installed: tc.model, runtime: tc.runtime },
    });
    const loadedSpeech = deps.speech.loaded();
    const rows = deps.stt.modelsOnDisk(deps.userData).map((m) => ({
      id: `speech:${m.key}`, kind: "speech", name: m.label, installed: m.installed, bytes: m.bytes, uses: use.speech[m.key] || [], loaded: loadedSpeech.includes(m.key),
    }));
    const others = [
      { id: "voice", kind: "voice", name: "Supertonic 3", installed: deps.tts.modelReady(deps.userData), bytes: deps.stt.specBytes(deps.userData, deps.tts.MODEL), uses: use.voice, loaded: Boolean(voice && voice.loaded()) },
      { id: "cleanup", kind: "cleanup", name: "S1-mini by Superwhisper", installed: s1.model, bytes: sizeOf(path.join(models, "s1-mini")), uses: use.cleanup, loaded: s1.running },
      { id: "punctuation", kind: "punctuation", name: "Horizon Labs truecase-small", installed: tc.model, bytes: sizeOf(path.join(models, "truecase-small")), uses: use.punctuation, loaded: tc.running },
    ].filter((m) => m.bytes > 0);
    const downloading = [...deps.downloads.ids(), ...(s1.downloading ? ["cleanup"] : []), ...(tc.downloading ? ["punctuation"] : [])];
    return { models: [...rows, ...others], downloading };
  }

  /** Stop the download with this id. { ok, stopped }: stopped is false when nothing was downloading. */
  function cancel(id) {
    let stopped;
    if (id === "cleanup" || id === "punctuation") {
      stopped = deps[id]().cancelFetch();
      // Without this the next start of Filow would resume the download by itself.
      deps.clearWish(id);
    } else if (id === "voice" || DOWNLOAD_ONLY.includes(id)) stopped = deps.downloads.cancel(id);
    else return { ok: false, stopped: false, error: "unknown download" };
    log(`models: stop asked for ${id}: ${stopped ? "the download was stopped by the user" : "nothing was downloading"}`);
    return { ok: true, stopped };
  }

  /** Delete the model with this id completely. { ok, freedBytes } or { ok: false, error }. */
  async function remove(id) {
    try {
      let freed = 0;
      if (typeof id === "string" && id.startsWith("speech:")) {
        const key = id.slice("speech:".length);
        const job = deps.speech.job();
        if (job && job.key === key) {
          deps.downloads.cancel("speech");
          await deps.speech.downloading();
          deps.speech.clearJob();
        }
        // The recognizers hold the model files open: they are stopped first and start again on demand.
        await deps.speech.release();
        freed = deps.stt.removeModel(deps.userData, key);
        deps.speech.changed();
      } else if (id === "voice") {
        const voice = deps.voice ? deps.voice() : null;
        freed = voice ? (await voice.remove()).freedBytes : deps.tts.removeModel(deps.userData);
      } else if (id === "cleanup" || id === "punctuation") {
        deps.clearWish(id);
        freed = await deps[id]().remove();
      } else return { ok: false, error: "unknown model" };
      log(`models: ${id} deleted by the user (${mb(freed)} freed)`);
      return { ok: true, freedBytes: freed };
    } catch (err) {
      const error = String((err && err.message) || err).slice(0, 200);
      log(`models: ${id} could not be deleted: ${error}`);
      return { ok: false, error };
    }
  }

  return { status, cancel, remove };
}

module.exports = { createModelControl };
