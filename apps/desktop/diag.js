// "Report a problem" text (PRODUCTION-PLAN P2.1). The user saves the report to a file and may send it to
// anyone, so everything that could identify the user or reach their running session is masked first.

/**
 * Masks what must not leave in a report: live public-link URLs (anyone holding one can open the
 * running session), LAN and other private IPv4 addresses, the user's home folder and user name in
 * paths, e-mail addresses, and anything shaped like an API key or bearer token.
 */
function redact(text, { home = "", user = "" } = {}) {
  let s = String(text || "");
  s = s.replace(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com\S*/gi, "<public link>");
  // any NAME_KEY=value, NAME_TOKEN=value or NAME_SECRET=value line (FREELLMAPI_API_KEY and whatever comes next)
  // (an "=" or ":" is required: "PRIMARY KEY constraint" and "API_KEY missing" are ordinary log lines)
  s = s.replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET))(\s*[=:]\s*)[^\s"']{8,}/g, "$1$2<secret>");
  s = s.replace(/\b(sk-(?:or-v1-|proj-|ant-)?[A-Za-z0-9_-]{16,}|freellmapi-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g, "<key>");
  s = s.replace(/\b(Bearer|token|password|ACCESS_PASSWORD)([=: ]+)[^\s"']{8,}/gi, "$1$2<secret>");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  s = s.replace(/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, "<lan ip>");
  const SEP = "[\\\\/]"; // a regex class matching \ or /: logs mix C:\Users\x and C:/Users/x
  if (home) {
    const parts = home.split(/[\\/]+/).filter(Boolean).map(escapeRe);
    if (parts.length) s = s.replace(new RegExp(parts.join(SEP), "gi"), "~");
  }
  if (user && user.length >= 3) {
    s = s.replace(new RegExp(`(${SEP})${escapeRe(user)}(?=${SEP})`, "gi"), "$1<user>");
  }
  return s;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const fs = require("node:fs");
const path = require("node:path");
const retentionMs = 7 * 24 * 60 * 60 * 1000;

/** Only touch Filow's technical log and Crashpad dumps. Leave links and Crashpad's own database alone. */
function sweepDiagnostics(profile, { clear = false } = {}) {
  const cutoff = Date.now() - retentionMs;
  const errors = [];
  function attempt(action) {
    try { action(); } catch (err) { if (err.code !== "ENOENT") errors.push(err); }
  }
  const log = path.join(profile, "startup.log");
  attempt(() => {
    const stat = fs.lstatSync(log);
    if (!stat.isFile()) return;
    if (clear || stat.mtimeMs < cutoff) return fs.unlinkSync(log);
    // A new launch appends to the same file. Continuation lines belong to their preceding timestamp.
    const original = fs.readFileSync(log, "utf8");
    let keep = true;
    const retained = original.split(/(?<=\n)/).filter((line) => {
      const stamp = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) /);
      if (stamp) keep = Date.parse(stamp[1]) >= cutoff;
      return keep;
    }).join("");
    if (retained !== original) {
      if (!retained) return fs.unlinkSync(log);
      const temp = fs.mkdtempSync(path.join(profile, ".log-prune-"));
      try {
        const replacement = path.join(temp, "startup.log");
        fs.writeFileSync(replacement, retained, { mode: stat.mode });
        fs.renameSync(replacement, log);
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  });
  function visit(dir) {
    if (!fs.lstatSync(dir).isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      attempt(() => {
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && /\.dmp$/i.test(entry.name) && (clear || fs.lstatSync(file).mtimeMs < cutoff)) fs.unlinkSync(file);
      });
    }
  }
  attempt(() => visit(path.join(profile, "Crashpad")));
  if (errors.length) throw new AggregateError(errors, "Diagnostic cleanup incomplete");
}

module.exports = { redact, sweepDiagnostics };
