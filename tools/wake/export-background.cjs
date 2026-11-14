// Reproducible background features, never audio. The first fifth of each Common
// Voice 22 language is the spike's training split. Keep the other four fifths
// evaluation-only. No noisy mix of unclear provenance is redistributed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [source, dest] = process.argv.slice(2);
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(dest, { recursive: true });
const chunks = [], segments = [];
for (const language of ['en', 'it', 'ja', 'ro', 'ru']) {
  const data = fs.readFileSync(path.join(source, `cv_${language}.npy`));
  const headerLength = data.readUInt16LE(8);
  const header = data.subarray(10, 10 + headerLength).toString();
  if (!header.includes("'<f4'") || !header.includes('False')) throw new Error('Expected little-endian float32, C order');
  const frames = Math.floor((data.length - 10 - headerLength) / 384 / 5);
  const blob = Buffer.alloc(frames * 96);
  for (let i = 0; i < blob.length; i++) blob.writeInt8(Math.max(-127, Math.min(127, Math.round(data.readFloatLE(10 + headerLength + i * 4) * 127))), i);
  chunks.push(blob);
  segments.push({ language, frames, source_sha256: hash(data) });
}
const blob = Buffer.concat(chunks);
fs.writeFileSync(path.join(dest, 'background.bin'), blob);
fs.writeFileSync(path.join(dest, 'background.json'), JSON.stringify({ version: 1, licence: 'CC0-1.0', source: 'Common Voice 22 dev; first fifth of spike cv embeddings per language', frameSeconds: 0.08, dimensions: 96, scale: 127, sha256: hash(blob), segments }, null, 2) + '\n');
console.log(blob.length, 'bytes', blob.length / 96 * .08 / 3600, 'hours');
