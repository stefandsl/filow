// The HTTPS proxy on 127.0.0.1 (main.js startHttpsProxy): only the PowerPoint pane's own pages reach the
// session relay and the current session's code through it, and nothing through it passes for a phone on the Wi-Fi.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { localOrigin, fromOwnPage, upgradeAllowed, forwardedHeaders } = require("./proxy-guard.js");
const PORT = 4749;

describe("the HTTPS proxy's guard", () => {
  it("knows its own pages by Origin, on its own port", () => {
    expect(localOrigin(`https://localhost:${PORT}`, PORT)).toBe(true);
    expect(localOrigin(`https://127.0.0.1:${PORT}`, PORT)).toBe(true);
    for (const o of [`http://localhost:${PORT}`, "https://localhost:4750", "https://evil.example", `https://localhost.evil.example:${PORT}`, "null", undefined, ""]) expect(localOrigin(o, PORT)).toBe(false);
  });

  it("forwards a request only from its own page or a same-origin browser request, never from a client that says neither", () => {
    expect(fromOwnPage({ origin: `https://localhost:${PORT}` }, PORT)).toBe(true);
    expect(fromOwnPage({ "sec-fetch-site": "same-origin" }, PORT)).toBe(true);
    expect(fromOwnPage({}, PORT)).toBe(false); // curl, a script
    expect(fromOwnPage({ "sec-fetch-site": "cross-site" }, PORT)).toBe(false);
    expect(fromOwnPage({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }, PORT)).toBe(false);
    expect(upgradeAllowed({ origin: `https://localhost:${PORT}` }, PORT)).toBe(true);
    expect(upgradeAllowed({}, PORT)).toBe(false);
    expect(upgradeAllowed({ origin: "https://evil.example" }, PORT)).toBe(false);
  });

  it("marks everything it forwards as proxied, and adds the password only to creating the pane's own session", () => {
    const h = forwardedHeaders({ origin: "x" }, { remoteAddress: "127.0.0.1", targetHost: "127.0.0.1:4748", password: "pw", method: "POST", url: "/api/session/pair" });
    expect(h["x-forwarded-for"]).toBe("127.0.0.1");
    expect(h.host).toBe("127.0.0.1:4748");
    expect(h["x-access-password"]).toBeUndefined();
    expect(forwardedHeaders({}, { remoteAddress: "127.0.0.1", targetHost: "h", password: "pw", method: "POST", url: "/api/session" })["x-access-password"]).toBe("pw");
    expect(forwardedHeaders({ "x-forwarded-for": "10.0.0.5" }, { remoteAddress: "127.0.0.1" })["x-forwarded-for"]).toBe("10.0.0.5, 127.0.0.1");
  });
});
