// After `next build` in apps/web, the standalone server needs the static assets
// and public folder copied next to it. Run automatically by `npm run build`.
// With outputFileTracingRoot at the repo root, the server lives at
// apps/web/.next/standalone/apps/web/server.js.
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..", "apps", "web");
const standalone = path.join(web, ".next", "standalone");
const appDir = path.join(standalone, "apps", "web");
if (!fs.existsSync(path.join(appDir, "server.js"))) {
  console.error("No standalone server found. Run `next build` in apps/web first.");
  process.exit(1);
}

fs.cpSync(path.join(web, ".next", "static"), path.join(appDir, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(web, "public"))) {
  fs.cpSync(path.join(web, "public"), path.join(appDir, "public"), { recursive: true });
}

// Never ship local secrets inside the app bundle.
for (const dir of [standalone, appDir]) {
  for (const f of [".env", ".env.local", ".env.production", ".env.development"]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}
console.log("standalone ready at apps/web/.next/standalone/apps/web/server.js");
