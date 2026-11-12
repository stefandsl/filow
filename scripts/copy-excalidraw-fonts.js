// Copies Excalidraw's fonts (Excalifont, Xiaolai for Japanese, Liberation Sans, ...) next to the app,
// so the whiteboard draws in its hand-drawn letters with no internet: Excalidraw would otherwise load
// them from esm.sh. Run by `npm run build -w apps/web` and `npm run dev -w apps/web`.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const dst = path.join(root, "apps", "web", "public", "excalidraw", "fonts");
if (!fs.existsSync(src)) {
  console.warn("@excalidraw/excalidraw fonts not found; the whiteboard falls back to the system font");
  process.exit(0);
}
let n = 0;
const copy = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copy(a, b);
    else if (/\.(woff2|ttf)$/i.test(entry.name)) {
      if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b);
      n++;
    }
  }
};
copy(src, dst);
console.log(`whiteboard: ${n} Excalidraw font files in apps/web/public/excalidraw/fonts`);
