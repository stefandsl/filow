import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real route and the real local provider, with Ollama's HTTP answer faked: what happens upstream
// when the panel stops an answer, what the switch "Look at my screen" does to the request, and how a
// draw request is asked. No hardware probe: the setup is faked as a PC that reads pictures.
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));
vi.mock("@/lib/sysinfo", () => ({
  gpuInfo: async () => ({ kind: "none", vramGb: null }),
  machineInfo: () => ({ ramGb: 16, cores: 8, gpu: { kind: "none", vramGb: null }, freeDiskGb: 500 }),
}));

const { POST } = await import("@/app/api/buddy/ask/route");
const { SCREEN_NOTE } = await import("./prompt");
const image = "data:image/png;base64,iVBORw0KGgo=";
const CAR = '```drawing2d\n{"title":"Car","shapes":[{"type":"rect","x":60,"y":120,"w":280,"h":70,"fill":"#d33a2c"}]}\n```';
const line = (content: string, done = false) => JSON.stringify({ message: { content }, done }) + "\n";

type Call = { url: string; body: { model: string; messages: Array<{ role: string; content: string; images?: string[] }> }; signal: AbortSignal };
let calls: Call[] = [];
/** Ollama: /api/tags lists nothing; /api/chat streams `reply(n)` word by word and never ends unless told to. */
function fakeOllama(reply: (n: number) => { text: string; endless?: boolean }) {
  vi.stubGlobal("fetch", async (url: string, init: { body?: string; signal: AbortSignal }) => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [] });
    const call: Call = { url: String(url), body: JSON.parse(init.body ?? "{}"), signal: init.signal };
    calls.push(call);
    const { text, endless } = reply(calls.length);
    const enc = new TextEncoder();
    const words = text.match(/\S+\s*|\s+/g) ?? [];
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (init.signal.aborted) return controller.error(new DOMException("aborted", "AbortError"));
        if (i < words.length) return controller.enqueue(enc.encode(line(words[i++])));
        if (!endless) { controller.enqueue(enc.encode(line("", true))); return controller.close(); }
        // The model is still generating: only an abort ends it.
        await new Promise<void>((res) => init.signal.addEventListener("abort", () => res(), { once: true }));
        controller.error(new DOMException("aborted", "AbortError"));
      },
    }));
  });
}
const post = (body: Record<string, unknown>, signal?: AbortSignal) =>
  POST(new Request("http://127.0.0.1/api/buddy/ask", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screens: [{ index: 1, width: 10, height: 10 }], provider: "local", ...body }) }));

