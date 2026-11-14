import { afterEach, expect, it, vi } from "vitest";
import { askOllama, warmLocalModel } from "./providers";
vi.mock("@/lib/sysinfo", () => ({
  gpuInfo: async () => ({ kind: "none", vramTotalGb: null }),
  machineInfo: () => ({ ramGb: 16, cores: 8, freeDiskGb: 500, gpu: { kind: "none", vramGb: null } }),
}));
vi.mock("@/lib/decide/clef", () => ({ OLLAMA_URL: () => "http://127.0.0.1:11435", clefTarget: async () => ({ model: null, server: null }) }));
vi.mock("@/lib/modelRoles/helper", () => ({ pinHelper: () => ({ model: "answer", pictures: true, pointer: "pointer" }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("warms both runners with the answer context, without pre-filling a different dated prefix", async () => {
  vi.stubEnv("BUDDY_LOCAL_MODEL", "");
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "lfm3-vl" }] });
    calls.push(JSON.parse(init.body));
    return String(url).endsWith("/api/chat") ? new Response('{"message":{"content":"ok"},"done":true}\n') : Response.json({ done: true });
  }));
  expect(await warmLocalModel("standard")).toEqual({ model: "answer", ok: true });
  for await (const part of askOllama({ question: "q", images: [], screens: [] }, undefined, { model: "answer", pictures: false })) expect(part).toBe("ok");
  expect(calls).toHaveLength(3);
  for (const model of ["answer", "pointer"]) {
    const warm = calls.find(c => c.model === model && !c.messages)!;
    expect(warm).toEqual({ model, keep_alive: "30m", options: { num_ctx: 8192 } });
  }
  expect(calls[2].options).toMatchObject({ num_ctx: 8192 });
  expect(calls[2].keep_alive).toBe("30m");
});
