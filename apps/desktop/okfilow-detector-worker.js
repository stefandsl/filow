// Runs the optional OmniParser icon_detect_v3 (MIT, YOLOv9-E) ONNX detector in a separate
// utilityProcess so UI rendering never blocks and onnxruntime-node stays isolated from sherpa-onnx.
// Nothing here opens any network connection: it loads the local ONNX file from disk and answers IPC.
//
// in:  { type: "init", modelPath, threads, provider }
// out: { type: "ready", ms, provider } | { type: "failed", error }
// in:  { type: "detect", id, data, width, height, format, confThreshold, iouThreshold, maxBoxes }
// out: { type: "done", id, boxes: [{ x1, y1, x2, y2, score }], ms } | { type: "error", id, error }

const IMGSZ = 1280;
const STRIDES = [8, 16, 32];
const DEFAULT_CONF = 0.05;
const DEFAULT_IOU = 0.45;
const DEFAULT_MAX_BOXES = 300;
const PAD_NORM = 114 / 255;

let ort = null;
let session = null;
let inputName = "images";
let activeProvider = "cpu";
// Reusable input tensor buffer (1 * 3 * 1280 * 1280 float32 = ~19.7 MB) to avoid GC churn per frame.
let tensorBuf = null;

/**
 * Top-left anchored bilinear letterbox from RGBA or BGRA pixels into [1, 3, IMGSZ, IMGSZ] float32.
 * Matches microsoft/OmniParser-v2.0 icon_detect_v3 reference preprocessing.
 */
