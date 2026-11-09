// Resumable speech-model download (PRODUCTION-PLAN P2.3): a local HTTP server serves a small real
// .tar.bz2 with Range support; ensureModel must resume a part on disk, survive a dropped connection,
// recover from a corrupt part through the pinned hash, and unpack only verified bytes.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { ensureModel, partFile, partialPct } = require("./stt.js");

// Test files live in the project's own tmp folder (never on C:).
const root = path.resolve(__dirname, "../../tmp/test-stt-resume");
const ARCHIVE = "fixture-model-2026";
let bytes: Buffer;
let server: http.Server;
let base = "";
// Per-test server behaviour and what it saw.
let mode: "range" | "ignore-range" | "drop-first" = "range";
let seenRanges: string[] = [];
let requests = 0;

beforeAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  const src = path.join(root, "src", ARCHIVE);
  fs.mkdirSync(src, { recursive: true });
  // Random content so bzip2 cannot shrink it to a few bytes: the archive must be big enough to split.
  for (const f of ["encoder.onnx", "tokens.txt"]) fs.writeFileSync(path.join(src, f), crypto.randomBytes(2 * 1024 * 1024));
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const out = path.join(root, "fixture.tar.bz2");
  execFileSync(tar, ["-cjf", out, "-C", path.join(root, "src"), ARCHIVE]);
  bytes = fs.readFileSync(out);
  server = http.createServer((req, res) => {
    requests++;
    const range = req.headers.range;
    if (range) seenRanges.push(range);
    const m = /^bytes=(\d+)-$/.exec(range || "");
    if (m && mode !== "ignore-range") {
      const start = Number(m[1]);
      if (start >= bytes.length) {
        res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
        return res.end();
      }
      res.writeHead(206, { "Content-Length": bytes.length - start, "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` });
      return res.end(bytes.subarray(start));
    }
    res.writeHead(200, { "Content-Length": bytes.length });
    if (mode === "drop-first" && requests === 1) {
      // Send half, then cut the connection like a dropped Wi-Fi. Bytes still in the client's write
      // buffer at that instant are lost (at most a few KB of a 475 MB file); what reached disk stays.
      res.write(bytes.subarray(0, Math.floor(bytes.length / 2)), () => setTimeout(() => res.destroy(), 300));
      return;
    }
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});

function spec() {
  return {
    id: "fixture-model",
    archive: ARCHIVE,
    url: `${base}/model.tar.bz2`,
    sizeBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    files: ["encoder.onnx", "tokens.txt"],
  };
}

function freshUserData(name: string) {
  const dir = path.join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  mode = "range";
  seenRanges = [];
  requests = 0;
  return dir;
}

async function run(userData: string, s = spec()) {
  const states: { state: string; pct: number; error?: string }[] = [];
  await ensureModel(userData, (st: { state: string; pct: number; error?: string }) => states.push(st), s);
  return states;
}

describe("speech model download resumes and verifies", () => {
  it("resumes a part on disk with a Range request and unpacks the verified archive", async () => {
    const ud = freshUserData("resume");
    const s = spec();
    const cut = Math.floor(bytes.length * 0.4);
    fs.writeFileSync(partFile(ud, s), bytes.subarray(0, cut));
    expect(partialPct(ud, s)).toBe(Math.floor((cut / bytes.length) * 100));
    const states = await run(ud, s);
    expect(states.at(-1)).toEqual({ state: "ready", pct: 100 });
    expect(seenRanges).toEqual([`bytes=${cut}-`]);
    expect(fs.readFileSync(path.join(ud, "models", "fixture-model", "tokens.txt")).length).toBe(2 * 1024 * 1024);
    expect(fs.existsSync(partFile(ud, s))).toBe(false);
    // Progress counts the bytes that were already there: it never shows less than the part held.
    const onDisk = Math.floor((cut / bytes.length) * 100);
    const shown = states.filter((x) => x.state === "downloading").map((x) => x.pct);
    expect(shown.length).toBeGreaterThan(0);
    expect(Math.min(...shown)).toBeGreaterThanOrEqual(onDisk);
  });

  it("turns a half-written archive left by 0.9.30 into the part and resumes it", async () => {
    const ud = freshUserData("legacy");
    const s = spec();
    const cut = Math.floor(bytes.length * 0.6);
    fs.writeFileSync(path.join(ud, "models", `${ARCHIVE}.tar.bz2`), bytes.subarray(0, cut));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(seenRanges).toEqual([`bytes=${cut}-`]);
    expect(fs.existsSync(path.join(ud, "models", `${ARCHIVE}.tar.bz2`))).toBe(false);
  });

  it("starts over when the server ignores the Range header (200 with the whole file)", async () => {
    const ud = freshUserData("ignore-range");
    mode = "ignore-range";
    const s = spec();
    fs.writeFileSync(partFile(ud, s), bytes.subarray(0, 100));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(seenRanges).toEqual(["bytes=100-"]);
  });

  it("skips the download when a complete part is already on disk", async () => {
    const ud = freshUserData("complete-part");
    const s = spec();
    fs.writeFileSync(partFile(ud, s), bytes);
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(requests).toBe(0);
  });

  it("deletes a corrupt part that fails the hash and downloads it again", async () => {
    const ud = freshUserData("corrupt");
    const s = spec();
    // Right length, wrong bytes: only the hash can tell.
    const bad = Buffer.from(bytes);
    bad[10] ^= 0xff;
    fs.writeFileSync(partFile(ud, s), bad);
    const states = await run(ud, s);
    expect(states.some((x) => /integrity/.test((x as { message?: string }).message || ""))).toBe(true);
    expect(states.at(-1)?.state).toBe("ready");
    expect(requests).toBe(1);
    expect(seenRanges).toEqual([]);
  }, 20_000);

  it("keeps what arrived when the connection drops and resumes it on the retry", async () => {
    const ud = freshUserData("drop");
    mode = "drop-first";
    const s = spec();
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(seenRanges.length).toBe(1);
    const resumedAt = Number(/bytes=(\d+)-/.exec(seenRanges[0])?.[1]);
    expect(resumedAt).toBeGreaterThan(0);
    expect(resumedAt).toBeLessThan(bytes.length);
  }, 20_000);

  it("deletes a part longer than the file and starts over", async () => {
    const ud = freshUserData("too-long");
    const s = spec();
    fs.writeFileSync(partFile(ud, s), Buffer.concat([bytes, Buffer.from("extra")]));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(seenRanges).toEqual([]);
  });
});
