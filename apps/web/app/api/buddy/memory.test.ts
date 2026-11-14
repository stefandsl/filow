import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sysinfo from "@/lib/sysinfo";
import { POST as ask } from "./ask/route";
import { POST as learn } from "./memory/route";

// "Remember things about me" at the server (docs/okfilow/MEMORY.md): the saved preferences go with a
// question, or the question is read to find new ones, only where the user said yes to them. On this PC
// nothing leaves. A fake provider on loopback; no real keys, no network.
const LOCAL = "http://127.0.0.1:11434/";
let net: ReturnType<typeof vi.fn>;
const outside = () => net.mock.calls.map((c) => String(c[0])).filter((url) => !url.startsWith(LOCAL));
/** The body of the i-th request to a model (the local model's chat or OpenRouter), whatever was asked before it. */
const sent = (i = 0) => JSON.parse(String(net.mock.calls.filter((c) => /\/api\/chat|openrouter\.ai/.test(String(c[0])))[i][1].body));
const LEARNED = "ANSWER: Answer in short sentences\nME: The user's talk is about solar panels\nNONE";

const facts = ["Answer in short sentences", "The user's talk is about solar panels"];
const askBody = { question: "Add a chart about solar panels", provider: "cloud", images: [], screens: [{ index: 1, width: 10, height: 10, cursor: true }], sees: false, memory: facts };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body), headers });
const ASK = { "x-filow-consent": "ask:openrouter/openai" };
const MEMORY = { "x-filow-consent-memory": "memory:openrouter/openai" };

beforeEach(() => {
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", BUDDY_PROVIDER: "", BUDDY_CLOUD_MODEL: "", BUDDY_LOCAL_MODEL: "qwen3-vl:2b",
    OPENROUTER_API_KEY: "test-key-not-real", OLLAMA_URL: "http://127.0.0.1:11434" })) vi.stubEnv(key, value);
  net = vi.fn(async (url: string) => {
    const reply = JSON.stringify(LEARNED).slice(1, -1);
    if (String(url).includes("openrouter.ai")) return new Response(`data: {"choices":[{"delta":{"content":"${reply}"}}]}\n\ndata: [DONE]\n\n`);
    if (String(url).includes("/api/chat")) return new Response(`{"message":{"content":"${reply}"},"done":true}\n`);
    if (String(url).includes("/api/version")) return Response.json({ version: "99.0.0" });
    return Response.json({});
  });
  vi.stubGlobal("fetch", net);
  vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
  vi.spyOn(sysinfo, "machineInfo").mockReturnValue({ ramGb: 32, cores: 8, gpu: { kind: "none", vramGb: null }, freeDiskGb: 500 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("saved preferences with a question: /api/buddy/ask", () => {
  it("online without their own yes: refused, nothing is forwarded (the question's yes is not enough)", async () => {
    const others: Array<Record<string, string>> = [{}, { "x-filow-consent-memory": "memory:openrouter/google" }, { "x-filow-consent-memory": "ask:openrouter/openai" }];
    for (const memory of others) {
      const res = await ask(post(askBody, { ...ASK, ...memory }));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "consent_required", kind: "memory", recipient: { id: "openrouter/openai" } });
    }
    expect(net).not.toHaveBeenCalled();
  });

  it("online with both yeses: one short block in the system prompt, the question unchanged", async () => {
    const res = await ask(post(askBody, { ...ASK, ...MEMORY }));
    expect(res.status).toBe(200);
    await res.text();
    const system = sent().messages[0].content as string;
    expect(system).toContain("The user asked you to remember these about them");
    for (const f of facts) expect(system).toContain(`- ${f}`);
    expect(JSON.stringify(sent().messages.at(-1))).not.toContain("solar panels\\n- ");
  });

  it("on this PC: no yes needed, the facts reach the local model and nothing leaves", async () => {
    const res = await ask(post({ ...askBody, provider: "local" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(outside()).toEqual([]);
    expect(sent().messages[0].content).toContain("- Answer in short sentences");
  });

  it("without facts the prompt has no memory block; at most five facts, one line each", async () => {
    await (await ask(post({ ...askBody, provider: "local", memory: undefined }))).text();
    expect(sent(0).messages[0].content).not.toContain("remember these");
    await (await ask(post({ ...askBody, provider: "local", memory: ["a\nb", 7, ...Array.from({ length: 9 }, (_, i) => `fact ${i}`)] }))).text();
    const block = (sent(1).messages[0].content as string).split("remember these")[1];
    expect(block.match(/^- /gm)).toHaveLength(5);
    expect(block).toContain("- a b");
  });
});

describe("learning after an answer: /api/buddy/memory", () => {
  it("on this PC: only the question goes to the local model, never a picture or the conversation", async () => {
    const res = await learn(post({ question: "I give talks about solar panels, answer in short sentences", provider: "local" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facts: [{ kind: "answer", text: "Answer in short sentences" }, { kind: "me", text: "The user's talk is about solar panels" }] });
    expect(outside()).toEqual([]);
    const body = sent();
    // the system prompt and the question (a thinking model also gets its empty prefill): no conversation
    expect(body.messages.filter((m: { role: string }) => m.role !== "assistant")).toHaveLength(2);
    expect(body.messages[0].content).toContain("List at most 3 short facts");
    expect(body.messages[1]).toMatchObject({ role: "user", content: "I give talks about solar panels, answer in short sentences", images: [] });
  });

  it("online: refused without the yes for the saved preferences, or without the question's own yes", async () => {
    for (const headers of [{}, ASK, MEMORY]) expect((await learn(post({ question: "answer in short sentences", provider: "cloud" }, headers))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
  });

  it("online with both yeses: the same recipient as the answer, the question only", async () => {
    const res = await learn(post({ question: "answer in short sentences", provider: "cloud" }, { ...ASK, ...MEMORY }));
    expect(res.status).toBe(200);
    expect(outside()).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(sent().messages.at(-1).content).toEqual([{ type: "text", text: "answer in short sentences" }]);
  });
});
