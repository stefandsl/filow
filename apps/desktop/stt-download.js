// Stream helpers kept separate from HTTPS/filesystem orchestration for offline tests.
const { Transform, pipeline } = require("node:stream");
const { cancelError, isCancelled } = require("./model-files");

function idleTimeout(onTimeout, ms = 30_000) {
  let timer;
  const stop = () => clearTimeout(timer);
  const reset = () => { stop(); timer = setTimeout(() => onTimeout(new Error(`download idle for ${ms / 1000} s`)), ms); };
  reset();
  return { reset, stop };
}

function checkDownloadSize(received, contentLength) {
  if (contentLength === undefined) return;
  const expected = Number(contentLength);
  if (!Number.isSafeInteger(expected) || expected <= 0 || received !== expected) {
    throw new Error(`incomplete download: received ${received} bytes, expected ${contentLength}`);
  }
}

/** First byte offset of a "Content-Range: bytes 100-199/200" header, or null when absent or malformed. */
function contentRangeStart(header) {
  const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(String(header || "").trim());
  return m ? Number(m[1]) : null;
}

/** startAt: bytes already on disk when resuming, so progress counts the whole file. */
function receiveArchive(res, out, { contentLength, fallbackSize, onPct, startAt = 0, idleMs }) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let lastPct = -1;
    const total = contentLength ? startAt + Number(contentLength) : Number(fallbackSize);
    const idle = idleTimeout(err => res.destroy(err), idleMs);
    const aborted = () => out.destroy(new Error("download response aborted"));
    res.once("aborted", aborted);
    const count = new Transform({
      transform(chunk, _encoding, done) {
        if (chunk.length) idle.reset();
        received += chunk.length;
        // Progress is reported when the whole percent changes, not for every 16 KB chunk: callers write a
        // log line and tell every window each time, which for a 500 MB model was 30,000 times.
        if (total) {
          const pct = Math.min(99, Math.round((startAt + received) / total * 100));
          if (pct !== lastPct) { lastPct = pct; onPct(pct); }
        }
        done(null, chunk);
      },
      flush(done) {
        try { checkDownloadSize(received, contentLength); done(); }
        catch (err) { done(err); }
      },
    });
    // pipeline handles response/output errors and waits for the file to close before settling.
    pipeline(res, count, out, err => {
      idle.stop();
      res.removeListener("aborted", aborted);
      if (err) reject(err); else resolve();
    });
  });
}

const RETRY_DELAYS = [5000, 15000, 45000];
/**
 * Runs operation, again after 5, 15 and 45 s when it fails. A download the user stopped
 * (err.code "FILOW_CANCELLED") is never tried again, and `signal` ends the wait between two tries
 * at once: Stop must not be answered by a retry a few seconds later.
 */
async function retryDownload(operation, onAttempt, onRetry, signal, delays = RETRY_DELAYS) {
  for (let attempt = 1; ; attempt++) {
    if (signal && signal.aborted) throw cancelError();
    onAttempt(attempt);
    try { return await operation(); }
    catch (err) {
      const delay = delays[attempt - 1];
      if (delay === undefined || isCancelled(err) || (signal && signal.aborted)) throw signal && signal.aborted ? cancelError() : err;
      onRetry(attempt, delay, err);
      await new Promise((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(cancelError()); };
        const timer = setTimeout(() => { if (signal) signal.removeEventListener("abort", stop); resolve(); }, delay);
        if (signal) signal.addEventListener("abort", stop, { once: true });
      });
    }
  }
}

module.exports = { idleTimeout, checkDownloadSize, contentRangeStart, receiveArchive, retryDownload };
