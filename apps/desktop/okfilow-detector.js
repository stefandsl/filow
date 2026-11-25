// Optional local screen element detector for OK Filow (pilot, off by default):
// Microsoft OmniParser icon_detect_v3 (YOLOv9-E MIT implementation, MultimediaTechLab/YOLO).
// Runs in an isolated Electron utilityProcess using the bundled onnxruntime-node so UI never blocks.
// Downloaded only when the user explicitly chooses it; verified against a pinned SHA-256; deletable.
const fs = require("node:fs");
const path = require("node:path");
const { cancelError, isCancelled, removeInside } = require("./model-files");
const { runtimeFile } = require("./truecase-runtime");
const { exited } = require("./s1-runtime");

const GRID = 1000;
const MAX_ELEMENTS = 600;
const MODEL_ID = "omniparser-icon-detect-v3";
const MODEL_NAME = "OmniParser icon_detect_v3";
const MODEL_FILE = "icon_detect_v3.onnx";
const LICENSE_FILE = "LICENSE.txt";
const MODEL_LICENSE = "MIT";
const SOURCE_REPO = "microsoft/OmniParser-v2.0";
const SOURCE_REVISION = "f55d0750e5b94db2125ef0b45b0fa4a85ddc59b4";
const SOURCE_GH_COMMIT = "354021201345a96178360b28733573e27269f2de";
const SOURCE_PT_SHA256 = "11c6cbb77f22569fab22d86c76407a83ec81ab89dbfe28279854822d6e3fb00c";
const SOURCE_PT_BYTES = 281182680;

const ONNX_BYTES = 232285620;
const ONNX_SHA256 = "f630193b6eb035bf2d0efedd2dc97b3328481bd3ac541c3a30878fe13b07a175";

// Pinned ONNX export derived from microsoft/OmniParser-v2.0 icon_detect_v3/model.pt (MIT).
// `hosted: false` until the verified ONNX asset is published on a release feed (prevents dead 404 download UI).
const MODEL = {
  id: MODEL_ID,
  name: MODEL_NAME,
  file: MODEL_FILE,
  licenseFile: LICENSE_FILE,
  license: MODEL_LICENSE,
  hosted: false,
  bytes: ONNX_BYTES,
  sha256: ONNX_SHA256,
  sourceRepo: SOURCE_REPO,
  sourceRevision: SOURCE_REVISION,
  sourceGhCommit: SOURCE_GH_COMMIT,
  sourcePtSha256: SOURCE_PT_SHA256,
  sourcePtBytes: SOURCE_PT_BYTES,
  url: `https://github.com/stefandsl/filow-releases/releases/download/models-omniparser-v3/${MODEL_FILE}`,
};

const MIT_LICENSE_TEXT = [
  "Microsoft OmniParser icon_detect_v3 (ONNX export)",
  `Source: https://huggingface.co/${SOURCE_REPO} (revision ${SOURCE_REVISION}, icon_detect_v3/model.pt)`,
  "",
  "MIT License",
  "Copyright (c) Microsoft Corporation.",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  "of this software and associated documentation files (the \"Software\"), to deal",
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  "",
  "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
  "",
  "Upstream YOLOv9-E base (MultimediaTechLab/YOLO):",
  "MIT License",
  "Copyright (c) 2024 Kin-Yiu Wong and Hao-Tang Tsui",
  "",
].join("\n");

const DETECT_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 10_000;
const IDLE_UNLOAD_MS = 10 * 60_000;
const OVERLAP_IOU = 0.4;

const modelDir = (userData) => path.join(userData, "models", MODEL_ID);
const modelPath = (userData) => path.join(modelDir(userData), MODEL_FILE);
const licensePath = (userData) => path.join(modelDir(userData), LICENSE_FILE);

/**
 * Quick synchronous host check for DirectML availability before any worker starts:
 * DirectML exists only on Windows with DirectML.dll either next to the bundled runtime or in System32.
 */
