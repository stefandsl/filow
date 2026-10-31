// Writes build/icon.png (512x512, orange dot on dark) using only node built-ins.
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");

const S = 512;
const c = S / 2;
const r = 170;
const rows = [];
for (let y = 0; y < S; y++) {
  const row = Buffer.alloc(1 + S * 4); // filter byte + RGBA
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - c + 0.5, y - c + 0.5);
    const o = 1 + x * 4;
    let px;
    if (d < r) px = [0xf0, 0xa5, 0x3a];
    else if (d < r + 26) px = [0x3a, 0x2a, 0x10];
    else px = [0x0b, 0x0b, 0x0d];
    row[o] = px[0];
    row[o + 1] = px[1];
    row[o + 2] = px[2];
    row[o + 3] = 255;
  }
  rows.push(row);
}

const crcTable = [...Array(256)].map((_, n) => {
  let v = n;
  for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
const crc = (buf) => {
  let v = ~0;
  for (const b of buf) v = crcTable[(v ^ b) & 255] ^ (v >>> 8);
  return ~v >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cc = Buffer.alloc(4);
  cc.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "build", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("wrote", out);
