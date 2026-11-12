// The one downloader of the desktop shell: speech models (stt.js), the Ollama installer (localai.js)
// and cloudflared (main.js). It follows redirects (never https -> http), gives up on a connection that
// stays silent, checks the length the server announced, and reports progress. Each caller still
// verifies what it downloaded (pinned SHA-256, Authenticode, codesign, GitHub digest) before using it.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { idleTimeout, contentRangeStart, receiveArchive } = require("./stt-download");
const { cancelError, isCancelled } = require("./model-files");

/**
 * Downloads url into dest. Options:
 * - onPct(0-99): progress; fallbackSize: the expected size when the server sends no Content-Length.
 * - resume: dest may already hold the start of the file; it is continued with an HTTP Range request
 *   and kept when the download fails, so the next try resumes it. Safe only because the caller checks
 *   a pinned hash before use. Without resume, dest is written from the start and deleted when the
 *   download fails: no partial file is left behind.
 * - idleMs: how long the connection may stay silent (default 30 s).
 * - signal: an AbortSignal (model-files.js createDownloads). Aborting it is the user's "Stop": the
 *   connection is closed at once, the promise rejects with err.code "FILOW_CANCELLED", and dest is
 *   deleted even with resume, so a click by mistake leaves nothing on disk.
 * Only https, or plain http when the first URL is http (local test servers).
 */
function download(url, dest, opts = {}) {
  const run = fetchInto(url, dest, { hops: 5, ...opts });
  return run.catch((err) => {
    // A resumable part is kept for the next try, unless the user stopped the download.
    if (opts.resume && !isCancelled(err)) throw err;
    // A fresh file can be held a moment by an antivirus scan: retry, and never let a failed delete
    // hide the download's own error.
    try {
      fs.rmSync(dest, { force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* the next download writes the file from the start */
    }
    throw err;
  });
}

function fetchInto(url, dest, opts) {
  const { onPct = () => {}, fallbackSize = 0, resume = false, idleMs, hops, signal } = opts;
  return new Promise((done, fail) => {
    let response;
    let req;
    if (signal && signal.aborted) return fail(cancelError());
    // Stop: closing the request ends the transfer; once writing, the response is destroyed so the
    // file is closed before the promise settles (Windows can then delete it).
    const onAbort = () => {
      const err = cancelError();
      if (response) response.destroy(err);
      if (req) req.destroy(err);
    };
    const forget = () => { if (signal) signal.removeEventListener("abort", onAbort); };
    const resolve = (v) => { forget(); done(v); };
    // Whatever error the closed connection produced, a stopped download says "stopped".
    const reject = (e) => { forget(); fail(signal && signal.aborted && !isCancelled(e) ? cancelError() : e); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const offset = resume && fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const headers = { "User-Agent": "Filow" };
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    const idle = idleTimeout((err) => req?.destroy(err), idleMs);
    try {
      const client = new URL(url).protocol === "http:" ? http : https;
      req = client.get(url, { headers }, (res) => {
        idle.stop();
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.destroy();
          try {
            if (new URL(url).protocol === "https:" && new URL(res.headers.location, url).protocol !== "https:") throw new Error("download redirected away from https");
            return fetchInto(new URL(res.headers.location, url).href, dest, { ...opts, hops: hops - 1 }).then(resolve, reject);
          } catch (err) {
            return reject(err);
          }
        }
        const resumed = offset > 0 && res.statusCode === 206 && contentRangeStart(res.headers["content-range"]) === offset;
        if (offset > 0 && (res.statusCode === 416 || (res.statusCode === 206 && !resumed))) {
          // The part on disk does not line up with the file on the server (changed, or already longer).
          res.destroy();
          fs.rmSync(dest, { force: true });
          return reject(new Error("the partial download did not match the server; starting over"));
        }
        if (res.statusCode !== 200 && !resumed) {
          res.destroy();
          return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        }
        response = res;
        // 200 to a Range request means the server sent the whole file: write it from the start.
        receiveArchive(res, fs.createWriteStream(dest, { flags: resumed ? "a" : "w" }), {
          contentLength: res.headers["content-length"], fallbackSize, onPct, startAt: resumed ? offset : 0, idleMs,
        }).then(resolve, reject);
      });
      req.on("error", (err) => {
        idle.stop();
        // Once writing, settle through pipeline so Windows can delete the closed file.
        if (response) response.destroy(err);
        else reject(err);
      });
    } catch (err) {
      idle.stop();
      reject(err);
    }
  });
}

module.exports = { download };
