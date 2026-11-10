import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sysinfo from "@/lib/sysinfo";
import { POST as plan } from "./route";

// Review T2 finding 8: "no measuring at Start" as behaviour, not source text. Start asks for the
// plan with probe false; with an OpenRouter key and every cloud key present, nothing leaves this PC
// and the take stays local; only the explicit Measure button (probe true) makes the paid call.
const request = (body: unknown) => new Request("http://unit.invalid/api/local/plan", { method: "POST", body: JSON.stringify(body) });
let outbound: string[];

beforeEach(() => {
  for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", OLLAMA_URL: "http://127.0.0.1:11434", OPENROUTER_API_KEY: "fake", ELEVENLABS_API_KEY: "fake", OPENAI_API_KEY: "fake" })) vi.stubEnv(k, v);
  outbound = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    outbound.push(String(url));
    if (String(url).endsWith("/api/version")) return Response.json({ version: "0.40.0" });
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [] });
    return Response.json({ choices: [{ message: { content: '{"covered":[]}' } }] });
  }));
  vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
  vi.spyOn(sysinfo, "machineInfo").mockReturnValue({ ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 100 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the plan a take starts with", () => {
  it("Start (probe false): no call leaves this PC, decisions and speech stay local", async () => {
    const p = (await (await plan(request({ probe: false, apply: true, sherpaReady: true, webSpeech: true }))).json()) as { decision: { provider: string }; stt: { backend: string } };
    expect(outbound.filter((u) => !u.startsWith("http://127.0.0.1:11434/"))).toEqual([]);
    expect(p.decision.provider).toBe("matcher");
    expect(p.stt.backend).toBe("sherpa");
  });

  it("Start with no speech model on this PC: nothing local to listen with, and still no cloud engine", async () => {
    const p = (await (await plan(request({ probe: false, apply: true, sherpaReady: false, whisperCached: false, webSpeech: true }))).json()) as { stt: { backend: string | null; reason: string } };
    expect(p.stt).toMatchObject({ backend: null, reason: "local-speech-missing" });
    expect(outbound.filter((u) => !u.startsWith("http://127.0.0.1:11434/"))).toEqual([]);
  });

  it("the Measure button (probe true) is what spends the call: the mock sees it", async () => {
    await plan(request({ probe: true }));
    expect(outbound.some((u) => u.includes("openrouter.ai"))).toBe(true);
  });
});
