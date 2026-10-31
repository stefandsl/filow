// Copies the ONNX Runtime web assets next to the app so Whisper works offline
// (transformers.js would otherwise fetch them from a CDN). Run by `npm run build -w apps/web`.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const candidates = [
  path.join(root, "node_modules", "onnxruntime-web", "dist"),
  path.join(root, "node_modules", "@huggingface", "transformers", "node_modules", "onnxruntime-web", "dist"),
];
const src = candidates.find((d) => fs.existsSync(d));
const dst = path.join(root, "apps", "web", "public", "ort");
if (!src) {
  console.warn("onnxruntime-web not found; Whisper will load ORT from the CDN");
  process.exit(0);
}
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (/\.(wasm|mjs)$/.test(f) && /ort-wasm|jsep|ort\./.test(f)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    n++;
  }
}
console.log(`copied ${n} ONNX runtime files to apps/web/public/ort`);
