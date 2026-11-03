// Copies the Filow brand kit (brand/) into every place the apps read icons from.
// Run with `npm run icon` (root) after changing brand/; the outputs are committed.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const brand = path.join(root, "brand");
const icons = path.join(brand, "icons");
const cp = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log("wrote", path.relative(root, to));
};

/**
 * Windows .ico. Entries up to 48 px are classic 32-bit DIBs (BGRA + AND mask): the shell, the
 * installer and rcedit (which stamps the exe) all read those; since 0.9.21 the 256 px entry is a DIB
 * too (the NSIS in electron-builder 26 drops PNG entries). A PNG-only .ico shipped in 0.9.2 left the desktop shortcut with a blank icon.
 * Small sizes use the compact "O + cradle" mark from brand/windows-small (the full Fi tile is
 * unreadable under 32 px), larger sizes the full tile. Windows picks the entry by requested size.
 */
async function dibEntry(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const rowBytes = w * 4;
  const maskRow = Math.ceil(w / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(rowBytes * h + maskRow * h, 20);
  const xor = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * rowBytes; // bottom-up
    for (let x = 0; x < w; x++) {
      const i = src + x * 4, o = y * rowBytes + x * 4;
      xor[o] = data[i + 2]; // B
      xor[o + 1] = data[i + 1]; // G
      xor[o + 2] = data[i]; // R
      xor[o + 3] = data[i + 3]; // A
    }
  }
  const and = Buffer.alloc(maskRow * h); // alpha carries transparency; mask all opaque
  return { size: w, blob: Buffer.concat([header, xor, and]), bpp: 32 };
}

function writeIco(dest, entries) {
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  const blobs = [];
  entries.forEach(({ size, blob }, i) => {
    const o = 6 + i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(blob.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += blob.length;
    blobs.push(blob);
  });
  fs.writeFileSync(dest, Buffer.concat([dir, ...blobs]));
  console.log("wrote", path.relative(root, dest), entries.map((e) => e.size).join("/"));
}

const small = path.join(brand, "windows-small", "png");
const micro = (variant, size) => fs.readFileSync(path.join(small, `filow-micro-${variant}-${size}.png`));
// The compact mark at every size (owner's choice, 0.9.15): the same picture on the desktop shortcut,
// the taskbar, the Start tile, the tray, macOS/Linux, the browser tab and the extension, whatever
// size the shell asks for. The full "Fi" tile stays in brand/ for marketing material.
const microSvg = path.join(brand, "windows-small", "svg", "filow-micro-gradient.svg");
const mark = async (size) => (fs.existsSync(path.join(small, `filow-micro-gradient-${size}.png`)) ? micro("gradient", size) : sharp(microSvg, { density: Math.ceil((size / 64) * 96) }).resize(size, size).png().toBuffer());

async function hybridIco(dest, variant, smallSizes, bigSizes) {
  const entries = [];
  for (const s of smallSizes) entries.push(await dibEntry(micro(variant, s)));
  // Every entry is a DIB, 256 px included: the NSIS bundled with electron-builder 26 silently drops a
  // PNG-compressed entry and the installer / portable exe shipped with no icon at all (0.9.19).
  for (const s of bigSizes) entries.push(await dibEntry(await mark(s)));
  writeIco(dest, entries);
}

async function main() {
  // Desktop app: PNG for macOS/Linux (electron-builder makes the .icns), hybrid .ico for Windows.
  fs.writeFileSync(path.join(root, "apps", "desktop", "build", "icon.png"), await mark(512));
  await hybridIco(path.join(root, "apps", "desktop", "build", "icon.ico"), "gradient", [16, 20, 24, 32, 40, 48], [64, 128, 256]);
  // Browser tab: the compact mark at 16/32, the tile above.
  await hybridIco(path.join(root, "apps", "web", "public", "favicon.ico"), "gradient", [16, 32], [48, 64]);
  cp(path.join(brand, "svg", "filow-wordmark-white.svg"), path.join(root, "apps", "desktop", "build", "wordmark-white.svg"));
  cp(path.join(brand, "svg", "filow-wordmark-black.svg"), path.join(root, "apps", "desktop", "build", "wordmark-black.svg"));
  const pub = path.join(root, "apps", "web", "public");
  cp(path.join(icons, "filow-app-512.png"), path.join(pub, "icon.png"));
  cp(path.join(icons, "filow-app-192.png"), path.join(pub, "icon-192.png"));
  cp(path.join(icons, "filow-maskable-192.png"), path.join(pub, "icon-maskable-192.png"));
  cp(path.join(icons, "filow-maskable-512.png"), path.join(pub, "icon-maskable-512.png"));
  cp(path.join(icons, "filow-app-180.png"), path.join(pub, "apple-touch-icon.png"));
  // Browsers that take the SVG favicon render it at 16-32 px: the compact mark reads better there.
  cp(path.join(brand, "windows-small", "svg", "filow-micro-gradient.svg"), path.join(pub, "favicon.svg"));
  for (const f of ["filow-primary-dark.svg", "filow-primary-light.svg", "filow-wordmark-white.svg", "filow-wordmark-black.svg", "filow-icon-gradient.svg"]) {
    cp(path.join(brand, "svg", f), path.join(pub, "brand", f));
  }
  // Browser extension: Chrome wants 16/48/128.
  const ext = path.join(root, "apps", "browser", "icons");
  cp(path.join(small, "filow-micro-gradient-16.png"), path.join(ext, "icon-16.png"));
  for (const s of [48, 128]) cp(path.join(small, `filow-micro-gradient-${s}.png`), path.join(ext, `icon-${s}.png`));
  // PowerPoint add-in: Office wants 16/32/64/80 (80 is not in the kit; resized from the 1024 tile).
  const ppt = path.join(root, "apps", "powerpoint", "public", "assets");
  fs.mkdirSync(ppt, { recursive: true });
  // Office ribbon: 16 and 32 are the compact mark (the ribbon shows them at those sizes), 64/80 the tile.
  for (const s of [16, 32]) cp(path.join(small, `filow-micro-gradient-${s}.png`), path.join(ppt, `icon-${s}.png`));
  cp(path.join(icons, "filow-app-64.png"), path.join(ppt, "icon-64.png"));
  await sharp(path.join(icons, "filow-app-1024.png")).resize(80, 80).png().toFile(path.join(ppt, "icon-80.png"));
  console.log("wrote apps/powerpoint/public/assets/icon-80.png");
  cp(path.join(icons, "filow-app-512.png"), path.join(root, "apps", "powerpoint", "assets", "icon.png"));
}
main().catch((e) => { console.error(e); process.exit(1); });
