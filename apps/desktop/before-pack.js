// electron-builder beforePack hook: refuse to package an app that cannot start.
// electron-builder skips a missing extraResources source without a word, and several of ours are
// build outputs that git does not track. A package made in a fresh checkout after only
// `npm run build -w apps/web` had no session server: it showed "Filow failed to start" on launch.
// A bundle older than its sources is the quieter version of the same mistake.
// Fix for every message below: `npm run build` at the repo root, then `npm run vendor` here.
const fs = require("node:fs");
const path = require("node:path");

const here = __dirname;
const root = path.join(here, "..", "..");

/** Newest modification time under dir, for files matching keep (0 when dir is missing). */
function newest(dir, keep = () => true) {
  let t = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      t = Math.max(t, newest(p, keep));
    } else if (keep(e.name)) t = Math.max(t, fs.statSync(p).mtimeMs);
  }
  return t;
}
const code = (name) => /\.(ts|tsx|js|mjs|cjs|css|json)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name);

/**
 * Each required build output with the sources it is made from. `sources` may be empty when
 * freshness cannot be told from files (the Next build is checked by its BUILD_ID instead).
 */
function requirements(base = root) {
  const p = (...parts) => path.join(base, ...parts);
  return [
    { what: "web app (Next standalone server)", file: p("apps", "web", ".next", "standalone", "apps", "web", "server.js"), fix: "npm run build -w apps/web",
      sources: [p("apps", "web", "app"), p("apps", "web", "components"), p("apps", "web", "lib"), p("packages", "core", "src"), p("packages", "ui", "src"), p("packages", "stt", "src"), p("packages", "client", "src")],
      stamp: p("apps", "web", ".next", "BUILD_ID") },
    { what: "session server bundle", file: p("apps", "server", "dist", "bundle.js"), fix: "npm run build -w apps/server",
      sources: [p("apps", "server", "src"), p("packages", "core", "src")] },
    { what: "PowerPoint task pane", file: p("apps", "web", "public", "powerpoint", "index.html"), fix: "npm run build -w apps/powerpoint (before the web build)",
      sources: [p("apps", "powerpoint", "src")] },
    { what: "updater bundle", file: p("apps", "desktop", "vendor", "electron-updater.js"), fix: "npm run vendor (in apps/desktop)", sources: [] },
    { what: "welcome window bundle", file: p("apps", "desktop", "vendor", "welcome.js"), fix: "npm run vendor (in apps/desktop)",
      sources: [p("apps", "desktop", "welcome.ts")] },
    { what: "shared texts for the shell", file: p("apps", "desktop", "vendor", "i18n.js"), fix: "npm run vendor (in apps/desktop)",
      sources: [p("packages", "core", "src", "i18n.ts")] },
  ];
}

/** Problems that make the package unusable or stale; empty when it is safe to pack. */
function problems(base = root) {
  const out = [];
  for (const r of requirements(base)) {
    if (!fs.existsSync(r.file)) {
      out.push(`${r.what} is missing (${path.relative(base, r.file)}). Run: ${r.fix}`);
      continue;
    }
    const built = fs.statSync(r.stamp && fs.existsSync(r.stamp) ? r.stamp : r.file).mtimeMs;
    let src = 0;
    for (const s of r.sources) src = Math.max(src, fs.existsSync(s) && fs.statSync(s).isFile() ? fs.statSync(s).mtimeMs : newest(s, code));
    // 2 s of slack: some file systems round modification times.
    if (src > built + 2000) out.push(`${r.what} is older than its sources (built ${new Date(built).toISOString()}, sources changed ${new Date(src).toISOString()}). Run: ${r.fix}`);
  }
  return out;
}

module.exports = async function beforePack() {
  const found = problems();
  if (found.length) throw new Error(`Filow cannot be packaged:\n- ${found.join("\n- ")}\nThen run electron-builder again.`);
};
module.exports.problems = problems;
module.exports.requirements = requirements;
