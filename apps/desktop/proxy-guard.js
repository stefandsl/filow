// The HTTPS proxy on 127.0.0.1 (main.js startHttpsProxy) serves the PowerPoint pane. Any program on this
// computer, and any web page open in a browser here, can reach it too, so what it forwards to the session
// relay is limited to the pane's own pages:
// - a request is let through only from a page of the proxy itself (Origin https://localhost or
//   https://127.0.0.1 on the proxy's port), or a same-origin browser request (Sec-Fetch-Site), never from
//   a client that says neither (curl, a script);
// - everything forwarded carries X-Forwarded-For, so the relay never takes it for a phone on the Wi-Fi;
// - the access password is added only to the one call that needs it, creating the pane's own session.

/** An Origin header of one of the proxy's own pages. */
function localOrigin(origin, port) {
  if (typeof origin !== "string") return false;
  const m = /^https:\/\/(localhost|127\.0\.0\.1)(?::(\d+))?$/.exec(origin);
  if (!m) return false;
  return port === undefined || Number(m[2] || 443) === Number(port);
}

/** A request the proxy may forward: from the proxy's own page, or a same-origin browser request without an Origin. */
function fromOwnPage(headers, port) {
  const origin = headers.origin;
  if (origin !== undefined) return localOrigin(origin, port);
  return headers["sec-fetch-site"] === "same-origin";
}

/** A WebSocket upgrade the proxy may forward to the relay: browsers always send Origin, and it must be the proxy's. */
function upgradeAllowed(headers, port) {
  return localOrigin(headers.origin, port);
}

/** The headers sent on to the relay or the web app. */
function forwardedHeaders(headers, { remoteAddress, targetHost, password, method, url }) {
  const out = { ...headers, host: targetHost };
  const prior = typeof headers["x-forwarded-for"] === "string" && headers["x-forwarded-for"].trim() ? `${headers["x-forwarded-for"]}, ` : "";
  out["x-forwarded-for"] = `${prior}${remoteAddress || "127.0.0.1"}`;
  if (password && method === "POST" && url === "/api/session" && !out["x-access-password"]) out["x-access-password"] = password;
  return out;
}

module.exports = { localOrigin, fromOwnPage, upgradeAllowed, forwardedHeaders };
