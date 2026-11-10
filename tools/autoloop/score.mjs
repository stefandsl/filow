#!/usr/bin/env node
// Autoloop scoring harness (the "prepare.py" of karpathy/autoresearch): fixed, never edited by the
// improving agent. Produces one scalar score (0-100, higher is better) plus hard gates. An experiment
// is kept only if every gate passes and the score is strictly higher than the best kept score.
//
// Usage: node tools/autoloop/score.mjs [--quick] [--json]
//   --quick  skips npm audit and the typecheck (for inner iterations); the daily run uses the full score.
// Results are appended to tmp/autoloop/results.tsv (untracked, like autoresearch's results.tsv).
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const listJs = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));

function run(cmd, opts = {}) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 20 * 60 * 1000 });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

// ---------- gates ----------
const gates = {};
const metrics = {};

// Tests: all must pass.
{
  const outFile = path.join(ROOT, "tmp/autoloop/vitest.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  run(`npx vitest run --reporter=json --outputFile="${outFile}"`);
  let passed = 0, failed;
  try {
    const j = JSON.parse(fs.readFileSync(outFile, "utf8"));
    passed = j.numPassedTests; failed = j.numFailedTests + (j.numRuntimeErrorTestSuites || 0) + (j.numFailedTestSuites || 0);
  } catch { failed = 1; }
  metrics.testsPassed = passed;
  metrics.testsFailed = failed;
  gates.tests = failed === 0 && passed > 0;
}

if (!quick) {
  const t = run("npm run typecheck");
  gates.typecheck = t.code === 0;
  metrics.typeErrors = (t.out.match(/error TS\d+/g) || []).length;
}

// TST-05: ESLint over the whole repo, 0 errors and 0 warnings (eslint.config.mjs).
{
  const l = run("npm run lint");
  gates.lint = l.code === 0;
  const m = l.out.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
  metrics.lintProblems = m ? Number(m[1]) : l.code === 0 ? 0 : -1;
}

// ---------- scored checks (static, deterministic) ----------
const checks = [];
// pass may be a fraction 0..1 (partial credit, so progress is visible); a check counts as passed only at 1.
const check = (id, weight, pass, detail = "") => {
  const credit = typeof pass === "number" ? Math.max(0, Math.min(1, pass)) : pass ? 1 : 0;
  checks.push({ id, weight, pass: credit === 1, credit, detail });
};

const desktopFiles = listJs("apps/desktop");
const desktopSrc = desktopFiles.map((f) => [f, read(f)]);

// SEC-1: every BrowserWindow has contextIsolation, no nodeIntegration, sandbox on.
{
  let total = 0, good = 0; const bad = [];
  for (const [f, src] of desktopSrc) {
    const re = /webPreferences\s*:\s*\{([^}]*)\}/g; let m;
    while ((m = re.exec(src))) {
      total++;
      const body = m[1];
      const ok = /contextIsolation\s*:\s*true/.test(body) && !/nodeIntegration\s*:\s*true/.test(body) && /sandbox\s*:\s*true/.test(body);
      if (ok) good++; else bad.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  check("SEC-1 sandboxed windows", 3, total ? good / total : 0, bad.join(", "));
  metrics.windowsSandboxed = `${good}/${total}`;
}

// SEC-2: shell.openExternal only after the URL is parsed and its protocol allowlisted. A call counts as
// validated when the 6 lines before it (its helper) parse with new URL( and test .protocol.
// 2026-11-09 review: the first version only knew the helper name openExternalSafe, which flagged
// okfilow.js openWeb(), an equivalent helper.
{
  const raw = []; let calls = 0;
  for (const [f, src] of desktopSrc) {
    const lines = src.split("\n");
    lines.forEach((l, i) => {
      if (!/shell\.openExternal\(/.test(l)) return;
      calls++;
      const ctx = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
      if (!(/new URL\(/.test(ctx) && /\.protocol/.test(ctx))) raw.push(`${f}:${i + 1}`);
    });
  }
  check("SEC-2 external links validated", 3, calls ? 1 - raw.length / calls : 1, raw.join(", "));
}

// SEC-3: a Content-Security-Policy is set (Next headers or Electron session).
{
  const nextCfg = ["apps/web/next.config.ts", "apps/web/next.config.mjs", "apps/web/next.config.js"].find(exists);
  const has = (nextCfg && /Content-Security-Policy/.test(read(nextCfg))) || desktopSrc.some(([, s]) => /Content-Security-Policy/.test(s));
  check("SEC-3 content security policy", 2, has);
}

// SEC-4: Electron fuses configured at package time.
{
  const pkg = read("apps/desktop/package.json");
  check("SEC-4 electron fuses", 2, /electronFuses|@electron\/fuses/.test(pkg) || desktopSrc.some(([, s]) => /@electron\/fuses/.test(s)));
}

// SEC-5: will-navigate guard and window-open handler on every window-creating file.
{
  const missing = desktopSrc.filter(([, s]) => /new BrowserWindow\(/.test(s) && !(/will-navigate/.test(s) && /setWindowOpenHandler/.test(s))).map(([f]) => f);
  check("SEC-5 navigation guards", 2, missing.length === 0, missing.join(", "));
}

// SUP-1: no high or critical advisories in production dependencies.
if (!quick) {
  const a = run("npm audit --omit=dev --json", { timeout: 5 * 60 * 1000 });
  let high = -1;
  try { const v = JSON.parse(a.out.slice(a.out.indexOf("{"))).metadata.vulnerabilities; high = (v.high || 0) + (v.critical || 0); } catch { /* offline */ }
  metrics.auditHighCritical = high;
  if (high >= 0) check("SUP-1 no high/critical advisories", 2, high === 0, `high+critical=${high}`);
}

// QA-1: no em dash in user-facing strings (project rule).
{
  const files = ["packages/core/src/i18n.ts", "apps/desktop/main.js", "apps/web/lib/buddy/text.ts"].filter(exists);
  const hits = files.filter((f) => read(f).includes("—"));
  check("QA-1 no em dash in UI text", 1, hits.length === 0, hits.join(", "));
}

// TRK-1, TRK-2: tracking quality of the local decision path, totalled over every corpus under
// docs/gauntlet/corpus from its committed replay result, docs/gauntlet/results/clef-local-<corpus>.json
// (apps/web/lib/gauntlet/run.test.ts, default variant). A corpus with no result fails both checks.
// 2026-11-10 fix: this used to score the single newest file in the results folder, by timestamp.
// After a checkout that order is arbitrary, and it once picked a file of another kind (an
// adversarial-set result, which has no recall), so the two checks passed or failed by chance.
// The adversarial sets (clef-local-adversarial*.json) are reported in the detail, not scored: two
// false ticks in 406 are known model limits (docs/gauntlet/BASELINE.md).
{
  const corpusDir = path.join(ROOT, "docs/gauntlet/corpus");
  const resDir = path.join(ROOT, "docs/gauntlet/results");
  const corpora = fs.existsSync(corpusDir) ? fs.readdirSync(corpusDir).filter((d) => fs.existsSync(path.join(corpusDir, d, "labels.json"))) : [];
  if (corpora.length) {
    let correct = 0, labelled = 0, falseStarts = 0;
    const missing = [];
    for (const c of corpora) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(resDir, `clef-local-${c}.json`), "utf8"));
        if (!Array.isArray(j.points) || typeof j.correct !== "number" || typeof j.falseStarts !== "number") throw new Error("not a replay result");
        correct += j.correct;
        falseStarts += j.falseStarts;
        labelled += j.points.filter((p) => p.labelSec != null).length;
      } catch { missing.push(c); }
    }
    let advFalse = 0, advOpen = 0;
    for (const f of fs.existsSync(resDir) ? fs.readdirSync(resDir).filter((n) => /^clef-local-adversarial.*\.json$/.test(n)) : []) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(resDir, f), "utf8"));
        for (const t of Object.values(j.withVerification || {})) { advFalse += t.falseTicks; advOpen += t.expectedNot; }
      } catch { /* unreadable: not counted */ }
    }
    const recall = labelled ? Math.round((correct / labelled) * 1000) / 1000 : 0;
    metrics.trackingRecall = recall; metrics.trackingFalse = falseStarts;
    if (advOpen) metrics.adversarialFalseTicks = `${advFalse}/${advOpen}`;
    const gap = missing.length ? `no replay result for ${missing.join(", ")}` : "";
    check("TRK-1 zero false completions", 3, !missing.length && falseStarts === 0, gap || `${falseStarts} on ${corpora.length} corpora${advOpen ? `; adversarial sets ${advFalse} of ${advOpen} (reported, not scored)` : ""}`);
    check("TRK-2 recall >= 0.9", 3, !missing.length && recall >= 0.9, gap || `recall=${recall} (${correct}/${labelled})`);
  }
}

