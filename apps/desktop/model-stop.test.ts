// Stop a model download (owner report 2026-11-11: "if i clicked wrongly i want to be able to stop a model
// from downloading"). A local HTTP server drips a file slowly; Stop must close the connection, reject
// with the cancel code, leave no partial file (also in resume mode) and never be followed by a retry.
// Nothing here reaches the internet.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { download } = require("./download.js");
const { retryDownload } = require("./stt-download.js");
const { CANCELLED, cancelError, isCancelled, createDownloads } = require("./model-files.js");
const { ensureModel, ensureAll, partFile } = require("./stt.js");
const { createS1Runtime, wantModel } = require("./s1-runtime.js");
const { createTruecaseRuntime, FILES: TRUECASE_FILES } = require("./truecase-runtime.js");
const { installOllama } = require("./localai.js");
const { sha256File } = require("./integrity.js");

const SIZE = 4 * 1024 * 1024;
const bytes = crypto.randomBytes(SIZE);
let root = "";
let server: http.Server;
let base = "";
/** What the server saw: requests, their Range headers, and how many connections the client closed early. */
const seen = { requests: 0, ranges: [] as string[], closedEarly: 0, open: 0 };

beforeAll(async () => {
  root = tmpRoot("model-stop");
  server = http.createServer((req, res) => {
    seen.requests += 1;
    seen.open += 1;
    const range = /^bytes=(\d+)-$/.exec(String(req.headers.range || ""));
    const from = range ? Number(range[1]) : 0;
    if (range) seen.ranges.push(String(req.headers.range));
    res.writeHead(range ? 206 : 200, { "Content-Length": SIZE - from, ...(range ? { "Content-Range": `bytes ${from}-${SIZE - 1}/${SIZE}` } : {}) });
    // 32 KB every 15 ms: the whole file would take about two seconds, so a Stop always lands mid-way.
    let at = from;
    const timer = setInterval(() => {
      if (at >= SIZE) { clearInterval(timer); return void res.end(); }
      res.write(bytes.subarray(at, Math.min(SIZE, at + 32 * 1024)));
      at += 32 * 1024;
    }, 15);
    res.on("close", () => { clearInterval(timer); seen.open -= 1; if (at < SIZE) seen.closedEarly += 1; });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() => { seen.requests = 0; seen.ranges = []; seen.closedEarly = 0; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(test: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!test()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(10); }
}
function dir(name: string) {
  const d = path.join(root, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe("the registry of downloads in flight", () => {
  it("cancel aborts the signal of that id with the cancel code, once, and says whether anything was running", () => {
    const d = createDownloads();
    const signal = d.begin("speech");
    expect(d.begin("speech")).toBe(signal); // a second click joins the same download
    expect(d.active("speech")).toBe(true);
    expect(d.cancel("voice")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(d.cancel("speech")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(isCancelled(signal.reason)).toBe(true);
    expect(d.active("speech")).toBe(false);
    expect(d.cancel("speech")).toBe(false);
    // end() of an old download must not forget a newer one with the same id
    const next = d.begin("speech");
    d.end("speech", signal);
    expect(d.active("speech")).toBe(true);
    d.end("speech", next);
    expect(d.ids()).toEqual([]);
  });
});

describe("download() with a signal", { timeout: 15_000 }, () => {
  for (const resume of [false, true]) {
    it(`Stop mid-way closes the connection, rejects with ${CANCELLED} and deletes the partial file (resume: ${resume})`, async () => {
      const dest = path.join(dir(`dl-${resume}`), "model.bin.part");
      const ctl = new AbortController();
      let pct = -1;
      const run = download(`${base}/model.bin`, dest, { resume, signal: ctl.signal, onPct: (p: number) => { pct = p; } });
      await until(() => pct >= 3);
      expect(fs.statSync(dest).size).toBeGreaterThan(0);
      ctl.abort(cancelError());
      const err = await run.then(() => null, (e: Error & { code?: string }) => e);
      expect(err?.code).toBe(CANCELLED);
      expect(fs.existsSync(dest)).toBe(false);
      await until(() => seen.closedEarly === 1 && seen.open === 0);
      // nothing resumes it: no further request, no file coming back
      await sleep(300);
      expect(seen.requests).toBe(1);
      expect(fs.existsSync(dest)).toBe(false);
    });
  }

  it("a signal that is already aborted never opens a connection", async () => {
    const dest = path.join(dir("dl-aborted"), "model.bin.part");
    const ctl = new AbortController();
    ctl.abort(cancelError());
    await expect(download(`${base}/model.bin`, dest, { resume: true, signal: ctl.signal })).rejects.toMatchObject({ code: CANCELLED });
    expect(seen.requests).toBe(0);
  });

  it("without Stop, a failed resumable download still keeps its part (the old behaviour)", async () => {
    const dest = path.join(dir("dl-keeps"), "model.bin.part");
    fs.writeFileSync(dest, bytes.subarray(0, 1000));
    await expect(download("http://127.0.0.1:9/never", dest, { resume: true })).rejects.toThrow();
    expect(fs.statSync(dest).size).toBe(1000);
  });
});

describe("retryDownload", () => {
  it("never retries a download the user stopped", async () => {
    let attempts = 0;
    const retries: number[] = [];
    const err = await retryDownload(async () => { attempts += 1; throw cancelError(); }, () => {}, (n: number) => retries.push(n), undefined, [20, 20, 20]).then(() => null, (e: Error & { code?: string }) => e);
    expect(err?.code).toBe(CANCELLED);
    expect(attempts).toBe(1);
    expect(retries).toEqual([]);
  });

  it("Stop during the wait between two tries ends it at once, with no further try", async () => {
    const ctl = new AbortController();
    let attempts = 0;
    const t0 = Date.now();
    const run = retryDownload(async () => { attempts += 1; throw new Error("network down"); }, () => {}, () => {}, ctl.signal, [60_000, 60_000]);
    await sleep(50);
    ctl.abort(cancelError());
    const err = await run.then(() => null, (e: Error & { code?: string }) => e);
    expect(err?.code).toBe(CANCELLED);
    expect(attempts).toBe(1);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("still retries an ordinary failure", async () => {
    let attempts = 0;
    await expect(retryDownload(async () => { attempts += 1; if (attempts < 3) throw new Error("flaky"); return "ok"; }, () => {}, () => {}, undefined, [5, 5, 5])).resolves.toBe("ok");
    expect(attempts).toBe(3);
  });
});

describe("speech and voice models (stt.js ensureModel)", { timeout: 15_000 }, () => {
  const spec = () => ({ key: "fixture", id: "fixture-model", archive: "fixture-archive", url: `${base}/fixture.tar.bz2`, sizeBytes: SIZE, sha256: "0".repeat(64), files: ["a.onnx"] });

  it("Stop ends in the state 'cancelled' (never 'error'), deletes the part and is not retried", async () => {
    const userData = dir("stt-stop");
    const s = spec();
    // a part from an earlier try: Stop removes that too
    fs.mkdirSync(path.join(userData, "models"), { recursive: true });
    fs.writeFileSync(partFile(userData, s), bytes.subarray(0, 64 * 1024));
    const downloads = createDownloads();
    const states: Array<{ state: string; pct: number; error?: string }> = [];
    const run = ensureModel(userData, (st: { state: string; pct: number }) => states.push(st), s, { signal: downloads.begin("speech"), retryDelays: [20, 20, 20] });
    await until(() => states.some((x) => x.state === "downloading" && x.pct >= 5));
    expect(downloads.cancel("speech")).toBe(true);
    await run;
    expect(states.at(-1)).toEqual({ state: "cancelled", pct: 0 });
    expect(states.some((x) => x.state === "error")).toBe(false);
    expect(fs.readdirSync(path.join(userData, "models"))).toEqual([]);
    await sleep(200); // longer than every retry delay above
    expect(seen.requests).toBe(1);
    expect(seen.ranges).toEqual([`bytes=${64 * 1024}-`]);
    // A later Download starts cleanly, from the first byte.
    const again = createDownloads();
    const second: Array<{ state: string; pct: number }> = [];
    const rerun = ensureModel(userData, (st: { state: string; pct: number }) => second.push(st), s, { signal: again.begin("speech"), retryDelays: [20] });
    await until(() => second.some((x) => x.state === "downloading" && x.pct >= 2));
    expect(seen.ranges).toEqual([`bytes=${64 * 1024}-`]); // no Range on the second download
    expect(seen.requests).toBe(2);
    again.cancel("speech");
    await rerun;
  });

  it("ensureAll passes 'cancelled' on and does not go on to the next model", async () => {
    const userData = dir("stt-stop-all");
    const downloads = createDownloads();
    const states: Array<{ state: string; pct: number; model?: string }> = [];
    const first = spec();
    const second = { ...spec(), key: "second", id: "second-model", archive: "second-archive", url: `${base}/second.tar.bz2` };
    const run = ensureAll(userData, [first, second], (st: { state: string; pct: number }) => states.push(st), { signal: downloads.begin("speech"), retryDelays: [20] });
    await until(() => states.some((x) => x.state === "downloading" && x.pct >= 2));
    downloads.cancel("speech");
    await run;
    expect(states.at(-1)).toMatchObject({ state: "cancelled", pct: 0, model: "fixture" });
    expect(states.some((x) => x.state === "ready" || x.state === "error")).toBe(false);
    expect(seen.requests).toBe(1);
  });
});

describe("S1-mini and the punctuation model", { timeout: 15_000 }, () => {
  it("S1-mini: Stop deletes the part, reports no error, and the wish to download at the next start is not kept by a stop", async () => {
    const userData = dir("s1-stop");
    const log: string[] = [];
    const rt = createS1Runtime({ userData, logLine: (l: string) => log.push(l), spawn: () => { throw new Error("not started in this test"); }, download, sha256File, serverFile: () => "llama-server", modelUrl: `${base}/s1.gguf` });
    let wish = false;
    expect(wantModel(rt, { set: (v: boolean) => { wish = v; } })).toEqual({ started: true });
    expect(wish).toBe(true);
    await until(() => rt.status().downloading && rt.status().pct >= 1);
    const part = path.join(userData, "models", "s1-mini", "s1-mini-q4_k_m.gguf.part");
    expect(fs.existsSync(part)).toBe(true);
    expect(rt.cancelFetch()).toBe(true);
    await until(() => !rt.status().downloading);
    expect(rt.status()).toMatchObject({ model: false, downloading: false, pct: 0, error: "" });
    expect(fs.existsSync(part)).toBe(false);
    expect(log.join("\n")).toMatch(/stopped by the user/);
    expect(log.join("\n")).not.toMatch(/failed/);
    expect(rt.cancelFetch()).toBe(false);
    await sleep(200);
    expect(seen.requests).toBe(1);
  });

  it("punctuation: Stop removes the whole folder, the files already finished included", async () => {
    const userData = dir("truecase-stop");
    const log: string[] = [];
    const folder = path.join(userData, "models", "truecase-small");
    // The first three files are "done" already; the last one drips.
    const hashes = new Map<string, string>();
    const rt = createTruecaseRuntime({
      userData, logLine: (l: string) => log.push(l), fork: () => { throw new Error("not started in this test"); }, runtimeFile: () => "x",
      download: async (url: string, dest: string, opts: Record<string, unknown>) => {
        if (!url.endsWith("model_quantized.onnx")) { fs.writeFileSync(dest, "small"); return; }
        return download(`${base}/model_quantized.onnx`, dest, opts);
      },
      sha256File: async (file: string) => hashes.get(path.basename(file)) ?? "",
      fileUrl: (f: { name: string }) => `${base}/${f.name}`,
    });
    for (const f of TRUECASE_FILES as Array<{ name: string; sha256: string }>) hashes.set(`${f.name}.part`, f.sha256);
    const run = rt.fetchModel();
    await until(() => fs.existsSync(path.join(folder, "model_quantized.onnx.part")) && fs.statSync(path.join(folder, "model_quantized.onnx.part")).size > 0);
    expect(fs.existsSync(path.join(folder, "tokenizer.json"))).toBe(true);
    expect(rt.cancelFetch()).toBe(true);
    expect(await run).toBe(false);
    expect(fs.existsSync(folder)).toBe(false);
    expect(rt.status()).toMatchObject({ model: false, downloading: false, pct: 0, error: "" });
    expect(log.join("\n")).toMatch(/stopped by the user/);
    expect(log.join("\n")).not.toMatch(/failed/);
  });
});

describe("the Ollama installer download", { timeout: 15_000 }, () => {
  it("Stop goes back to idle (not an error) and leaves no partial installer", async () => {
    const binDir = dir("ollama-stop");
    const downloads = createDownloads();
    const states: Array<{ state: string; pct: number; error: string; code: string }> = [];
    const log: string[] = [];
    const run = installOllama(binDir, (s: { state: string; pct: number; error: string; code: string }) => states.push(s), {
      findExe: () => "", version: async () => "", platform: "win32", urls: { win32: `${base}/OllamaSetup.exe` }, signal: downloads.begin("ollama-installer"), log: (l: string) => log.push(l),
    });
    await until(() => states.some((s) => s.state === "downloading" && s.pct >= 2));
    downloads.cancel("ollama-installer");
    await run;
    expect(states.at(-1)).toMatchObject({ state: "idle", error: "", code: "" });
    expect(states.some((s) => s.state === "error" || s.state === "installing")).toBe(false);
    expect(fs.readdirSync(binDir)).toEqual([]);
    expect(log.join("\n")).toMatch(/stopped by the user/);
  });
});
