// After `next build`, the standalone server needs the static assets and public
// folder copied next to it. Run automatically by `npm run build`.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(standalone)) {
  console.error("No .next/standalone found. Run `next build` first.");
  process.exit(1);
}

fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}

// Never ship local secrets inside the app bundle.
for (const f of [".env", ".env.local", ".env.production", ".env.development"]) {
  const p = path.join(standalone, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
console.log("standalone ready at .next/standalone");