function defaultProbeGpu(rtFile, platform = process.platform) {
  if (platform !== "win32") return { ok: false, reason: "needs DirectML" };
  const sysDml = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "DirectML.dll");
  const localDml = rtFile ? path.join(path.dirname(rtFile), "DirectML.dll") : "";
  if ((localDml && fs.existsSync(localDml)) || fs.existsSync(sysDml)) {
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: "needs DirectML" };
}

const r1 = (v) => Math.round(v * 10) / 10;
const clampGrid = (v) => Math.max(0, Math.min(GRID, r1(v)));

/**
 * Maps detector boxes (in captured image pixels) to:
 * - 0-1000 grid coordinates for `screen` (what ground.ts uses),
 * - global DIP coordinates (`dip`) for Electron overlays,
 * - global physical pixel coordinates (`physical`) accounting for display DPI (`scaleFactor`).
 */
function toScreenBoxes(rawBoxes, imageSize, displayRect, screen, scaleFactor = 1) {
  if (!Array.isArray(rawBoxes) || !imageSize || !(imageSize.width > 0) || !(imageSize.height > 0)) return [];
  if (!displayRect || !(displayRect.width > 0) || !(displayRect.height > 0)) return [];
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const out = [];
  for (const b of rawBoxes) {
    if (!b || typeof b !== "object") continue;
    const nums = [b.x1, b.y1, b.x2, b.y2].map(Number);
    if (!nums.every(Number.isFinite) || nums[2] <= nums[0] || nums[3] <= nums[1]) continue;
    const fx1 = Math.max(0, Math.min(1, nums[0] / imageSize.width));
    const fy1 = Math.max(0, Math.min(1, nums[1] / imageSize.height));
    const fx2 = Math.max(0, Math.min(1, nums[2] / imageSize.width));
    const fy2 = Math.max(0, Math.min(1, nums[3] / imageSize.height));
    if (fx2 <= fx1 || fy2 <= fy1) continue;
    const gx1 = clampGrid(fx1 * GRID);
    const gy1 = clampGrid(fy1 * GRID);
    const gx2 = clampGrid(fx2 * GRID);
    const gy2 = clampGrid(fy2 * GRID);
    if (gx2 <= gx1 || gy2 <= gy1) continue;
    const dipX1 = r1(displayRect.x + fx1 * displayRect.width);
    const dipY1 = r1(displayRect.y + fy1 * displayRect.height);
    const dipX2 = r1(displayRect.x + fx2 * displayRect.width);
    const dipY2 = r1(displayRect.y + fy2 * displayRect.height);
    const score = Number.isFinite(Number(b.score)) ? Math.round(Number(b.score) * 10000) / 10000 : 0;
    out.push({
      name: "",
      type: "Detected",
      source: "detector",
      score,
      screen,
      x1: gx1,
      y1: gy1,
      x2: gx2,
      y2: gy2,
      dip: { x1: dipX1, y1: dipY1, x2: dipX2, y2: dipY2 },
      physical: { x1: r1(dipX1 * sf), y1: r1(dipY1 * sf), x2: r1(dipX2 * sf), y2: r1(dipY2 * sf) },
    });
  }
  return out;
}

function gridIou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

/**
 * Merges UI Automation elements with detector boxes: UIA elements always come first,
 * and detector boxes only fill gaps where UIA has no overlapping element on the same screen.
 */
function mergeDetectedElements(uiaElements, detectedElements, opts = {}) {
  const maxElements = Math.max(1, Number(opts.maxElements) || MAX_ELEMENTS);
  const overlapIou = typeof opts.overlapIou === "number" ? opts.overlapIou : OVERLAP_IOU;
  const uia = Array.isArray(uiaElements) ? uiaElements.slice(0, maxElements) : [];
  if (!Array.isArray(detectedElements) || !detectedElements.length || uia.length >= maxElements) return uia;

  const out = [...uia];
  for (const det of detectedElements) {
    if (out.length >= maxElements) break;
    if (!det || typeof det !== "object") continue;
    const covered = uia.some((u) => u && u.screen === det.screen && gridIou(u, det) >= overlapIou);
    if (!covered) out.push(det);
  }
  return out;
}

/**
 * Runs optional detector inference over captured screenshots and merges UIA-first elements.
 * Never throws; stops immediately if disabled, unready, or timed out for the session.
 */
