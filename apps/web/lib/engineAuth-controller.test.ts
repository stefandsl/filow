// A controller token (apps/server/src/auth.ts mintControllerToken): never an engine token, taken only on
// the routes that name controllers, and a consent header that comes with it is never a consent.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintControllerToken, mintEngineToken } from "../../server/src/auth";
import { isControllerRequest, requireEngine, verifyControllerToken, verifyEngineToken } from "./engineAuth";
import { CONSENT_HEADER, consentDenied, consentKey, type Recipient } from "./buddy/outbound";

const SECRET = "launch-secret";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ACCESS_PASSWORD;
  process.env.ACCESS_PASSWORD = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ACCESS_PASSWORD;
  else process.env.ACCESS_PASSWORD = saved;
});
const req = (token: string, headers: Record<string, string> = {}) => new Request("http://x/api/buddy/ask", { method: "POST", headers: { Authorization: `Bearer ${token}`, ...headers } });

describe("controller tokens on the web app", () => {
  it("never pass as engine tokens, and pass only where a route names controllers", () => {
    const ctl = mintControllerToken(SECRET, "s1", 60_000);
    const eng = mintEngineToken(SECRET, "s1", 60_000);
    expect(verifyEngineToken(SECRET, ctl)).toBeNull();
    expect(verifyControllerToken(SECRET, ctl)?.sessionId).toBe("s1");
    expect(verifyControllerToken(SECRET, eng)).toBeNull();
    expect(verifyControllerToken("other", ctl)).toBeNull();
    expect(requireEngine(req(ctl))?.status).toBe(401); // /api/buddy/* and every other engine route
    expect(requireEngine(req(ctl), { controllers: true })).toBeNull(); // script generation, vision
    expect(requireEngine(req(eng))).toBeNull();
    expect(requireEngine(req(`c.${ctl.split(".").slice(1, 3).join(".")}.forged`), { controllers: true })?.status).toBe(401);
  });

  it("carry no consent: the header that comes with one is not read", () => {
    const cloud: Recipient = { id: "openrouter/x", names: ["OpenRouter"] };
    const ctl = mintControllerToken(SECRET, "s1", 60_000);
    const eng = mintEngineToken(SECRET, "s1", 60_000);
    const yes = { [CONSENT_HEADER]: consentKey("ask", cloud) };
    expect(isControllerRequest(req(ctl))).toBe(true);
    expect(consentDenied(req(ctl, yes), "ask", cloud)?.status).toBe(403);
    expect(consentDenied(req(eng, yes), "ask", cloud)).toBeNull();
  });
});
