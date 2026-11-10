// Resumable speech-model download (PRODUCTION-PLAN P2.3): a local HTTP server serves a small real
// .tar.bz2 with Range support; ensureModel must resume a part on disk, survive a dropped connection,
// recover from a corrupt part through the pinned hash, and unpack only verified bytes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";
import { startArchiveServer, type ArchiveServer } from "./test-archive-server";

const require = createRequire(import.meta.url);
const { ensureModel, partFile, partialPct } = require("./stt.js");

const root = tmpRoot("stt-resume");
const ARCHIVE = "fixture-model-2026";
let srv: ArchiveServer;

beforeAll(async () => {
  // The archive must be big enough to split: two 2 MB random files.
  srv = await startArchiveServer(root, ARCHIVE, ["encoder.onnx", "tokens.txt"], 2 * 1024 * 1024);
});

afterAll(async () => {
  await srv.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function spec() {
  return {
    id: "fixture-model",
    archive: ARCHIVE,
    url: `${srv.base}/model.tar.bz2`,
    sizeBytes: srv.bytes.length,
    sha256: srv.sha256,
    files: ["encoder.onnx", "tokens.txt"],
  };
}

function freshUserData(name: string) {
  const dir = path.join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  srv.reset();
  return dir;
}

async function run(userData: string, s = spec()) {
  const states: { state: string; pct: number; error?: string }[] = [];
  await ensureModel(userData, (st: { state: string; pct: number; error?: string }) => states.push(st), s);
  return states;
}

// Each case hashes and unpacks a real archive: on a busy PC that passes the default 5 s.
describe("speech model download resumes and verifies", { timeout: 20_000 }, () => {
  it("resumes a part on disk with a Range request and unpacks the verified archive", async () => {
    const ud = freshUserData("resume");
    const s = spec();
    const cut = Math.floor(srv.bytes.length * 0.4);
    fs.writeFileSync(partFile(ud, s), srv.bytes.subarray(0, cut));
    expect(partialPct(ud, s)).toBe(Math.floor((cut / srv.bytes.length) * 100));
    const states = await run(ud, s);
    expect(states.at(-1)).toEqual({ state: "ready", pct: 100 });
    expect(srv.seenRanges).toEqual([`bytes=${cut}-`]);
    expect(fs.readFileSync(path.join(ud, "models", "fixture-model", "tokens.txt")).length).toBe(2 * 1024 * 1024);
    expect(fs.existsSync(partFile(ud, s))).toBe(false);
    // Progress counts the bytes that were already there: it never shows less than the part held.
    const onDisk = Math.floor((cut / srv.bytes.length) * 100);
    const shown = states.filter((x) => x.state === "downloading").map((x) => x.pct);
    expect(shown.length).toBeGreaterThan(0);
    expect(Math.min(...shown)).toBeGreaterThanOrEqual(onDisk);
  });

  it("turns a half-written archive left by 0.9.30 into the part and resumes it", async () => {
    const ud = freshUserData("legacy");
    const s = spec();
    const cut = Math.floor(srv.bytes.length * 0.6);
    fs.writeFileSync(path.join(ud, "models", `${ARCHIVE}.tar.bz2`), srv.bytes.subarray(0, cut));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.seenRanges).toEqual([`bytes=${cut}-`]);
    expect(fs.existsSync(path.join(ud, "models", `${ARCHIVE}.tar.bz2`))).toBe(false);
  });

  it("starts over when the server ignores the Range header (200 with the whole file)", async () => {
    const ud = freshUserData("ignore-range");
    srv.mode = "ignore-range";
    const s = spec();
    fs.writeFileSync(partFile(ud, s), srv.bytes.subarray(0, 100));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.seenRanges).toEqual(["bytes=100-"]);
  });

  it("skips the download when a complete part is already on disk", async () => {
    const ud = freshUserData("complete-part");
    const s = spec();
    fs.writeFileSync(partFile(ud, s), srv.bytes);
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.requests).toBe(0);
  });

  it("deletes a corrupt part that fails the hash and downloads it again", async () => {
    const ud = freshUserData("corrupt");
    const s = spec();
    // Right length, wrong bytes: only the hash can tell.
    const bad = Buffer.from(srv.bytes);
    bad[10] ^= 0xff;
    fs.writeFileSync(partFile(ud, s), bad);
    const states = await run(ud, s);
    expect(states.some((x) => /integrity/.test((x as { message?: string }).message || ""))).toBe(true);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.requests).toBe(1);
    expect(srv.seenRanges).toEqual([]);
  }, 20_000);

  it("keeps what arrived when the connection drops and resumes it on the retry", async () => {
    const ud = freshUserData("drop");
    srv.mode = "drop-first";
    const s = spec();
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.seenRanges.length).toBe(1);
    const resumedAt = Number(/bytes=(\d+)-/.exec(srv.seenRanges[0])?.[1]);
    expect(resumedAt).toBeGreaterThan(0);
    expect(resumedAt).toBeLessThan(srv.bytes.length);
  }, 20_000);

  it("deletes a part longer than the file and starts over", async () => {
    const ud = freshUserData("too-long");
    const s = spec();
    fs.writeFileSync(partFile(ud, s), Buffer.concat([srv.bytes, Buffer.from("extra")]));
    const states = await run(ud, s);
    expect(states.at(-1)?.state).toBe("ready");
    expect(srv.seenRanges).toEqual([]);
  });
});