async function runCaptureDetection({ out, enabled, detector, allDisplays, getAllDisplays, decodeImage }) {
  if (!enabled || !out || !Array.isArray(out.images) || !out.images.length) return out;
  if (!detector || !detector.ready().ok) return out;
  const displays = Array.isArray(allDisplays) ? allDisplays : (typeof getAllDisplays === "function" ? getAllDisplays() : []);
  const detected = [];
  for (let i = 0; i < out.images.length; i++) {
    if (!detector.ready().ok) break;
    const disp = out.displays && out.displays[i];
    if (!disp) continue;
    try {
      const frame = decodeImage(out.images[i]);
      if (!frame || !frame.data || !(frame.width > 0) || !(frame.height > 0)) continue;
      const res = await detector.detect({ data: frame.data, width: frame.width, height: frame.height, format: frame.format || "bgra" });
      if (res && Array.isArray(res.boxes) && res.boxes.length) {
        const match = displays.find((d) => d && d.id === disp.id);
        const sf = match && match.scaleFactor ? match.scaleFactor : 1;
        detected.push(...toScreenBoxes(res.boxes, { width: frame.width, height: frame.height }, disp.bounds, disp.index, sf));
      }
    } catch {
      /* detector errors never break capture */
    }
  }
  if (detected.length) out.elements = mergeDetectedElements(out.elements, detected);
  return out;
}

/**
 * deps: { userData, logLine?, fork(script), download, sha256File, threads?, provider?,
 *         runtimeFile?(), modelExists?(file), probeGpu?(), platform?, startTimeoutMs?, idleMs?, fileUrl?(model) }
 */
