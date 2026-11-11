// Stopping a model download and deleting a model, for every model the desktop shell keeps in its
// profile (speech, natural voice, S1-mini, punctuation) and for its other downloads (the Ollama
// installer, cloudflared). One registry of the downloads in flight, keyed by a model id, and one
// guarded delete: nothing outside the folder it was given can be removed.
const fs = require("node:fs");
const path = require("node:path");

/** err.code of a download the user stopped. It is a choice, not a failure: no retry, no error line. */
const CANCELLED = "FILOW_CANCELLED";
function cancelError() {
  const err = new Error("download stopped by the user");
  err.code = CANCELLED;
  return err;
}
const isCancelled = (err) => Boolean(err && err.code === CANCELLED);

/**
 * The downloads in flight. begin(id) gives the AbortSignal for the downloader; cancel(id) aborts it
 * (false when nothing with that id is running); end(id, signal) forgets it once the download settled.
 */
function createDownloads() {
  const running = new Map();
  return {
    begin(id) {
      const old = running.get(id);
      if (old) return old.signal; // a second click joins the download that is running
      const ctl = new AbortController();
      running.set(id, ctl);
      return ctl.signal;
    },
    end(id, signal) {
      const ctl = running.get(id);
      if (ctl && (!signal || ctl.signal === signal)) running.delete(id);
    },
    cancel(id) {
      const ctl = running.get(id);
      if (!ctl) return false;
      running.delete(id);
      ctl.abort(cancelError());
      return true;
    },
    active: (id) => running.has(id),
    ids: () => [...running.keys()],
  };
}

/** True when `target` is a path strictly inside `root` (not root itself, not a sibling, not above). */
function isInside(root, target) {
  if (typeof root !== "string" || typeof target !== "string" || !root || !target) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !path.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..";
}

/** Bytes on disk under a file or folder; 0 when it is not there. */
function sizeOf(target) {
  let st;
  try { st = fs.lstatSync(target); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of fs.readdirSync(target)) total += sizeOf(path.join(target, name));
  return total;
}

/**
 * Deletes `target` (a file or a whole folder) and returns the bytes it held. It throws, and deletes
 * nothing, unless target is inside `root`: a wrong id, a crafted name or a bug can not reach the
 * user's other files. A link is removed as a link; what it points to is never followed.
 * Windows keeps a file busy for a moment after its process ended: the delete is retried.
 */
function removeInside(root, target) {
  if (!isInside(root, target)) throw new Error(`refused to delete outside the models folder: ${target}`);
  const bytes = sizeOf(target);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return bytes;
}

module.exports = { CANCELLED, cancelError, isCancelled, createDownloads, isInside, sizeOf, removeInside };
