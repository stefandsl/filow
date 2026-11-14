import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { ownership } from "../../desktop/local-ownership";
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));
const { POST, DELETE } = await import("@/app/api/local/pull/route");
const roots: string[] = []; const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function profile() {
  const root = fs.mkdtempSync("G:/FILOW/tmp/hardening/ownership-"); roots.push(root);
  vi.stubEnv("FILOW_SCRIPT", path.join(root, "script.md")); return root;
}
async function fixture(preexisting = false) {
  const root = profile(); const base = "http://127.0.0.1:4992";
  vi.stubEnv("OLLAMA_URL", base);
  let models = preexisting ? [{ name: "lfm3-vl:latest", digest: "digest-a" }] : [];
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    calls.push(req.url!); res.setHeader("Connection", "close");
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models })); return; }
    for await (const part of req) void part;
    if (req.url === "/api/pull") { models = [{ name: "lfm3-vl:latest", digest: "digest-a" }]; res.end('{"status":"success"}\n'); return; }
    if (req.url === "/api/delete") { models = []; res.end('{}'); return; }
    res.writeHead(404); res.end();
  });
  servers.push(server); await new Promise<void>(r => server.listen(4992, "127.0.0.1", r));
  const request = () => new Request("http://localhost/api/local/pull", { method: "POST", body: JSON.stringify({ name: "lfm3-vl" }) });
  return { root, base, calls, pull: async () => (await POST(request())).text(), remove: () => DELETE(request()), replace: () => { models[0].digest = "user-replacement"; } };
}
it("never offers or deletes a pre-existing model even after a Filow pull", async () => {
  const f = await fixture(true); await f.pull();
  expect(ownership(f.root).ownsModel(f.base, "lfm3-vl", "digest-a")).toBe(false);
  expect((await f.remove()).status).toBe(403); expect(f.calls).not.toContain("/api/delete");
});
it("offers and removes a Filow pull, with provenance surviving restart", async () => {
  const f = await fixture(); await f.pull();
  expect(ownership(f.root).ownsModel(f.base, "lfm3-vl:latest", "digest-a")).toBe(true);
  expect((await f.remove()).status).toBe(200); expect(f.calls).toContain("/api/delete");
  expect(ownership(f.root).ownsModel(f.base, "lfm3-vl", "digest-a")).toBe(false);
});
it("preserves a changed digest and a model at a different server", async () => {
  const f = await fixture(); await f.pull(); f.replace();
  expect((await f.remove()).status).toBe(403);
  expect(ownership(f.root).ownsModel("http://different", "lfm3-vl", "digest-a")).toBe(false);
  expect(f.calls).not.toContain("/api/delete");
});
it("never offers incomplete or corrupt records", () => {
  const root = profile(); const record = ownership(root);
  record.beginModel("base", "lfm3-vl", []);
  expect(ownership(root).ownsModel("base", "lfm3-vl", "digest-a")).toBe(false);
  fs.writeFileSync(path.join(root, "local-ownership.json"), "broken");
  expect(ownership(root).ownsModel("base", "lfm3-vl", "digest-a")).toBe(false);
  expect(() => record.beginModel("base", "lfm3-vl", [])).toThrow();
});
it("persists runtime install intent and completion independently of models", () => {
  const root = profile(); const record = ownership(root);
  expect(record.read().runtime).toBe(null);
  record.beginRuntime("win32"); expect(ownership(root).read().runtime?.state).toBe("installing");
  record.completeRuntime("G:/owned/ollama.exe");
  expect(ownership(root).read().runtime).toMatchObject({ state: "complete", executable: "G:/owned/ollama.exe" });
});
