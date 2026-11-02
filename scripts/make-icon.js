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

async function main() {
  // Desktop app (electron-builder makes .ico/.icns from this 512px PNG), web favicon, extension.
  cp(path.join(icons, "filow-app-512.png"), path.join(root, "apps", "desktop", "build", "icon.png"));
  cp(path.join(brand, "svg", "filow-wordmark-white.svg"), path.join(root, "apps", "desktop", "build", "wordmark-white.svg"));
  cp(path.join(brand, "svg", "filow-wordmark-black.svg"), path.join(root, "apps", "desktop", "build", "wordmark-black.svg"));
  const pub = path.join(root, "apps", "web", "public");
  cp(path.join(icons, "filow-app-512.png"), path.join(pub, "icon.png"));
  cp(path.join(icons, "filow-app-192.png"), path.join(pub, "icon-192.png"));
  cp(path.join(icons, "filow-maskable-192.png"), path.join(pub, "icon-maskable-192.png"));
  cp(path.join(icons, "filow-maskable-512.png"), path.join(pub, "icon-maskable-512.png"));
  cp(path.join(icons, "filow-app-180.png"), path.join(pub, "apple-touch-icon.png"));
  cp(path.join(icons, "favicon.ico"), path.join(pub, "favicon.ico"));
  cp(path.join(icons, "favicon.svg"), path.join(pub, "favicon.svg"));
  for (const f of ["filow-primary-dark.svg", "filow-primary-light.svg", "filow-wordmark-white.svg", "filow-wordmark-black.svg", "filow-icon-gradient.svg"]) {
    cp(path.join(brand, "svg", f), path.join(pub, "brand", f));
  }
  // Browser extension: Chrome wants 16/48/128.
  const ext = path.join(root, "apps", "browser", "icons");
  for (const s of [16, 48, 128]) cp(path.join(icons, `filow-app-${s}.png`), path.join(ext, `icon-${s}.png`));
  // PowerPoint add-in: Office wants 16/32/64/80 (80 is not in the kit; resized from the 1024 tile).
  const ppt = path.join(root, "apps", "powerpoint", "public", "assets");
  fs.mkdirSync(ppt, { recursive: true });
  for (const s of [16, 32, 64]) cp(path.join(icons, `filow-app-${s}.png`), path.join(ppt, `icon-${s}.png`));
  await sharp(path.join(icons, "filow-app-1024.png")).resize(80, 80).png().toFile(path.join(ppt, "icon-80.png"));
  console.log("wrote apps/powerpoint/public/assets/icon-80.png");
  cp(path.join(icons, "filow-app-512.png"), path.join(root, "apps", "powerpoint", "assets", "icon.png"));
}
main().catch((e) => { console.error(e); process.exit(1); });