function createDetectorRuntime(deps) {
  const log = deps.logLine || (() => {});
  const dir = () => modelDir(deps.userData);
  const file = () => modelPath(deps.userData);
  const rtPath = () => (deps.runtimeFile ? deps.runtimeFile() : runtimeFile());
  const hasRuntime = () => Boolean(rtPath());
  const hasModel = () => (deps.modelExists ? deps.modelExists(file()) : fs.existsSync(file()));
  const st = deps.setTimeout || setTimeout;
  const ct = deps.clearTimeout || clearTimeout;

  const initialProbe = deps.probeGpu ? deps.probeGpu() : defaultProbeGpu(rtPath(), deps.platform || process.platform);
  let gpuAvailable = Boolean(initialProbe && initialProbe.ok);
  let gpuReason = gpuAvailable ? "" : (initialProbe && initialProbe.reason) || "needs DirectML";

  let child = null;
  let starting = null;
  let lastError = "";
  let disabledForSession = false;
  let disabledReason = "";
  let startedMs = 0;
  let activeProvider = "";
  let idleTimer = null;
  let nextId = 1;
  const waiting = new Map();

  function touch() {
    ct(idleTimer);
    idleTimer = st(() => {
      if (!child) return;
      log("okfilow-detector: idle unload, releasing worker memory");
      stop();
    }, deps.idleMs || IDLE_UNLOAD_MS);
    if (idleTimer && idleTimer.unref) idleTimer.unref();
  }

  function disableSession(reason) {
    disabledForSession = true;
    disabledReason = reason || "too slow on this computer";
    lastError = disabledReason;
  }

  function resetSession() {
    if (!gpuAvailable) return false;
    disabledForSession = false;
    disabledReason = "";
    lastError = "";
    return true;
  }

  function ready() {
    if (!hasRuntime()) return { ok: false, reason: "runtime not in this build" };
    if (!hasModel()) return { ok: false, reason: "model not on this computer" };
    if (!gpuAvailable) return { ok: false, reason: gpuReason || "needs DirectML" };
    if (disabledForSession) return { ok: false, reason: disabledReason || "too slow on this computer" };
    if (lastError && !child) return { ok: false, reason: `runtime did not start: ${lastError}` };
    return { ok: true, reason: "" };
  }

  function failAll(why) {
    for (const w of waiting.values()) {
      ct(w.timer);
      w.resolve(null);
    }
    waiting.clear();
    if (why) lastError = why;
  }

  function start() {
    if (child) return Promise.resolve(true);
    if (starting) return starting;
    if (!ready().ok) return Promise.resolve(false);
    starting = new Promise((resolve) => {
      const t0 = Date.now();
      const script = path.join(__dirname, "okfilow-detector-worker.js").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
      let c;
      try {
        c = deps.fork(script);
      } catch (e) {
        disableSession(String((e && e.message) || e).slice(0, 100));
        return resolve(false);
      }
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        ct(timer);
        resolve(ok);
      };
      const timer = st(() => {
        disableSession("too slow on this computer");
        try { c.kill(); } catch { /* gone */ }
        done(false);
      }, deps.startTimeoutMs || START_TIMEOUT_MS);

      c.on("message", (m) => {
        if (!m || typeof m !== "object") return;
        if (m.type === "ready") {
          child = c;
          lastError = "";
          startedMs = Date.now() - t0;
          activeProvider = m.provider || "dml";
          touch();
          log(`okfilow-detector: loaded in ${startedMs} ms (${activeProvider})`);
          done(true);
        } else if (m.type === "failed") {
          const reason = String(m.reason || m.error || "worker init failed").slice(0, 120);
          if (/directml/i.test(reason)) {
            gpuAvailable = false;
            gpuReason = "needs DirectML";
          }
          disableSession(reason);
          try { c.kill(); } catch { /* gone */ }
          done(false);
        } else if ((m.type === "done" || m.type === "error") && waiting.has(m.id)) {
          const w = waiting.get(m.id);
          waiting.delete(m.id);
          ct(w.timer);
          if (m.type === "done" && Array.isArray(m.boxes)) w.resolve({ boxes: m.boxes, ms: Number(m.ms) || 0 });
          else w.resolve(null);
        }
      });

      c.on("exit", (code) => {
        if (child === c) {
          child = null;
          log(`okfilow-detector: worker exited (code ${code})`);
        }
        failAll("");
        done(false);
      });

      const threads = Math.max(1, Math.min(4, Number(deps.threads ? deps.threads() : 4) || 4));
      const provider = deps.provider || "dml";
      c.postMessage({ type: "init", modelPath: file(), threads, provider });
    }).finally(() => {
      starting = null;
    });
    return starting;
  }

  /**
   * Runs detection on one raw RGBA/BGRA image frame in the worker.
   * Resolves `{ boxes, ms }` or `null` on missing weights, missing DirectML GPU, error, or timeout.
   * On timeout, kills the worker and disables detection for the rest of the session (no restart loop).
   */
  async function detect(frame, opts = {}) {
    if (!ready().ok) return null;
    if (!frame || !frame.data || !(frame.width > 0) || !(frame.height > 0)) return null;
    const timeoutMs = Math.max(20, Math.round(opts.timeoutMs || DETECT_TIMEOUT_MS));
    const ok = await start();
    if (!ok || !child) return null;
    touch();
    const c = child;
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = st(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        disableSession("too slow on this computer");
        log(`okfilow-detector: timed out after ${timeoutMs} ms, disabled for this session`);
        if (child === c) child = null;
        try { c.kill(); } catch { /* gone */ }
        resolve(null);
      }, timeoutMs);
      waiting.set(id, { resolve, timer });
      try {
        c.postMessage({
          type: "detect",
          id,
          data: frame.data,
          width: frame.width,
          height: frame.height,
          format: frame.format || "rgba",
          confThreshold: opts.confThreshold,
          iouThreshold: opts.iouThreshold,
          maxBoxes: opts.maxBoxes,
        });
      } catch {
        waiting.delete(id);
        ct(timer);
        resolve(null);
      }
    });
  }

  async function verifyDownload(partFile, expectedSha) {
    const sha = await deps.sha256File(partFile);
    if (sha === expectedSha) return;
    try { fs.rmSync(partFile, { force: true }); } catch { /* ignore */ }
    throw new Error("downloaded detector file hash differs from pinned SHA-256; deleted");
  }

  let fetching = null;
  let stopFetch = null;
  let pct = 0;
  let fetchError = "";

  function fetchModel() {
    if (hasModel()) return Promise.resolve(true);
    if (fetching) return stopFetch ? fetching : fetching.then(() => fetchModel());
    const ctl = new AbortController();
    fetchError = "";
    pct = 0;
    stopFetch = () => ctl.abort(cancelError());
    fetching = (async () => {
      fs.mkdirSync(dir(), { recursive: true });
      const dest = file();
      const part = `${dest}.part`;
      const url = deps.fileUrl ? deps.fileUrl(MODEL) : MODEL.url;
      log(`okfilow-detector: downloading ${MODEL.name} (${Math.round(MODEL.bytes / 1024 / 1024)} MiB, ${MODEL.license})`);
      await deps.download(url, part, {
        resume: true,
        fallbackSize: MODEL.bytes,
        onPct: (p) => { pct = Math.min(99, Math.round(p)); },
        signal: ctl.signal,
      });
      await verifyDownload(part, MODEL.sha256);
      fs.renameSync(part, dest);
      // Keep the MIT license notices beside the redistributed derived ONNX artifact.
      fs.writeFileSync(licensePath(deps.userData), MIT_LICENSE_TEXT, "utf8");
      pct = 100;
      lastError = "";
      log("okfilow-detector: model downloaded and pinned SHA-256 verified");
      return true;
    })()
      .catch((e) => {
        if (isCancelled(e) || ctl.signal.aborted) {
          try { removeInside(path.join(deps.userData, "models"), dir()); } catch { /* ignore */ }
          pct = 0;
          log("okfilow-detector: download stopped by the user");
          return false;
        }
        try { fs.rmSync(`${file()}.part`, { force: true }); } catch { /* ignore */ }
        fetchError = String((e && e.message) || e).slice(0, 140);
        log(`okfilow-detector: download failed (${fetchError})`);
        return false;
      })
      .finally(() => {
        fetching = null;
        stopFetch = null;
      });
    return fetching;
  }

  function cancelFetch() {
    if (!stopFetch) return false;
    const fn = stopFetch;
    stopFetch = null;
    fn();
    return true;
  }

  function stop() {
    ct(idleTimer);
    idleTimer = null;
    const c = child;
    child = null;
    failAll("");
    if (c) {
      try { c.kill(); } catch { /* gone */ }
    }
  }

  async function remove() {
    cancelFetch();
    if (fetching) await fetching;
    if (starting) await starting.catch(() => {});
    const c = child;
    stop();
    await exited(c);
    lastError = "";
    fetchError = "";
    disabledForSession = false;
    disabledReason = "";
    pct = 0;
    const freed = removeInside(path.join(deps.userData, "models"), dir());
    log(`okfilow-detector: model deleted by the user (${Math.round(freed / 1024 / 1024)} MB freed)`);
    return freed;
  }

  const status = () => {
    const r = ready();
    return {
      id: MODEL_ID,
      name: MODEL_NAME,
      license: MODEL_LICENSE,
      hosted: Boolean(MODEL.hosted),
      sha256: MODEL.sha256,
      runtime: hasRuntime(),
      model: hasModel(),
      gpuAvailable,
      disabledForSession,
      disabledReason,
      ready: r.ok,
      reason: r.reason,
      running: Boolean(child),
      provider: activeProvider,
      startedMs,
      error: lastError || fetchError,
      downloading: Boolean(fetching),
      pct,
      bytes: MODEL.bytes,
    };
  };

  return { ready, detect, stop, status, fetchModel, cancelFetch, remove, resetSession };
}

module.exports = {
  MODEL,
  MODEL_ID,
  MODEL_NAME,
  MODEL_FILE,
  LICENSE_FILE,
  MIT_LICENSE_TEXT,
  MODEL_LICENSE,
  SOURCE_REPO,
  SOURCE_REVISION,
  SOURCE_GH_COMMIT,
  SOURCE_PT_SHA256,
  SOURCE_PT_BYTES,
  DETECT_TIMEOUT_MS,
  START_TIMEOUT_MS,
  modelDir,
  modelPath,
  licensePath,
  defaultProbeGpu,
  toScreenBoxes,
  mergeDetectedElements,
  runCaptureDetection,
  createDetectorRuntime,
};
