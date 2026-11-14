import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { checkRuntime, runtimeState } from "./ollama-runtime";
import { askOllama } from "../web/lib/buddy/providers";
import { LANGS, t } from "@filow/core";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } });
async function fake(version: unknown) {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url!); res.setHeader("Connection", "close");
    res.end(req.url === "/api/version" ? JSON.stringify({ version }) : '{"message":{"content":"Hello"},"done":true}\n');
  });
  servers.push(server); await new Promise<void>(r => server.listen(4993, "127.0.0.1", r));
  return { calls, base: "http://127.0.0.1:4993" };
}
it.each([["0.8.9", "old"], ["0.9.0", "ready"], ["0.40.0", "ready"], ["1.0.0", "ready"], ["0.9.0-rc1", "old"], ["garbage", "unknown"]])("checks version %s", async (version, state) => {
  const { base } = await fake(version); expect((await checkRuntime(base)).state).toBe(state);
});
it("reports an unreachable runtime within the deadline", async () => {
  expect((await checkRuntime("http://127.0.0.1:4993")).state).toBe("unreachable");
});
it.each(LANGS)("blocks an old runtime before chat with the fix in %s", async language => {
  const { base, calls } = await fake("0.8.9");
  const run = async () => { for await (const part of askOllama({ question: "q", language, images: [], screens: [] }, undefined, { model: "fake", pictures: false, at: { base, headers: {}, server: null } })) void part; };
  await expect(run()).rejects.toThrow(t("local.runtimeOld", language, { v: "0.9.0" }));
  expect(calls).toEqual(["/api/version"]);
});
it("permits a new runtime and retains higher model-specific floors", async () => {
  const { base, calls } = await fake("0.40.0"); let result = "";
  for await (const part of askOllama({ question: "q", images: [], screens: [] }, undefined, { model: "fake", pictures: false, at: { base, headers: {}, server: null } })) result += part;
  expect(result).toBe("Hello"); expect(calls).toEqual(["/api/version", "/api/chat"]);
  expect(runtimeState("0.30.0", "0.35.1")).toBe("old");
});
it.each(["0.8.9", "0.40.0"])("checks setup version %s without claiming a pre-existing runtime", async version => {
  const root = fs.mkdtempSync("G:/FILOW/tmp/hardening/runtime-");
  try {
    const states: Array<{ state: string; code: string }> = [];
    const { installOllama } = createRequire(import.meta.url)("./localai.js");
    await installOllama(path.join(root, "bin"), (s: { state: string; code: string }) => states.push(s), {
      version: async () => version, findExe: () => "G:/pre-existing/ollama.exe", start: () => { throw Error("must not restart"); },
    });
    expect(states.at(-1)?.state).toBe(version === "0.8.9" ? "error" : "ready");
    if (version === "0.8.9") expect(states.at(-1)?.code).toBe("runtime_old");
    expect(fs.existsSync(path.join(root, "local-ownership.json"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