// A11Y-01..07: axe-core WCAG 2.2 A/AA scan of every page in both themes on the packaged app
// (tools/autoloop/e2e/a11y.mjs). Missing or older than 48 hours counts as failing.
{
  const f = path.join(ROOT, "tmp/autoloop/a11y.json");
  let credit = 0, detail = "no scan (run node tools/autoloop/e2e/a11y.mjs)";
  if (fs.existsSync(f)) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const ageH = (Date.now() - Date.parse(j.at)) / 3.6e6;
      const runs = j.results.length;
      // Every page the app ships, in both themes; a scan of a 404 or of the wrong page does not count.
      const expected = 2 * (Array.isArray(j.routes) ? j.routes.length : 7);
      if (ageH > 48) detail = `scan is ${Math.round(ageH)} h old`;
      else if (!Array.isArray(j.wrongPages)) detail = "scan predates the page check (rerun a11y.mjs)";
      else if (j.wrongPages.length) detail = `scanned the wrong page: ${j.wrongPages.join("; ")}`;
      else if (runs < expected || runs < 12) detail = `only ${runs} page/theme runs (expected ${expected})`;
      else { credit = Math.max(0, 1 - j.total / runs); detail = `${j.total} violations over ${runs} runs`; }
      metrics.a11yViolations = j.total;
    } catch { detail = "unreadable a11y.json"; }
  }
  check("A11Y axe WCAG 2.2 AA scan", 3, credit, detail);
  // A11Y-06: with reduced motion nothing moves; the probe must also see motion without it (> 0).
  let motionOk = false, motionDetail = "no motion probe in a11y.json";
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if ((Date.now() - Date.parse(j.at)) / 3.6e6 <= 48 && typeof j.moving === "number") {
      motionOk = j.moving === 0 && j.movingNormally > 0;
      motionDetail = `${j.moving} moving with reduced motion, ${j.movingNormally} without`;
    }
  } catch { /* reported above */ }
  check("A11Y-06 reduced motion respected", 2, motionOk, motionDetail);
  // A11Y-07 (WCAG 1.4.10 reflow): no page scrolls sideways at 640 or 320 CSS px. The 200 px control
  // must overflow somewhere, which shows the probe can see overflow at all.
  let reflowOk = false, reflowDetail = "no reflow probe in a11y.json";
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if ((Date.now() - Date.parse(j.at)) / 3.6e6 <= 48 && Array.isArray(j.reflowFailures)) {
      reflowOk = j.reflowFailures.length === 0 && j.controlOverflows > 0 && Array.isArray(j.wrongPages) && j.wrongPages.length === 0;
      reflowDetail = j.reflowFailures.length ? j.reflowFailures.join("; ") : `0 overflows at 640/320 px, control overflows on ${j.controlOverflows} page(s)`;
    }
  } catch { /* reported above */ }
  check("A11Y-07 reflow at 320 px", 2, reflowOk, reflowDetail);
  // A11Y-02 and A11Y-03: the keyboard-only walk of every page (a11y.mjs). It counts only when it saw
  // the page: the planted control was reported and the main page showed its tab stops. A11Y-02 is
  // operation (nothing stuck, no trap, Enter, Space and Escape work); A11Y-03 is what a sighted
  // keyboard user sees at each stop (a ring, on screen) and whether the stop has a name.
  // A11Y-05: in the same walk, ticking a point by keyboard must put "<Said>: <point>" into the polite
  // live region of the points list, and unticking must clear it.
  let saidOk = false, saidDetail = "no live-region probe in a11y.json (rerun a11y.mjs)";
  let opsOk = false, focusOk = false, opsDetail = "no keyboard walk in a11y.json (rerun a11y.mjs)", focusDetail = opsDetail;
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const k = j.keyboard;
    if ((Date.now() - Date.parse(j.at)) / 3.6e6 > 48) opsDetail = focusDetail = "scan older than 48 h";
    else if (k && Array.isArray(k.problems)) {
      // The main page has 28 tab stops today; fewer than 10 means the keys never reached the page.
      const sawThePage = k.controlCaught === true && (k.stops?.["/"] ?? 0) >= 10 && Array.isArray(j.wrongPages) && j.wrongPages.length === 0;
      const isOperation = (p) => ["stuck", "trap", "keys"].includes(p.kind);
      const list = (problems) => problems.map((p) => `${p.route} ${p.kind}: ${p.what}`).join("; ");
      const blind = "the walk did not see the page (planted control missed, too few stops or a wrong page)";
      opsOk = sawThePage && !k.problems.some(isOperation);
      focusOk = sawThePage && !k.problems.some((p) => !isOperation(p));
      opsDetail = sawThePage ? list(k.problems.filter(isOperation)) : blind;
      focusDetail = sawThePage ? list(k.problems.filter((p) => !isOperation(p))) : blind;
      if ("announcement" in k) {
        saidOk = sawThePage && k.announced === true;
        saidDetail = sawThePage ? `after the tick: ${JSON.stringify(k.announcement?.afterTick)}, after the untick: ${JSON.stringify(k.announcement?.afterUntick)}` : blind;
      }
    }
  } catch { /* an unreadable a11y.json is reported by the axe check above */ }
  check("A11Y-02 keyboard operation without a trap", 3, opsOk, opsDetail);
  check("A11Y-03 focus visible and named at every stop", 2, focusOk, focusDetail);
  check("A11Y-05 ticks announced in a polite live region", 2, saidOk, saidDetail);
}

