// Copies the web app's theme into the add-in so StageView renders identically.
const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "..", "..", "web", "app", "globals.css");
const dst = path.join(__dirname, "..", "src", "theme.css");
fs.writeFileSync(dst, "/* generated from apps/web/app/globals.css by scripts/theme.js; do not edit */\n" + fs.readFileSync(src, "utf8"));
console.log("theme.css updated");
