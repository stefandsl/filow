import { createRequire } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
const { idleTimeout, checkDownloadSize, receiveArchive, retryDownload } = createRequire(import.meta.url)("./stt-download.js");

afterEach(() => vi.useRealTimers());
function transfer(contentLength: string | undefined = "4") {
  const res = new PassThrough();
  const chunks: Buffer[] = [];
  const out = new Writable({ write(c, _e, done) { chunks.push(c); done(); } });
  const onPct = vi.fn();
  const result = receiveArchive(res, out, { contentLength, fallbackSize: 4, onPct });
  return { res, out, chunks, onPct, result };
}
describe("model download helpers (no network)", () => {
  it("resets a 30 s idle deadline and stops it on cleanup", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    const idle = idleTimeout(abort);
    await vi.advanceTimersByTimeAsync(29999);
    expect(abort).not.toHaveBeenCalled();
    idle.reset();
    await vi.advanceTimersByTimeAsync(29999);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(abort).toHaveBeenCalledOnce();
    idle.reset(); idle.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(abort).toHaveBeenCalledOnce();
  });
  it("validates exact size, rejects short/oversized/invalid responses, permits absent header", () => {
    expect(() => checkDownloadSize(4, "4")).not.toThrow();
    for (const size of [0, 3, 5]) expect(() => checkDownloadSize(size, "4")).toThrow("incomplete");
    for (const header of ["invalid", "-1", "0"]) expect(() => checkDownloadSize(4, header)).toThrow();
    expect(() => checkDownloadSize(4, undefined)).not.toThrow();
  });
  it("streams bytes, resets idle on data and settles only after output closes", async () => {
    vi.useFakeTimers();
    const f = transfer();
    f.res.write(Buffer.from("ab"));
    await vi.advanceTimersByTimeAsync(29000);
    f.res.write(Buffer.from("cd"));
    await vi.advanceTimersByTimeAsync(29000);
    expect(f.res.destroyed).toBe(false);
    f.res.end();
    await f.result;
    expect(Buffer.concat(f.chunks).toString()).toBe("abcd");
    expect(f.out.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reports progress once per whole percent, not once per chunk (callers log and tell every window each time)", async () => {
    const res = new PassThrough();
    const out = new Writable({ write(_c, _e, done) { done(); } });
    const seen: number[] = [];
    const result = receiveArchive(res, out, { contentLength: String(5000 * 16), fallbackSize: 0, onPct: (p: number) => seen.push(p) });
    for (let i = 0; i < 5000; i++) res.write(Buffer.alloc(16));
    res.end();
    await result;
    expect(seen.length).toBeLessThanOrEqual(100);
    expect(seen.length).toBeGreaterThan(90);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.at(-1)).toBe(99);
  });
  it("aborts a stalled fake response and closes the output before rejecting", async () => {
    vi.useFakeTimers();
    const f = transfer();
    const rejected = expect(f.result).rejects.toThrow("idle");
    f.res.write(Buffer.from("ab"));
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(f.out.closed).toBe(true);
    expect(f.res.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["aborted", "error", "short", "output error"])("rejects %s without hanging", async failure => {
    const f = transfer();
    const rejected = expect(f.result).rejects.toThrow();
    f.res.write(Buffer.from("ab"));
    if (failure === "short") f.res.end();
    else if (failure === "aborted") f.res.emit("aborted");
    else if (failure === "output error") f.out.destroy(new Error("disk full"));
    else f.res.destroy(new Error("connection reset"));
    await rejected;
    expect(f.out.closed).toBe(true);
  });
  it("retries three times with 5/15/45 s backoff, then surfaces the last error", async () => {
    vi.useFakeTimers();
    const work = vi.fn().mockRejectedValue(new Error("offline"));
    const attempt = vi.fn(), retry = vi.fn();
    const result = retryDownload(work, attempt, retry);
    const rejected = expect(result).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    for (const [index, delay] of [5000, 15000, 45000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(work).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await rejected;
    expect(attempt.mock.calls.map(c => c[0])).toEqual([1, 2, 3, 4]);
    expect(retry.mock.calls.map(c => c[1])).toEqual([5000, 15000, 45000]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops retrying on success", async () => {
    vi.useFakeTimers();
    const work = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValue("ok");
    const result = retryDownload(work, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });
});
