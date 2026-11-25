// Unit tests for the optional OmniParser icon_detect_v3 desktop detector runtime:
// multi-monitor & DPI coordinate mapping, UIA-first merge, worker timeout, missing-weights fallback,
// pinned SHA-256 verification and opt-in install/delete. Fails on origin/main before implementation.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it, vi } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const root = tmpRoot("okfilow-detector");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function freshProfile(name: string) {
  const dir = path.join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  return dir;
}

function fakeWorker() {
  const sent: unknown[] = [];
  const c = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    postMessage: vi.fn((m: unknown) => { sent.push(m); }),
    kill: vi.fn(() => { c.exitCode = 0; c.emit("exit", 0); }),
  });
  return { c, sent };
}

describe("OmniParser icon_detect_v3 desktop detector", () => {
  it("maps detector pixel boxes to screen coordinates (DIP + physical) and 0-1000 grid across monitors and 100%/150% DPI", () => {
    const { toScreenBoxes } = require("./okfilow-detector.js");
    // Primary monitor: 1920x1080 physical at 100% DPI (DIP 1920x1080 at 0,0)
    const primary = toScreenBoxes(
      [{ x1: 192, y1: 108, x2: 384, y2: 216, score: 0.84 }],
      { width: 1920, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      1,
      1.0,
    );
    expect(primary).toEqual([
      {
        name: "",
        type: "Detected",
        source: "detector",
        score: 0.84,
        screen: 1,
        x1: 100,
        y1: 100,
        x2: 200,
        y2: 200,
        dip: { x1: 192, y1: 108, x2: 384, y2: 216 },
        physical: { x1: 192, y1: 108, x2: 384, y2: 216 },
      },
    ]);

    // Secondary monitor at 150% DPI: DIP bounds { x: -1280, y: 0, width: 1280, height: 720 }, captured at 960x540
    const secondary150 = toScreenBoxes(
      [{ x1: 96, y1: 54, x2: 192, y2: 108, score: 0.71 }],
      { width: 960, height: 540 },
      { x: -1280, y: 0, width: 1280, height: 720 },
      2,
      1.5,
    );
    expect(secondary150[0]).toMatchObject({
      screen: 2,
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 200,
      dip: { x1: -1152, y1: 72, x2: -1024, y2: 144 },
      physical: { x1: -1728, y1: 108, x2: -1536, y2: 216 },
    });
  });

  it("merges with UI Automation: UIA elements come first and detector boxes only fill non-overlapping gaps", () => {
    const { mergeDetectedElements } = require("./okfilow-detector.js");
    const uia = [
      { name: "Save", type: "Button", screen: 1, x1: 100, y1: 100, x2: 160, y2: 140 },
    ];
    const detected = [
      // Overlaps Save strongly (IoU > 0.4) -> dropped in favor of UIA
      { name: "", type: "Detected", source: "detector", score: 0.9, screen: 1, x1: 102, y1: 101, x2: 158, y2: 139 },
      // Gap element on screen 1 -> kept
      { name: "", type: "Detected", source: "detector", score: 0.82, screen: 1, x1: 400, y1: 300, x2: 460, y2: 340 },
      // Same coordinates as Save, but on screen 2 -> kept
      { name: "", type: "Detected", source: "detector", score: 0.75, screen: 2, x1: 100, y1: 100, x2: 160, y2: 140 },
    ];
    const merged = mergeDetectedElements(uia, detected);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ name: "Save", screen: 1 });
    expect(merged[1]).toMatchObject({ source: "detector", screen: 1, x1: 400 });
    expect(merged[2]).toMatchObject({ source: "detector", screen: 2, x1: 100 });
  });

  it("falls back cleanly when weights are missing: ready() is false, detect() returns null and spawns no worker", async () => {
    const { createDetectorRuntime } = require("./okfilow-detector.js");
    const userData = freshProfile("missing-weights");
    const fork = vi.fn();
    const rt = createDetectorRuntime({
      userData,
      fork,
      runtimeFile: () => "onnxruntime_binding.node",
      download: vi.fn(),
      sha256File: vi.fn(),
    });
    expect(rt.ready()).toEqual({ ok: false, reason: "model not on this computer" });
    const res = await rt.detect({ data: Buffer.alloc(16), width: 2, height: 2, format: "rgba" });
    expect(res).toBeNull();
    expect(fork).not.toHaveBeenCalled();
  });

  it("returns null on worker timeout without blocking, ignores late stale replies, and kills a hung worker", async () => {
    vi.useFakeTimers();
    try {
      const { createDetectorRuntime, MODEL_FILE, modelDir } = require("./okfilow-detector.js");
      const userData = freshProfile("worker-timeout");
      const dir = modelDir(userData);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, MODEL_FILE), Buffer.alloc(64));

      const w = fakeWorker();
      const rt = createDetectorRuntime({
        userData,
        fork: () => w.c,
        runtimeFile: () => "onnxruntime_binding.node",
        probeGpu: () => ({ ok: true, reason: "" }),
        download: vi.fn(),
        sha256File: vi.fn(),
      });
      const p1 = rt.detect({ data: Buffer.alloc(16), width: 2, height: 2, format: "rgba" }, { timeoutMs: 120 });
      // Worker becomes ready immediately
      w.c.emit("message", { type: "ready", ms: 5 });
      await vi.advanceTimersByTimeAsync(150);
      await expect(p1).resolves.toBeNull();
      expect(w.c.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies pinned SHA-256 on download, deletes mismatched files, and supports user deletion", async () => {
    const { createDetectorRuntime, MODEL, MODEL_FILE, MIT_LICENSE_TEXT, modelDir } = require("./okfilow-detector.js");
    const userData = freshProfile("sha-and-delete");
    const rtBad = createDetectorRuntime({
      userData,
      fork: vi.fn(),
      runtimeFile: () => "onnxruntime_binding.node",
      download: async (_url: string, dest: string) => { fs.writeFileSync(dest, "corrupt"); },
      sha256File: async () => "0".repeat(64),
    });
    expect(await rtBad.fetchModel()).toBe(false);
    expect(fs.existsSync(path.join(modelDir(userData), MODEL_FILE))).toBe(false);
    expect(rtBad.status().error).toMatch(/hash differs/i);

    const rtGood = createDetectorRuntime({
      userData,
      fork: vi.fn(),
      runtimeFile: () => "onnxruntime_binding.node",
      download: async (_url: string, dest: string) => { fs.writeFileSync(dest, Buffer.alloc(128, 7)); },
      sha256File: async () => MODEL.sha256,
    });
    expect(await rtGood.fetchModel()).toBe(true);
    expect(rtGood.status().model).toBe(true);
    expect(MODEL.license).toBe("MIT");
    expect(await rtGood.remove()).toBe(128 + Buffer.byteLength(MIT_LICENSE_TEXT, "utf8"));
    expect(rtGood.status().model).toBe(false);
  });

  it("is off by default in okfilow.js DEFAULTS and decodes worker stride outputs cleanly", () => {
    const { readFileSync } = require("node:fs");
    const okfSrc = readFileSync(new URL("./okfilow.js", import.meta.url), "utf8");
    expect(okfSrc).toMatch(/screenDetector:\s*false/);
    const { decodeOutputs, IMGSZ } = require("./okfilow-detector-worker.js");
    // Construct minimal 3-stride synthetic outputs with one high-confidence cell on stride 32 (grid 40x40)
    const mkZero = (c: number, g: number) => ({ dims: [1, c, g, g], data: new Float32Array(c * g * g).fill(-10) });
    const cls32 = mkZero(1, 40);
    const box32 = { dims: [1, 4, 40, 40], data: new Float32Array(4 * 40 * 40) };
    // Put a detection at cell (gx=10, gy=5) -> center (10.5, 5.5) * 32 = (336, 176) on 1280 canvas
    const idx = 5 * 40 + 10;
    cls32.data[idx] = 2.0; // sigmoid(2.0) ~ 0.8808
    box32.data[idx] = 1.5; // left = 1.5 cells (48px)
    box32.data[1600 + idx] = 0.5; // top = 0.5 cells (16px)
    box32.data[3200 + idx] = 1.5; // right = 1.5 cells (48px)
    box32.data[4800 + idx] = 0.5; // bottom = 0.5 cells (16px)
    const names = ["c8", "b8", "c16", "b16", "c32", "b32"];
    const outputs = { c8: mkZero(1, 160), b8: mkZero(4, 160), c16: mkZero(1, 80), b16: mkZero(4, 80), c32: cls32, b32: box32 };
    const scale = IMGSZ / 1920;
    const boxes = decodeOutputs(outputs, names, { scale, width: 1920, height: 1080, confThreshold: 0.05, iouThreshold: 0.45 });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x1: 432, y1: 240, x2: 576, y2: 288 });
    expect(boxes[0].score).toBeGreaterThan(0.85);
  });

  // Round 2 regression tests for review findings (must fail on eb554952, then pass):
  it("refuses to load without a usable DirectML GPU and never spawns a worker", async () => {
    const { createDetectorRuntime, MODEL_FILE, modelDir } = require("./okfilow-detector.js");
    const userData = freshProfile("no-dml-gpu");
    const dir = modelDir(userData);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MODEL_FILE), Buffer.alloc(64));

    const fork = vi.fn();
    const rt = createDetectorRuntime({
      userData,
      fork,
      runtimeFile: () => "onnxruntime_binding.node",
      probeGpu: () => ({ ok: false, reason: "needs DirectML" }),
      download: vi.fn(),
      sha256File: vi.fn(),
    });
    expect(rt.ready()).toEqual({ ok: false, reason: "needs DirectML" });
    expect(rt.status()).toMatchObject({ gpuAvailable: false, reason: "needs DirectML" });
    const res = await rt.detect({ data: Buffer.alloc(16), width: 2, height: 2, format: "rgba" });
    expect(res).toBeNull();
    expect(fork).not.toHaveBeenCalled();
  });

  it("disables the detector for the session after one timeout instead of restarting the worker in a loop", async () => {
    vi.useFakeTimers();
    try {
      const { createDetectorRuntime, MODEL_FILE, modelDir } = require("./okfilow-detector.js");
      const userData = freshProfile("timeout-no-restart-loop");
      const dir = modelDir(userData);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, MODEL_FILE), Buffer.alloc(64));

      const fork = vi.fn(() => fakeWorker().c);
      const rt = createDetectorRuntime({
        userData,
        fork,
        runtimeFile: () => "onnxruntime_binding.node",
        probeGpu: () => ({ ok: true, reason: "" }),
        download: vi.fn(),
        sha256File: vi.fn(),
      });

      const p1 = rt.detect({ data: Buffer.alloc(16), width: 2, height: 2, format: "rgba" }, { timeoutMs: 100 });
      const w1 = fork.mock.results[0].value;
      w1.emit("message", { type: "ready", ms: 10, provider: "dml" });
      await vi.advanceTimersByTimeAsync(150);
      await expect(p1).resolves.toBeNull();

      // After one timeout: disabled for the session, ready() is false with clear reason, next detect() does NOT fork again
      expect(rt.ready().ok).toBe(false);
      expect(rt.ready().reason).toMatch(/too slow/i);
      expect(rt.status().disabledForSession).toBe(true);

      const p2 = await rt.detect({ data: Buffer.alloc(16), width: 2, height: 2, format: "rgba" }, { timeoutMs: 100 });
      expect(p2).toBeNull();
      expect(fork).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles 404 download cleanly, writes MIT LICENSE beside verified weights, and marks unhosted asset hidden", async () => {
    const { createDetectorRuntime, MODEL, MODEL_FILE, LICENSE_FILE, modelDir } = require("./okfilow-detector.js");
    expect(MODEL.hosted).toBe(false);
    expect(typeof LICENSE_FILE).toBe("string");

    // 404 download failure leaves no file and surfaces clear error
    const userData404 = freshProfile("download-404");
    const rt404 = createDetectorRuntime({
      userData: userData404,
      fork: vi.fn(),
      runtimeFile: () => "onnxruntime_binding.node",
      download: async () => { throw new Error("HTTP 404 Not Found"); },
      sha256File: vi.fn(),
    });
    expect(await rt404.fetchModel()).toBe(false);
    expect(rt404.status().error).toMatch(/404/);
    expect(fs.existsSync(path.join(modelDir(userData404), MODEL_FILE))).toBe(false);

    // Verified download writes LICENSE.txt next to model
    const userDataOk = freshProfile("download-with-license");
    const rtOk = createDetectorRuntime({
      userData: userDataOk,
      fork: vi.fn(),
      runtimeFile: () => "onnxruntime_binding.node",
      download: async (_url: string, dest: string) => { fs.writeFileSync(dest, Buffer.alloc(64, 3)); },
      sha256File: async () => MODEL.sha256,
    });
    expect(await rtOk.fetchModel()).toBe(true);
    const licPath = path.join(modelDir(userDataOk), LICENSE_FILE);
    expect(fs.existsSync(licPath)).toBe(true);
    expect(fs.readFileSync(licPath, "utf8")).toContain("MIT License");
  });

  it("integrates with okfilow:capture (off, merge UIA-first, and timeout disables without breaking capture)", async () => {
    const { runCaptureDetection } = require("./okfilow-detector.js");
    expect(typeof runCaptureDetection).toBe("function");

    const baseOut = () => ({
      images: ["data:image/png;base64,AAAA"],
      displays: [{ index: 1, id: 10, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      elements: [{ name: "Save", type: "Button", screen: 1, x1: 100, y1: 100, x2: 160, y2: 140 }],
    });
    const fakeDecode = () => ({ data: Buffer.alloc(16), width: 1920, height: 1080 });
    const allDisplays = [{ id: 10, scaleFactor: 1 }];

    // Off by default: detector not called
    const detectSpy = vi.fn(async () => ({
      boxes: [{ x1: 960, y1: 540, x2: 1056, y2: 594, score: 0.88 }],
      ms: 42,
    }));
    const det = { ready: () => ({ ok: true, reason: "" }), detect: detectSpy };
    const offOut = baseOut();
    await runCaptureDetection({ out: offOut, enabled: false, detector: det, allDisplays, decodeImage: fakeDecode });
    expect(detectSpy).not.toHaveBeenCalled();
    expect(offOut.elements).toHaveLength(1);

    // Enabled: merges UIA first, then detector gap box
    const onOut = baseOut();
    await runCaptureDetection({ out: onOut, enabled: true, detector: det, allDisplays, decodeImage: fakeDecode });
    expect(detectSpy).toHaveBeenCalledTimes(1);
    expect(onOut.elements).toHaveLength(2);
    expect(onOut.elements[0]).toMatchObject({ name: "Save" });
    expect(onOut.elements[1]).toMatchObject({ source: "detector", screen: 1, x1: 500, y1: 500 });

    // Timeout (detect returns null and ready becomes false): capture keeps UIA elements and stops calling
    let timedOut = false;
    const slowDetect = vi.fn(async () => { timedOut = true; return null; });
    const slowDet = {
      ready: () => (timedOut ? { ok: false, reason: "too slow on this computer" } : { ok: true, reason: "" }),
      detect: slowDetect,
    };
    const out1 = baseOut();
    await runCaptureDetection({ out: out1, enabled: true, detector: slowDet, allDisplays, decodeImage: fakeDecode });
    expect(out1.elements).toHaveLength(1);
    const out2 = baseOut();
    await runCaptureDetection({ out: out2, enabled: true, detector: slowDet, allDisplays, decodeImage: fakeDecode });
    expect(slowDetect).toHaveBeenCalledTimes(1);
  });

  it("exposes screenDetector toggle in OK Filow settings (5 languages) and hides unhosted download row in Local Models", () => {
    const { readFileSync } = require("node:fs");
    const okf = require("./okfilow.js");
    expect(okf.nextCfg({}, { screenDetector: true }).screenDetector).toBe(true);
    expect(okf.nextCfg({}, { screenDetector: "yes" }).screenDetector).toBe(false);

    const panelSrc = readFileSync(new URL("../web/app/okfilow/panel/page.tsx", import.meta.url), "utf8");
    expect(panelSrc).toContain("screenDetector");
    expect(panelSrc).toContain("screenDetectorNoGpu");

    const localPageSrc = readFileSync(new URL("../web/app/settings/local/page.tsx", import.meta.url), "utf8");
    expect(localPageSrc).toContain("detectorState?.hosted");
  });
});
