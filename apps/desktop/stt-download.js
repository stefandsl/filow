// Stream helpers kept separate from HTTPS/filesystem orchestration for offline tests.
const { Transform, pipeline } = require("node:stream");

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
    const total = contentLength ? startAt + Number(contentLength) : Number(fallbackSize);
    const idle = idleTimeout(err => res.destroy(err), idleMs);
    const aborted = () => out.destroy(new Error("download response aborted"));
    res.once("aborted", aborted);
    const count = new Transform({
      transform(chunk, _encoding, done) {
        if (chunk.length) idle.reset();
        received += chunk.length;
        if (total) onPct(Math.min(99, Math.round((startAt + received) / total * 100)));
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
async function retryDownload(operation, onAttempt, onRetry) {
  for (let attempt = 1; ; attempt++) {
    onAttempt(attempt);
    try { return await operation(); }
    catch (err) {
      const delay = RETRY_DELAYS[attempt - 1];
      if (delay === undefined) throw err;
      onRetry(attempt, delay, err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = { idleTimeout, checkDownloadSize, contentRangeStart, receiveArchive, retryDownload };
