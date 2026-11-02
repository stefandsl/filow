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
 * Windows .ico: an ICO container of PNG entries (Vista+). Small sizes use the compact "O + cradle"
 * mark from brand/windows-small (the full Fi tile is unreadable under 32 px), larger sizes the full tile.
 * Windows picks the entry by requested physical size, so both live in one file.
 */
function writeIco(dest, entries) {
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  const blobs = [];
  entries.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
    blobs.push(png);
  });
  fs.writeFileSync(dest, Buffer.concat([dir, ...blobs]));
  console.log("wrote", path.relative(root, dest), entries.map((e) => e.size).join("/"));
}

const small = path.join(brand, "windows-small", "png");
const micro = (variant, size) => fs.readFileSync(path.join(small, `filow-micro-${variant}-${size}.png`));
const tile = async (size) => sharp(path.join(icons, "filow-app-1024.png")).resize(size, size).png().toBuffer();

async function hybridIco(dest, variant, smallSizes, bigSizes) {
  const entries = [];
  for (const s of smallSizes) entries.push({ size: s, png: micro(variant, s) });
  for (const s of bigSizes) entries.push({ size: s, png: await tile(s) });
  writeIco(dest, entries);
}

async function main() {
  // Desktop app: PNG for macOS/Linux (electron-builder makes the .icns), hybrid .ico for Windows.
  cp(path.join(icons, "filow-app-512.png"), path.join(root, "apps", "desktop", "build", "icon.png"));
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
  for (const s of [48, 128]) cp(path.join(icons, `filow-app-${s}.png`), path.join(ext, `icon-${s}.png`));
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
