// Writes the icon sizes the manifest references, generated like apps/desktop's icon.
// Pure node (no image libraries): same orange dot on dark at each size.
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");

function png(S) {
  const c = S / 2, r = S * 0.33, ring = S * 0.05;
  const rows = [];
  for (let y = 0; y < S; y++) {
    const row = Buffer.alloc(1 + S * 4);
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5);
      const px = d < r ? [0xf0, 0xa5, 0x3a] : d < r + ring ? [0x3a, 0x2a, 0x10] : [0x0b, 0x0b, 0x0d];
      const o = 1 + x * 4;
      row[o] = px[0]; row[o + 1] = px[1]; row[o + 2] = px[2]; row[o + 3] = 255;
    }
    rows.push(row);
  }
  const table = [...Array(256)].map((_, n) => { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0; });
  const crc = (buf) => { let v = ~0; for (const b of buf) v = table[(v ^ b) & 255] ^ (v >>> 8); return ~v >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const dir = path.join(__dirname, "..", "public", "assets");
fs.mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 64, 80]) fs.writeFileSync(path.join(dir, `icon-${s}.png`), png(s));
console.log("icons written to", dir);
