// Content-Security-Policy for Filow's own pages inside the desktop windows (Electron security checklist
// #7, docs/autoloop/STANDARDS.md SEC-03). No eval and no remote script sources: scripts come only from
// the local app server. 'unsafe-inline' stays for scripts because Next.js inlines its bootstrap and the
// pages carry no nonce yet; 'wasm-unsafe-eval' lets the ONNX speech and embedding models run.
// blob: is for the microphone's AudioWorklet (packages/stt/src/mic.ts loads it from a blob URL, and
// worklets follow script-src, not worker-src): without it no take can start (found by the T1 take probe,
// tools/autoloop/e2e/take.mjs). It widens nothing that 'unsafe-inline' does not already allow.

const BASE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** The policy; lanHosts are this PC's LAN addresses, where the session relay can also answer. */
function policy(lanHosts = []) {
  // CSP source lists do not accept an IPv6 literal with a port wildcard, so [::1] is left out here.
  const hosts = [...LOCAL_HOSTS.filter((h) => !h.startsWith("[")), ...lanHosts];
  // local servers (app, session relay, HTTPS proxy, Ollama) and model/photo downloads over https
  const connect = ["'self'", ...hosts.flatMap((h) => [`http://${h}:*`, `ws://${h}:*`]), "https:", "wss:"];
  return [...BASE, `connect-src ${connect.join(" ")}`].join("; ");
}
const POLICY = policy();

/** True when the response comes from one of our own local servers (the pages we control). */
function isOwnOrigin(url, ports, lanHosts = []) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (![...LOCAL_HOSTS, ...lanHosts].includes(u.hostname)) return false;
    return ports.includes(Number(u.port));
  } catch {
    return false;
  }
}

/** Adds the policy to HTML responses from our servers. reportOnly is for checking a new policy. */
function cspHeaders(details, ports, reportOnly = false, lanHosts = []) {
  const headers = { ...(details.responseHeaders || {}) };
  if (!isOwnOrigin(details.url, ports, lanHosts) || details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") return headers;
  for (const k of Object.keys(headers)) if (/^content-security-policy(-report-only)?$/i.test(k)) delete headers[k];
  headers[reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"] = [policy(lanHosts)];
  return headers;
}

module.exports = { POLICY, policy, isOwnOrigin, cspHeaders };
