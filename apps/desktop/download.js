// The one downloader of the desktop shell: speech models (stt.js), the Ollama installer (localai.js)
// and cloudflared (main.js). It follows redirects (never https -> http), gives up on a connection that
// stays silent, checks the length the server announced, and reports progress. Each caller still
// verifies what it downloaded (pinned SHA-256, Authenticode, codesign, GitHub digest) before using it.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { idleTimeout, contentRangeStart, receiveArchive } = require("./stt-download");

/**
 * Downloads url into dest. Options:
 * - onPct(0-99): progress; fallbackSize: the expected size when the server sends no Content-Length.
 * - resume: dest may already hold the start of the file; it is continued with an HTTP Range request
 *   and kept when the download fails, so the next try resumes it. Safe only because the caller checks
 *   a pinned hash before use. Without resume, dest is written from the start and deleted when the
 *   download fails: no partial file is left behind.
 * - idleMs: how long the connection may stay silent (default 30 s).
 * Only https, or plain http when the first URL is http (local test servers).
 */
function download(url, dest, opts = {}) {
  const run = fetchInto(url, dest, { hops: 5, ...opts });
  if (opts.resume) return run;
  return run.catch((err) => {
    fs.rmSync(dest, { force: true });
    throw err;
  });
}

function fetchInto(url, dest, opts) {
  const { onPct = () => {}, fallbackSize = 0, resume = false, idleMs, hops } = opts;
  return new Promise((resolve, reject) => {
    let response;
    let req;
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