beforeEach(() => { calls = []; vi.stubEnv("BUDDY_LOCAL_MODEL", "fake-vl"); vi.stubEnv("FILOW_OFFLINE", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Stop reaches the model", () => {
  it("the panel aborting its request ends the call to Ollama, and the stream closes without an error line", async () => {
    fakeOllama(() => ({ text: "Photosynthesis is how plants ", endless: true }));
    const panel = new AbortController();
    const res = await post({ question: "explain photosynthesis at length", images: [image] }, panel.signal);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe("Photosynthesis ");
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);
    panel.abort();
    let rest = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    expect(calls[0].signal.aborted).toBe(true);
    expect(rest).not.toContain("[ERROR]");
  });

  it("a reader that goes away (the page closed) ends the call to Ollama too", async () => {
    fakeOllama(() => ({ text: "One two three ", endless: true }));
    const res = await post({ question: "count for me", images: [image] });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("a request that was already given up when it arrived never reaches the model's answer", async () => {
    fakeOllama(() => ({ text: "One two three ", endless: true }));
    const gone = new AbortController();
    gone.abort();
    const res = await post({ question: "count for me", images: [image] }, gone.signal).catch(() => null);
    if (res) await res.text().catch(() => "");
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
  });

  it("a Stop during a draw request ends its call and never starts the second try", async () => {
    fakeOllama(() => ({ text: "I can't draw ", endless: true }));
    const panel = new AbortController();
    const res = await post({ question: "draw a car", images: [image] }, panel.signal);
    const reading = res.text();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    panel.abort();
    expect(await reading).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
  });
});

describe('"Look at my screen" on the request', () => {
  it("off: no screenshot is needed, none reaches the model, and the answer says it went with words only", async () => {
    fakeOllama(() => ({ text: "A fine day." }));
    const res = await post({ question: "how are you?", sees: false, images: [image] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("A fine day.");
    expect(res.headers.get("X-Buddy-Sees")).toBe("text");
    expect(calls[0].body.messages.at(-1)?.images).toEqual([]);
    expect(calls[0].body.messages.at(-1)?.content).toBe("how are you?");
    expect(calls[0].body.messages[0].content).toContain("you cannot see the screen");
    const none = await post({ question: "how are you?", sees: false });
    expect(none.status).toBe(200);
    await none.text();
  });

  it("on, or not chosen: a screenshot per screen is required and goes to the model on this PC", async () => {
    fakeOllama(() => ({ text: "ok" }));
    expect((await post({ question: "what is this?" })).status).toBe(400);
    expect((await post({ question: "what is this?", sees: true })).status).toBe(400);
    const res = await post({ question: "what is this?", sees: true, images: [image] });
    await res.text();
    expect(res.headers.get("X-Buddy-Sees")).toBe("screen");
    expect(calls[0].body.messages.at(-1)?.images).toHaveLength(1);
    expect(calls[0].body.messages[0].content).toContain("[POINT:x,y:label:screenN]");
    // with a screenshot the question is followed by the reminder to answer the question itself
    expect(calls[0].body.messages.at(-1)?.content).toBe("what is this?" + SCREEN_NOTE);
  });
});

describe("a draw request through the route", () => {
  it("is asked with the drawing prompt and no screenshot, and a refusal is replaced by the second try's drawing", async () => {
    fakeOllama((n) => ({ text: n === 1 ? "I can't draw directly on your screen, but I can describe it." : `Here is a car. ${CAR}` }));
    const res = await post({ question: "draw a car", images: [image] });
    const out = await res.text();
    expect(out).toBe(`Here is a car. ${CAR}`);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.body.messages[0].content).toContain("The user asked you for a drawing");
      expect(c.body.messages.at(-1)?.images).toEqual([]);
      expect(c.body.messages.at(-1)?.content).toBe("draw a car");
    }
    expect(res.headers.get("X-Buddy-Sees")).toBe("text");
  });

  it("online without the user's yes: refused before anything is asked, on the draw path as on any other", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    fakeOllama(() => ({ text: "never" }));
    const res = await post({ question: "draw a car", images: [image], provider: "cloud" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("the selected text the panel adds after the question does not turn a question into a draw request", async () => {
    fakeOllama(() => ({ text: "It means a horse." }));
    const res = await post({ question: "What does it mean?\n(Text I have selected: \"draw a horse\")", images: [image] });
    expect(await res.text()).toBe("It means a horse.");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages[0].content).not.toContain("The user asked you for a drawing");
    expect(calls[0].body.messages.at(-1)?.images).toHaveLength(1);
  });

  it("works with the switch off as well (drawing needs no screen)", async () => {
    fakeOllama(() => ({ text: `Ecco. ${CAR}` }));
    const res = await post({ question: "disegna una macchina", sees: false });
    expect(await res.text()).toBe(`Ecco. ${CAR}`);
    expect(calls).toHaveLength(1);
  });

  it("an ordinary question is streamed as before, with the normal prompt", async () => {
    fakeOllama(() => ({ text: "Click Save." }));
    const res = await post({ question: "where do I save this?", images: [image] });
    expect(await res.text()).toBe("Click Save.");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages[0].content).not.toContain("The user asked you for a drawing");
  });
});
