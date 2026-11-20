const fs = require("node:fs");
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + 2 * i));
  return b;
}
function readSample(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.readUInt32LE(24) !== 16000 || b.readUInt16LE(22) !== 1 || b.readUInt16LE(34) !== 16 || b.toString("ascii", 36, 40) !== "data") throw new Error("Invalid enrolment WAV");
  return Float32Array.from({ length: (b.length - 44) / 2 }, (_, i) => b.readInt16LE(44 + i * 2) / 32768);
}
module.exports = { readSample, wav };
