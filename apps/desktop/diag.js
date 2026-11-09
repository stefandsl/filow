// "Report a problem" text (PRODUCTION-PLAN P2.1). The report goes to a public GitHub issue the user
// submits, so everything that could identify the user or reach their running session is masked first.

/**
 * Masks what must not reach a public issue: live public-link URLs (anyone holding one can open the
 * running session), LAN and other private IPv4 addresses, the user's home folder and user name in
 * paths, e-mail addresses, and anything shaped like an API key or bearer token.
 */
function redact(text, { home = "", user = "" } = {}) {
  let s = String(text || "");
  s = s.replace(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com\S*/gi, "<public link>");
  s = s.replace(/\b(sk-(?:or-v1-|proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g, "<key>");
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

/**
 * The GitHub "new issue" URL for a report, kept under maxUrl characters by shortening the log section
 * (oldest lines first) before encoding, so the URL never ends inside a %-escape.
 * Returns { url, truncated } where truncated says the full text should go to the clipboard.
 */
function issueUrl(base, title, sections, maxUrl = 7800) {
  const build = (logText) => `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(sections.head + logText + sections.tail)}`;
  const log = sections.log;
  let url = build(log);
  if (url.length <= maxUrl) return { url, truncated: false };
  // Binary search the longest suffix of the log that fits.
  let lo = 0, hi = log.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build("(older lines cut)\n" + log.slice(log.length - mid)).length <= maxUrl) lo = mid;
    else hi = mid - 1;
  }
  url = build("(older lines cut)\n" + log.slice(log.length - lo));
  return { url, truncated: true };
}

module.exports = { redact, issueUrl };
