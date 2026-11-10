import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineInfo } from "@filow/core";
import * as sysinfo from "@/lib/sysinfo";
import { NO_LOCAL_HELPER, OLLAMA_TOO_SLOW } from "@/lib/buddy/providers";
import { POST as ask } from "./route";
import { POST as warm } from "../warm/route";

// Review T2 finding 2, end to end on the server: the setup's screen helper is the model the ask
// route sends to Ollama, with or without the picture as the setup says.
const shot = { images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
const request = (body: unknown) => new Request("http://unit.invalid/api/buddy/ask", { method: "POST", body: JSON.stringify(body) });
let chats: Array<{ model: string; messages: Array<{ role: string; content: string; images?: string[] }> }>;
let loads: string[];

const machine = (ramGb: number, cores: number, gpu: MachineInfo["gpu"] = { kind: "none", vramGb: null }) => {
  vi.spyOn(sysinfo, "machineInfo").mockReturnValue({ ramGb, cores, gpu, freeDiskGb: 500 });
};

beforeEach(() => {
  for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "1", OLLAMA_URL: "http://127.0.0.1:11434", BUDDY_LOCAL_MODEL: "" })) vi.stubEnv(k, v);
  chats = [];
  loads = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "gemma4:e2b" }, { name: "lfm3-vl:latest" }, { name: "qwen3-vl:2b" }, { name: "qwen3-vl:8b" }] });
    if (String(url).endsWith("/api/generate")) {
      loads.push((JSON.parse(String(init?.body)) as { model: string }).model);
      return Response.json({});
    }
    if (String(url).endsWith("/api/chat")) {
      chats.push(JSON.parse(String(init?.body)));
      return new Response('{"message":{"content":"It saves the file."},"done":true}\n');
    }
    throw new Error(`unexpected ${url}`);
  }));
  vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OK Filow asks the screen helper of the setup", () => {
  it("Lite at 8 GB with Gemma installed: the small model, from text, and no picture leaves for the model", async () => {
    machine(8, 4);
    const res = await ask(request({ question: "what does this do?", ...shot, provider: "local" }));
    expect(await res.text()).toBe("It saves the file.");
    expect(res.headers.get("X-Buddy-Sees")).toBe("text");
    expect(chats).toHaveLength(1);
    expect(chats[0].model).toBe("lfm3-vl");
    expect(chats[0].messages.at(-1)?.images).toEqual([]);
    expect(chats[0].messages[0].content).toMatch(/cannot see the screen/);
  });

  it("Lite at 6 GB: the 1.5 GB model it downloaded is the one called (it used to ask for Gemma 4 E4B)", async () => {
    machine(6, 2);
    await (await ask(request({ question: "q", ...shot, provider: "local" }))).text();
    expect(chats[0].model).toBe("lfm3-vl");
  });

  it("Balanced pinned by the user: the same model reads the picture", async () => {
    machine(8, 4);
    const res = await ask(request({ question: "q", ...shot, provider: "local", setup: "standard" }));
    await res.text();
    expect(res.headers.get("X-Buddy-Sees")).toBe("screen");
    expect(chats[0].model).toBe("lfm3-vl");
    expect(chats[0].messages.at(-1)?.images).toHaveLength(1);
  });

  it("Best quality: Qwen3-VL 2B with the picture", async () => {
    machine(32, 16, { kind: "discrete", vramGb: 8 });
    await (await ask(request({ question: "q", ...shot, provider: "local" }))).text();
    expect(chats[0].model).toBe("qwen3-vl:2b");
  });

  it("under 6 GB: refused in plain words before anything is sent, and nothing is loaded", async () => {
    machine(4, 2);
    const res = await ask(request({ question: "q", ...shot, provider: "local" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(NO_LOCAL_HELPER);
    expect(chats).toHaveLength(0);
    expect(await (await warm(new Request("http://unit.invalid/api/buddy/warm", { method: "POST", body: "{}" }))).json()).toEqual({ model: null, ok: false });
    expect(loads).toEqual([]);
  });

  // seen in the packaged E2E: Clef pinned on the 8 GB card held the answer past the 3-minute limit,
  // and the bubble said Ollama was not running
  it("an answer held past the time limit says Ollama is busy, not that it is missing", async () => {
    machine(8, 4);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/tags")) return Response.json({ models: [] });
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }));
    const text = await (await ask(request({ question: "q", ...shot, provider: "local" }))).text();
    expect(text).toContain(OLLAMA_TOO_SLOW);
    expect(text).not.toMatch(/not running/);
  });

  it("warm-up loads the setup's screen helper", async () => {
    machine(8, 4);
    await warm(new Request("http://unit.invalid/api/buddy/warm", { method: "POST", body: JSON.stringify({ setup: "auto" }) }));
    expect(loads).toEqual(["lfm3-vl"]);
  });
});
