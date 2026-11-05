import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as decide } from "./decide/route";
import { POST as vision } from "./vision/route";
import { POST as translate } from "./script/translate/route";
import { POST as generate } from "./script/generate/route";
import { POST as eleven } from "./stt/elevenlabs-token/route";
import { POST as openai } from "./stt/openai-token/route";
import { POST as pull } from "./local/pull/route";
import { GET as localStatus } from "./local/status/route";
import * as sysinfo from "@/lib/sysinfo";

const request = (body: unknown) => new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body) });
const privateText = "Contact audit@example.invalid";
let outbound: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // No real credentials, sidecars, models or network, including unexpected destinations.
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "1", PII_GUARD: "strict",
    OPENROUTER_API_KEY: "fake", OPENAI_API_KEY: "fake", ELEVENLABS_API_KEY: "fake",
    DECISION_PROVIDER: "openrouter", GENERATE_PROVIDER: "openrouter", OLLAMA_URL: "http://127.0.0.1:11434",
    PII_SERVER_URL: "http://pii.invalid" })) vi.stubEnv(key, value);
  outbound = vi.fn(async (url: string) => {
    if (url.endsWith("/health")) return new Response("unavailable", { status: 503 });
    return Response.json({ token: "fake", value: "fake", answers: {},
      message: { content: '{"title":"A","points":["B"]}' },
      choices: [{ message: { content: "# A\n- B" } }], model: "fake" });
  });
  vi.stubGlobal("fetch", outbound);
  vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Step 4 provider boundaries", () => {
  it("offline local status must not probe a remote PII server", async () => {
    const res = await localStatus();
    expect(res.status).toBe(200);
    expect(outbound.mock.calls.filter(c => !c[0].startsWith("http://127.0.0.1:11434/")),
      "offline status must not contact the remote PII sidecar").toHaveLength(0);
    expect(await res.json()).toMatchObject({ offline: true, pii: { serverReachable: false } });
  });
  it("offline decide forces Ollama and bypasses even a strict unavailable PII sidecar", async () => {
    expect((await decide(request({ provider: "openrouter", transcript: privateText, sectionTitle: "A", bullets: [{ id: "b", text: "B" }] }))).status).toBe(200);
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://127.0.0.1:11434/v1/systemone"]);
  });
  it("offline vision refuses the frame before any provider or PII call", async () => {
    const res = await vision(request({ image: "data:image/png;base64,YQ==", question: privateText }));
    expect(await res.json()).toMatchObject({ model: "offline", summary: { unavailable: "disabled" } });
    expect(outbound).not.toHaveBeenCalled();
  });
  it("offline generation sends text and images only to configured Ollama", async () => {
    const res = await generate(request({ provider: "openrouter", slides: [{ index: 0, text: privateText, hasPicture: true, imageBase64: "YQ==" }] }));
    expect(await res.text()).toContain('"done":true');
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://127.0.0.1:11434/api/chat"]);
  });
  // Contract: ARCHITECTURE.md §6.10 offline forces local providers; Q4 prohibits offline text upload.
  it("offline translation must not upload the script to OpenRouter", async () => {
    const res = await translate(request({ text: `# A\n- ${privateText}`, to: "it" }));
    expect(res.status).toBe(200);
    expect(outbound, "offline translation must make no cloud request").not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ unavailable: "disabled", model: "offline" });
  });
  // Contract: guard.ts:1 and ARCHITECTURE.md §6.10: PII guard for text leaving for cloud.
  it("strict PII translation must not send unguarded personal text", async () => {
    vi.stubEnv("FILOW_OFFLINE", "");
    const res = await translate(request({ text: `# A\n- ${privateText}`, to: "it" }));
    const cloudCalls = outbound.mock.calls.filter(c => c[0].includes("openrouter.ai"));
    expect(cloudCalls, "strict PII must refuse cloud translation when Rizzo is unavailable").toHaveLength(0);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("PII guard is strict");
  });
  it("cloud translation redacts personal text and restores placeholders in the result", async () => {
    vi.stubEnv("FILOW_OFFLINE", ""); vi.stubEnv("PII_GUARD", "on");
    outbound.mockImplementation(async (url: string) => url.endsWith("/health")
      ? new Response("unavailable", { status: 503 })
      : Response.json({ choices: [{ message: { content: "# A\n- Contatta [EMAIL_1]" } }] }));
    const res = await translate(request({ text: `# A\n- ${privateText}`, to: "it" }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(outbound.mock.calls[1])).not.toContain("audit@example.invalid");
    expect(JSON.stringify(outbound.mock.calls[1])).toContain("[EMAIL_1]");
    expect((await res.json()).text).toContain("audit@example.invalid");
  });
  for (const [name, handler] of [["ElevenLabs", eleven], ["OpenAI", openai]] as const) {
    // Contract: ARCHITECTURE.md §6.10 and main.js menu: offline = no outbound requests.
    it(`offline ${name} token minting must not contact the cloud`, async () => {
      const res = await handler(request({}));
      expect(outbound, "offline token minting must make no cloud request").not.toHaveBeenCalled();
      expect(await res.json()).toMatchObject({ unavailable: "disabled" });
    });
  }
  it("local decision selection does not select local vision or translation", async () => {
    vi.stubEnv("FILOW_OFFLINE", ""); vi.stubEnv("DECISION_PROVIDER", "clef-local"); vi.stubEnv("PII_GUARD", "off");
    await vision(request({ image: "data:image/png;base64,YQ==" }));
    await translate(request({ text: "# A\n- B", to: "it" }));
    expect(outbound.mock.calls.map(c => c[0])).toEqual(Array(2).fill("https://openrouter.ai/api/v1/chat/completions"));
  });
  it("a configured remote Ollama receives raw text even with the offline flag", async () => {
    vi.stubEnv("OLLAMA_URL", "https://ollama.invalid");
    await decide(request({ transcript: privateText, sectionTitle: "A", bullets: [{ id: "b", text: "B" }] }));
    expect(outbound.mock.calls[0][0]).toBe("https://ollama.invalid/v1/systemone");
    expect(JSON.stringify(outbound.mock.calls[0])).toContain(privateText);
  });
  it("explicit local decide bypasses the PII sidecar without needing offline mode", async () => {
    vi.stubEnv("FILOW_OFFLINE", "");
    await decide(request({ provider: "clef-local", transcript: privateText, sectionTitle: "A", bullets: [{ id: "b", text: "B" }] }));
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://127.0.0.1:11434/v1/systemone"]);
  });
  it("strict cloud decide refuses an unavailable PII sidecar before uploading to the model", async () => {
    vi.stubEnv("FILOW_OFFLINE", "");
    const res = await decide(request({ transcript: privateText, sectionTitle: "A", bullets: [{ id: "b", text: "B" }] }));
    expect(res.status).toBe(502);
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://pii.invalid/health"]);
  });
  it("normal cloud decide regex-redacts every documented text field when Rizzo is unavailable", async () => {
    vi.stubEnv("FILOW_OFFLINE", ""); vi.stubEnv("PII_GUARD", "on");
    await decide(request({ transcript: privateText, sectionTitle: privateText, bullets: [{ id: "b", text: privateText }],
      covered: [privateText], upcoming: [privateText], onScreen: [privateText] }));
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://pii.invalid/health", "https://openrouter.ai/api/v1/chat/completions"]);
    expect(JSON.stringify(outbound.mock.calls[1])).not.toContain("audit@example.invalid");
    expect(JSON.stringify(outbound.mock.calls[1])).toContain("[EMAIL_1]");
  });
  it("offline local model pull still asks Ollama to download a model", async () => {
    const res = await pull(request({ name: "clef-flash" }));
    await res.text();
    expect(outbound.mock.calls.map(c => c[0])).toEqual(["http://127.0.0.1:11434/api/pull"]);
    expect(JSON.stringify(outbound.mock.calls[0])).toContain("clef-flash");
  });
});
