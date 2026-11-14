// Downloads are explicit setup operations. Detector workers never import this file.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { sha256File } = require("./integrity");
const { download } = require("./download");
const KWS_NAME = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";
const FILES = Object.freeze([
  { name: "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx", bytes: 4599656, sha256: "408bbd740838c42d5bf6d1c5b80b3c88b616c7860b92d980328b5b068c76ae48", kws: true },
  { name: "decoder-epoch-13-avg-2-chunk-16-left-64.onnx", bytes: 759829, sha256: "63a22dd60f40fff082ac3e09afa507f6787da36df76ded2fbe145fa233e22c21", kws: true },
  { name: "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx", bytes: 86629, sha256: "190d4067b4cc20b72a42a1916e69d92052000fb7051a427ebb1bc72a69207dc1", kws: true },
  { name: "tokens.txt", bytes: 1928, sha256: "2d3f32311f9b692b964da3c90e830258d3e78e013cb0c992dbfb15cd5a1a71b0", kws: true },
  { name: "melspectrogram.onnx", bytes: 1087958, sha256: "ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f" },
  { name: "embedding_model.onnx", bytes: 1326578, sha256: "70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f" },
]);
const ARCHIVE = Object.freeze({ bytes: 32885699, sha256: "68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6", url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${KWS_NAME}.tar.bz2` });
const NOTICE = Object.freeze({ bytes: ARCHIVE.bytes + 1087958 + 1326578, source: "GitHub: k2-fsa/sherpa-onnx and dscripka/openWakeWord v0.5.1", licence: "Apache-2.0; keyword model training data not stated; embedding licence per openWakeWord README, original Google card not verified" });
async function verify(file, entry) {
  if (fs.statSync(file).size !== entry.bytes || await sha256File(file) !== entry.sha256) throw new Error(`Wake model checksum mismatch: ${entry.name || "archive"}`);
}
async function verifyModels(dir) { for (const e of FILES) await verify(path.join(dir, e.name), e); }
async function ensureModels(dir, { consent = false, enabled = false, signal, fetchFile = download } = {}) {
  if (!enabled || !consent) throw new Error("Wake model download requires enable consent");
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, "download.tar.bz2");
  try {
    if (FILES.some((e) => e.kws && !fs.existsSync(path.join(dir, e.name)))) {
      await fetchFile(ARCHIVE.url, archive, { signal, fallbackSize: ARCHIVE.bytes });
      await verify(archive, ARCHIVE);
      // Only the four pinned files are extracted from the verified official archive.
      await new Promise((resolve, reject) => execFile("tar", ["-xf", archive, "-C", dir, "--strip-components=1", ...FILES.filter((e) => e.kws).map((e) => `${KWS_NAME}/${e.name}`)], { windowsHide: true, timeout: 60000 }, (e) => e ? reject(e) : resolve()));
    }
    for (const e of FILES.filter((e) => !e.kws)) {
      const dest = path.join(dir, e.name);
      if (!fs.existsSync(dest)) {
        const part = `${dest}.part`;
        try {
          await fetchFile(`https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/${e.name}`, part, { signal, fallbackSize: e.bytes });
          await verify(part, e);
          fs.renameSync(part, dest);
        } finally { fs.rmSync(part, { force: true }); }
      }
    }
    await verifyModels(dir);
  } finally { fs.rmSync(archive, { force: true }); }
}
module.exports = { FILES, ARCHIVE, NOTICE, verify, verifyModels, ensureModels };