function preprocessLetterbox(pixels, width, height, format = "rgba", imgsz = IMGSZ) {
  const scale = Math.min(imgsz / width, imgsz / height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const plane = imgsz * imgsz;
  const out = imgsz === IMGSZ ? (tensorBuf ||= new Float32Array(3 * plane)) : new Float32Array(3 * plane);
  out.fill(PAD_NORM);

  const isBgra = format === "bgra";
  const rOff = isBgra ? 2 : 0;
  const gOff = 1;
  const bOff = isBgra ? 0 : 2;
  const inv255 = 1 / 255;
  const sxRatio = width / newW;
  const syRatio = height / newH;

  for (let y = 0; y < newH; y++) {
    const sy = Math.min(height - 1, (y + 0.5) * syRatio - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    const wy0 = 1 - fy;
    const row0 = y0 * width * 4;
    const row1 = y1 * width * 4;
    const dstRow = y * imgsz;

    for (let x = 0; x < newW; x++) {
      const sx = Math.min(width - 1, (x + 0.5) * sxRatio - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const wx0 = 1 - fx;

      const i00 = row0 + x0 * 4;
      const i01 = row0 + x1 * 4;
      const i10 = row1 + x0 * 4;
      const i11 = row1 + x1 * 4;

      const w00 = wx0 * wy0;
      const w01 = fx * wy0;
      const w10 = wx0 * fy;
      const w11 = fx * fy;

      const idx = dstRow + x;
      out[idx] = (pixels[i00 + rOff] * w00 + pixels[i01 + rOff] * w01 + pixels[i10 + rOff] * w10 + pixels[i11 + rOff] * w11) * inv255;
      out[plane + idx] = (pixels[i00 + gOff] * w00 + pixels[i01 + gOff] * w01 + pixels[i10 + gOff] * w10 + pixels[i11 + gOff] * w11) * inv255;
      out[2 * plane + idx] = (pixels[i00 + bOff] * w00 + pixels[i01 + bOff] * w01 + pixels[i10 + bOff] * w10 + pixels[i11 + bOff] * w11) * inv255;
    }
  }
  return { data: out, scale, imgsz };
}

function boxIou(a, b) {
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

function nms(boxes, iouThreshold = DEFAULT_IOU, maxBoxes = DEFAULT_MAX_BOXES) {
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (let i = 0; i < boxes.length && kept.length < maxBoxes; i++) {
    const cand = boxes[i];
    let suppress = false;
    for (let j = 0; j < kept.length; j++) {
      if (boxIou(cand, kept[j]) > iouThreshold) {
        suppress = true;
        break;
      }
    }
    if (!suppress) kept.push(cand);
  }
  return kept;
}

/**
 * Decodes YOLOv9-E icon_detect_v3 outputs: 6 tensors ordered (cls_s8, box_s8, cls_s16, box_s16, cls_s32, box_s32).
 * Maps boxes back to original image pixels [0..width] x [0..height].
 */
function decodeOutputs(outputs, outputNames, { scale, width, height, confThreshold = DEFAULT_CONF, iouThreshold = DEFAULT_IOU, maxBoxes = DEFAULT_MAX_BOXES }) {
  const candidates = [];
  // Logit threshold equivalent to sigmoid(logit) > confThreshold avoids calling Math.exp for 99%+ of cells.
  const logitThreshold = Math.log(confThreshold / (1 - confThreshold));

  for (let s = 0; s < STRIDES.length; s++) {
    const stride = STRIDES[s];
    const clsTensor = outputs[outputNames[2 * s]];
    const boxTensor = outputs[outputNames[2 * s + 1]];
    if (!clsTensor || !boxTensor) continue;
    const gridH = clsTensor.dims[2];
    const gridW = clsTensor.dims[3];
    const clsData = clsTensor.data;
    const boxData = boxTensor.data;
    const cells = gridH * gridW;

    for (let idx = 0; idx < cells; idx++) {
      const logit = clsData[idx];
      if (logit <= logitThreshold) continue;
      const score = 1 / (1 + Math.exp(-logit));
      const gy = (idx / gridW) | 0;
      const gx = idx - gy * gridW;
      const cx = gx + 0.5;
      const cy = gy + 0.5;
      const left = boxData[idx];
      const top = boxData[cells + idx];
      const right = boxData[2 * cells + idx];
      const bottom = boxData[3 * cells + idx];

      const x1 = Math.max(0, Math.min(width, ((cx - left) * stride) / scale));
      const y1 = Math.max(0, Math.min(height, ((cy - top) * stride) / scale));
      const x2 = Math.max(0, Math.min(width, ((cx + right) * stride) / scale));
      const y2 = Math.max(0, Math.min(height, ((cy + bottom) * stride) / scale));
      if (x2 - x1 >= 2 && y2 - y1 >= 2) {
        candidates.push({
          x1: Math.round(x1 * 10) / 10,
          y1: Math.round(y1 * 10) / 10,
          x2: Math.round(x2 * 10) / 10,
          y2: Math.round(y2 * 10) / 10,
          score: Math.round(score * 10000) / 10000,
        });
      }
    }
  }
  return nms(candidates, iouThreshold, maxBoxes);
}

async function init({ modelPath, threads = 4, provider = "cpu" }) {
  const t0 = Date.now();
  ort = require("onnxruntime-node");
  const nThreads = Math.max(1, Math.min(8, Number(threads) || 4));
  const wanted = provider === "dml" ? ["dml", "cpu"] : ["cpu"];
  let lastErr = null;
  for (const ep of wanted) {
    try {
      const opts = ep === "dml"
        ? { executionProviders: ["dml"], graphOptimizationLevel: "all" }
        : { executionProviders: ["cpu"], intraOpNumThreads: nThreads, interOpNumThreads: 1, graphOptimizationLevel: "all" };
      session = await ort.InferenceSession.create(modelPath, opts);
      inputName = session.inputNames[0] || "images";
      activeProvider = ep;
      return { ms: Date.now() - t0, provider: activeProvider };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("failed to create onnxruntime session");
}

async function detect({ data, width, height, format = "rgba", confThreshold = DEFAULT_CONF, iouThreshold = DEFAULT_IOU, maxBoxes = DEFAULT_MAX_BOXES }) {
  if (!session) throw new Error("detector not initialized");
  const t0 = Date.now();
  const pixels = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { data: inputData, scale } = preprocessLetterbox(pixels, width, height, format, IMGSZ);
  const tensor = new ort.Tensor("float32", inputData, [1, 3, IMGSZ, IMGSZ]);
  const outputs = await session.run({ [inputName]: tensor });
  const boxes = decodeOutputs(outputs, session.outputNames, { scale, width, height, confThreshold, iouThreshold, maxBoxes });
  return { boxes, ms: Date.now() - t0 };
}

const port = process.parentPort;
if (port) {
  port.on("message", (event) => {
    const m = event.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "init") {
      init(m).then(
        (r) => port.postMessage({ type: "ready", ms: r.ms, provider: r.provider }),
        (e) => port.postMessage({ type: "failed", error: String((e && e.message) || e).slice(0, 200) }),
      );
    } else if (m.type === "detect") {
      detect(m).then(
        (r) => port.postMessage({ type: "done", id: m.id, boxes: r.boxes, ms: r.ms }),
        (e) => port.postMessage({ type: "error", id: m.id, error: String((e && e.message) || e).slice(0, 200) }),
      );
    }
  });
}

module.exports = { IMGSZ, STRIDES, DEFAULT_CONF, DEFAULT_IOU, DEFAULT_MAX_BOXES, preprocessLetterbox, decodeOutputs, nms, init, detect };