// PERF-01: cold start of the packaged app (tools/autoloop/e2e/coldstart.mjs). Budgets: splash median
// <= 500 ms, main window median <= 3000 ms. Credit falls with the overshoot. Stale (48 h) or missing: failing.
{
  const f = path.join(ROOT, "tmp/autoloop/coldstart.json");
  let credit = 0, detail = "no measurement (run node tools/autoloop/e2e/coldstart.mjs)";
  if (fs.existsSync(f)) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if ((Date.now() - Date.parse(j.at)) / 3.6e6 > 48) detail = "measurement older than 48 h";
      else if (j.mainMedian == null || j.splashMedian == null) detail = "incomplete measurement";
      else {
        credit = (Math.min(1, 500 / j.splashMedian) + Math.min(1, 3000 / j.mainMedian)) / 2;
        detail = `splash ${j.splashMedian} ms (<= 500), main window ${j.mainMedian} ms (<= 3000)`;
        metrics.splashMs = j.splashMedian; metrics.mainWindowMs = j.mainMedian;
      }
    } catch { detail = "unreadable coldstart.json"; }
  }
  check("PERF-01 cold start", 3, credit, detail);
}

// Standards scorecard items with automatic checks (docs/autoloop/standards.json, grows over time).
if (exists("docs/autoloop/standards.json")) {
  const items = JSON.parse(read("docs/autoloop/standards.json"));
  for (const it of items) {
    if (!it.auto) continue;
    let pass = false;
    try {
      if (it.auto.type === "file-contains") pass = exists(it.auto.file) && new RegExp(it.auto.pattern).test(read(it.auto.file));
      else if (it.auto.type === "file-exists") pass = exists(it.auto.file);
      else if (it.auto.type === "cmd") pass = run(it.auto.cmd, { timeout: 10 * 60 * 1000 }).code === 0;
    } catch { pass = false; }
    check(`${it.id} ${it.check}`, it.weight || 1, pass);
  }
}

