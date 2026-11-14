import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resume after Stop through the real route and the real local provider, with Ollama's HTTP answer
// faked: the model gets the conversation ending with the part the user saw, then the instruction to
// carry on, never the question a second time.
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));
vi.mock("@/lib/sysinfo", () => ({
  gpuInfo: async () => ({ kind: "none", vramGb: null }),
  machineInfo: () => ({ ramGb: 16, cores: 8, gpu: { kind: "none", vramGb: null }, freeDiskGb: 500 }),
}));

const { POST } = await import("@/app/api/buddy/ask/route");
const { RESUME_NOTE, SCREEN_NOTE, resumeQuestion } = await import("./prompt");
const image = "data:image/png;base64,iVBORw0KGgo=";
const line = (content: string, done = false) => JSON.stringify({ message: { content }, done }) + "\n";

type Message = { role: string; content: string; images?: string[] };
let calls: Array<{ messages: Message[] }> = [];
function fakeOllama(text: string) {
  vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [] });
    calls.push(JSON.parse(init.body ?? "{}"));
    return new Response(line(text) + line("", true));
  });
}
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://127.0.0.1/api/buddy/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screens: [{ index: 1, width: 10, height: 10 }], provider: "local", ...body }) }));
const stopped = [
  { role: "user", text: "hi" },
  { role: "assistant", text: "Hello." },
  { role: "user", text: "explain photosynthesis" },
  { role: "assistant", text: "Plants take in light." },
];

beforeEach(() => { calls = []; vi.stubEnv("BUDDY_LOCAL_MODEL", "fake-vl"); vi.stubEnv("FILOW_OFFLINE", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Resume after Stop on the request", () => {
  it("the model gets the stopped answer as its own last turn, then the instruction to carry on", async () => {
    fakeOllama("They make sugar.");
    const res = await post({ question: "explain photosynthesis", history: stopped, resume: true, sees: false });
    expect(await res.text()).toBe("They make sugar.");
    expect(res.headers.get("X-Buddy-Resume")).toBe("1");
    const messages = calls[0].messages;
    expect(messages.slice(-3).map((m) => [m.role, m.content])).toEqual([
      ["user", "explain photosynthesis"],
      ["assistant", "Plants take in light."],
      ["user", RESUME_NOTE],
    ]);
    // The question is in the conversation once: it is not asked a second time.
    expect(messages.filter((m) => m.content.includes("explain photosynthesis"))).toHaveLength(1);
    expect(messages.at(-1)?.images).toEqual([]);
  });

  it("a stopped answer to a photo request is carried on by the model, not answered with the card a second time", async () => {
    fakeOllama("It beats all day.");
    const history = [{ role: "user", text: "show me a picture of a heart" }, { role: "assistant", text: "Here is heart," }];
    const res = await post({ question: "show me a picture of a heart", history, resume: true, sees: false });
    expect(await res.text()).toBe("It beats all day.");
    expect(res.headers.get("X-Buddy-Resume")).toBe("1");
    expect(calls).toHaveLength(1);
  });

  it("the instruction says the four things: carry on from where it stopped, repeat nothing, start with the next sentence, same language", () => {
    expect(RESUME_NOTE).toMatch(/from exactly where it stopped/);
    expect(RESUME_NOTE).toMatch(/Do not repeat/);
    expect(RESUME_NOTE).toMatch(/next sentence/);
    expect(RESUME_NOTE).toMatch(/same language/);
  });

  it("with the eye open the screenshot goes with the continuation; with it closed none does", async () => {
    fakeOllama("They make sugar.");
    await (await post({ question: "explain photosynthesis", history: stopped, resume: true, sees: true, images: [image] })).text();
    expect(calls[0].messages.at(-1)?.images).toHaveLength(1);
    expect(calls[0].messages.at(-1)?.content).toBe(RESUME_NOTE + SCREEN_NOTE);
    await (await post({ question: "explain photosynthesis", history: stopped, resume: true, sees: false, images: [image] })).text();
    expect(calls[1].messages.at(-1)?.images).toEqual([]);
  });

  it("without the flag, or when the conversation does not end with a stopped answer, the question is asked as usual", async () => {
    fakeOllama("ok");
    const plain = await post({ question: "explain photosynthesis", history: stopped, sees: false });
    await plain.text();
    expect(plain.headers.get("X-Buddy-Resume")).toBe("0");
    expect(calls[0].messages.at(-1)?.content).toBe("explain photosynthesis");
    const dangling = await post({ question: "explain photosynthesis", history: stopped.slice(0, 3), resume: true, sees: false });
    await dangling.text();
    expect(dangling.headers.get("X-Buddy-Resume")).toBe("0");
    expect(calls[1].messages.at(-1)?.content).toBe("explain photosynthesis");
    expect(resumeQuestion(undefined, true)).toBe(null);
    expect(resumeQuestion([], true)).toBe(null);
    expect(resumeQuestion([{ role: "assistant", text: "Alone." }], true)).toBe(null);
    expect(resumeQuestion([{ role: "user", text: "q" }, { role: "assistant", text: "  " }], true)).toBe(null);
    expect(resumeQuestion([{ role: "user", text: "q" }, { role: "assistant", text: "A." }], "true")).toBe(null);
    expect(resumeQuestion([{ role: "user", text: "q" }, { role: "assistant", text: "A." }], true)).toBe(RESUME_NOTE);
  });

  it("a resumed answer to a draw request is carried on as text, not drawn again", async () => {
    fakeOllama("and wheels.");
    const res = await post({ question: "draw a car", history: [{ role: "user", text: "draw a car" }, { role: "assistant", text: "Here is a car with a body." }], resume: true, sees: false });
    expect(await res.text()).toBe("and wheels.");
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].content).not.toContain("The user asked you for a drawing");
  });

  it("the answer's language is still chosen from the question, not from the instruction", async () => {
    fakeOllama("Poi producono zucchero.");
    const res = await post({ question: "spiegami la fotosintesi clorofilliana delle piante", history: [{ role: "user", text: "spiegami la fotosintesi clorofilliana delle piante" }, { role: "assistant", text: "Le piante assorbono la luce." }], resume: true, sees: false });
    await res.text();
    expect(res.headers.get("X-Buddy-Lang")).toBe("it");
  });
});
// Version rejection is covered with real HTTP fakes in ollama-runtime.test.ts.
vi.mock("@/../desktop/ollama-runtime", async (original) => ({ ...await original<object>(), checkRuntime: async () => ({ state: "ready" }) }));