// ---------- score ----------
const total = checks.reduce((s, c) => s + c.weight, 0);
const got = checks.reduce((s, c) => s + c.credit * c.weight, 0);
const score = total ? Math.round((got / total) * 10000) / 100 : 0;
const allGates = Object.values(gates).every(Boolean);

let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* not a repo */ }
const resultsFile = path.join(ROOT, "tmp/autoloop/results.tsv");
if (!fs.existsSync(resultsFile)) fs.writeFileSync(resultsFile, "time\tcommit\tmode\tgates\tscore\tfailing\tmetrics\n");
const failing = checks.filter((c) => !c.pass).map((c) => c.id.split(" ")[0]).join(",");
fs.appendFileSync(resultsFile, `${new Date().toISOString()}\t${commit}\t${quick ? "quick" : "full"}\t${allGates ? "pass" : "FAIL"}\t${score}\t${failing}\t${JSON.stringify(metrics)}\n`);

const report = { score, gates, allGates, metrics, checks };
if (args.has("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`score ${score} / 100   gates ${allGates ? "PASS" : "FAIL"} ${JSON.stringify(gates)}`);
  for (const c of checks) console.log(`${c.pass ? "ok  " : "FAIL"} [w${c.weight}] ${c.id}${c.detail && !c.pass ? `  (${c.detail})` : ""}`);
  console.log(`metrics ${JSON.stringify(metrics)}`);
}
process.exit(allGates ? 0 : 1);
