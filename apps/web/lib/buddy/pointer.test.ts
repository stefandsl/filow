import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diskNeededGb, resolveSetup, type MachineInfo } from "@filow/core";
import * as sysinfo from "@/lib/sysinfo";
import { POST as ask } from "@/app/api/buddy/ask/route";
import { POST as warm } from "@/app/api/buddy/warm/route";
import { GET as status } from "@/app/api/local/status/route";
import { isPointOnly, pointQuestion, withPointer } from "./pointer";
import { parseBuddyAnswer, withScreenNote } from "./prompt";
import { localHelper } from "./providers";

// Measured on the owner's PC (RTX 3070, 8 GB): Gemma 4 E4B answers and draws well and fast but puts
// its points 40 to 70 pixels off; lfm3-vl places them. When both are installed Best quality answers
// with Gemma and lets lfm3-vl place the points. Ollama is a stub here.

const gpu: MachineInfo["gpu"] = { kind: "discrete", vramGb: 8, ollama: true };
const PAIR = ["gemma4:e4b", "lfm3-vl:latest", "clef-flash:latest", "qwen3-vl:8b"];
const hw = (installed: string[], over: Partial<MachineInfo> = {}): MachineInfo => ({ ramGb: 32, cores: 16, gpu, freeDiskGb: 500, installed, ...over });

async function collect(pieces: string[], ground: (label: string) => Promise<string>, stopped?: () => boolean) {
  const asked: string[] = [];
  const out: string[] = [];
  const src = (async function* () { for (const p of pieces) yield p; })();
  for await (const p of withPointer(src, async (l) => { asked.push(l); return ground(l); }, stopped)) out.push(p);
  return { out, text: out.join(""), asked };
}

describe("the answer's own points are replaced by the pointing model's", () => {
  it("takes the POINT tags out as the answer streams, also when a tag is split over pieces, and adds the pointing model's tag with the answer's label", async () => {
    const { text, asked, out } = await collect(
      ["Click Save, top left [PO", "INT:187,152:Save button:screen1] and then ", "Print [POINT:326,163:Print button]."],
      async (l) => (l === "Save button" ? "[POINT:254,229:the save:screen1]" : "[POINT:324.4,229:Print]"),
    );
    expect(asked).toEqual(["Save button", "Print button"]);
    expect(text).toBe("Click Save, top left  and then Print . [POINT:254,229:Save button:screen1] [POINT:324,229:Print button]");
    // nothing of the wrong tag ever went out, not even its beginning
    expect(out.slice(0, -2).join("|")).not.toMatch(/187|152|\[/);
    const { points, text: shown } = parseBuddyAnswer(text, [{ index: 1, width: 1024, height: 576 }]);
    expect(points.map((p) => [p.x, p.y, p.label])).toEqual([[254, 229, "Save button"], [324, 229, "Print button"]]);
    expect(shown).toBe("Click Save, top left and then Print.");
  });

  it("the words go out at once, before the pointing model is asked", async () => {
    const order: string[] = [];
    const src = (async function* () { yield "Here it is [POINT:1,2:Start]."; })();
    for await (const p of withPointer(src, async () => { order.push("asked"); return "[POINT:30,950:x:screen2]"; })) order.push(p);
    // the screen is the one the pointing model found the thing on
    expect(order).toEqual(["Here it is .", "asked", " [POINT:30,950:Start:screen2]"]);
  });

  it("other marks, cards, drawings and ordinary brackets pass through untouched", async () => {
    const answer = "That panel [BOX:620,140,980,560:Layers panel] lists a[0] and [CARD:500,400:Heart|text|Heart]. ```drawing2d\n{}\n```";
    const { text, asked } = await collect(answer.match(/[\s\S]{1,7}/g) ?? [], async () => "NONE");
    expect(text).toBe(answer);
    expect(asked).toEqual([]);
  });

  it("at most three things, each once; NONE, an error or a point off the grid add nothing", async () => {
    const { text, asked } = await collect(
      ["[POINT:1,1:A] [POINT:2,2:a] [POINT:3,3:B] [POINT:4,4:C] [POINT:5,5:D] [POINT:6,6:]"],
      async (l) => { if (l === "A") return "NONE"; if (l === "B") throw new Error("Ollama 500"); return "[POINT:1200,5:x]"; },
    );
    expect(asked).toEqual(["A", "B", "C"]);
    expect(text.trim()).toBe("");
  });

  it("a tag the model never closed is not shown, and after a Stop the pointing model is not asked", async () => {
    expect((await collect(["Look [POINT:12,3"], async () => "NONE")).text).toBe("Look ");
    const stopped = await collect(["Here [POINT:1,2:Start]"], async () => "[POINT:30,950:x]", () => true);
    expect(stopped.asked).toEqual([]);
    expect(stopped.text).toBe("Here ");
  });

  it("a [POINT: that runs on without its end is the answer's text: the rest of the answer is not lost (found in review)", async () => {
    const long = "Click it [POINT:500,300:Save then click the big green button that says Send and after that close the window, and you are done with all of it.";
    const { text } = await collect(long.match(/[\s\S]{1,9}/g) ?? [], async () => "NONE");
    expect(text).toBe(long);
  });

  it("the narrow question says what to reply, so no screen note is added to it", () => {
    expect(isPointOnly(pointQuestion("Save button"))).toBe(true);
    expect(withScreenNote(pointQuestion("Save button"), true)).toBe(pointQuestion("Save button"));
    expect(isPointOnly("where is the Save button?")).toBe(false);
  });
});

describe("Best quality answers with Gemma 4 E4B and points with lfm3-vl when both are already installed", () => {
  it("the setup says so, lists both as its models and downloads nothing for it", () => {
    const s = resolveSetup("auto", hw(PAIR));
    expect(s.active).toBe("advanced");
    expect(s.choices.screenHelper).toMatchObject({ mode: "picture", model: "gemma4:e4b", pointer: "lfm3-vl" });
    expect(s.choices.models.map((m) => m.name)).toEqual(["nemotron-streaming", "paraphrase-multilingual-MiniLM-L12-v2", "clef-flash", "gemma4:e4b", "lfm3-vl"]);
    expect(diskNeededGb(s.choices.models, PAIR)).toBe(0);
  });

  it.each([
    ["only Gemma", ["gemma4:e4b", "qwen3-vl:2b"]],
    ["only lfm3-vl", ["lfm3-vl:latest", "qwen3-vl:2b"]],
    ["the smaller Gemma", ["gemma4:e2b", "lfm3-vl:latest"]],
    ["nothing yet", []],
  ])("%s installed: Qwen3-VL 2B stays the helper and the download, with no pointing model", (_n, installed) => {
    const s = resolveSetup("auto", hw(installed as string[]));
    expect(s.choices.screenHelper.model).toBe("qwen3-vl:2b");
    expect(s.choices.screenHelper.pointer).toBeUndefined();
    expect(s.choices.models.map((m) => m.name)).toContain("qwen3-vl:2b");
    expect(s.choices.models.map((m) => m.name)).not.toContain("gemma4:e4b");
  });

  it("Balanced and Light keep their own helper whatever is installed", () => {
    expect(resolveSetup("standard", hw(PAIR)).choices.screenHelper).toMatchObject({ model: "lfm3-vl", mode: "picture" });
    expect(resolveSetup("standard", hw(PAIR)).choices.screenHelper.pointer).toBeUndefined();
    expect(resolveSetup("lite", hw(PAIR)).choices.screenHelper.pointer).toBeUndefined();
  });

  it("each question goes to the right one of the two", () => {
    const s = resolveSetup("auto", hw(PAIR));
    expect(localHelper(s, PAIR, "where is the Save button?", undefined)).toEqual({ model: "gemma4:e4b", pictures: true, pointer: "lfm3-vl" });
    expect(localHelper(s, PAIR, pointQuestion("Save button"), undefined)).toEqual({ model: "lfm3-vl", pictures: true });
    // a drawing, with or without the screenshot: Gemma, and never Qwen3-VL 8B swapped in for it
    expect(localHelper(s, PAIR, "draw a car", undefined).model).toBe("gemma4:e4b");
    expect(localHelper(s, PAIR, "explain this chart with a diagram", undefined).model).toBe("gemma4:e4b");
    // "Look at my screen" off: no picture goes to a model, so there is nothing to point at
    expect(localHelper(s, PAIR, "where is the Save button?", undefined, false)).toEqual({ model: "gemma4:e4b", pictures: false });
    expect(localHelper(s, PAIR, pointQuestion("Save button"), undefined, false)).toEqual({ model: "gemma4:e4b", pictures: false });
  });
});

describe("the ask route, end to end on the server", () => {
  const shot = { images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
  const request = (body: unknown) => new Request("http://unit.invalid/api/buddy/ask", { method: "POST", body: JSON.stringify(body) });
  let chats: Array<{ model: string; messages: Array<{ role: string; content: string; images?: string[] }> }>;
  let loads: string[];
  let installed: string[];
  beforeEach(() => {
    for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "1", OLLAMA_URL: "http://127.0.0.1:11434", BUDDY_LOCAL_MODEL: "" })) vi.stubEnv(k, v);
    chats = [];
    loads = [];
    installed = PAIR;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/tags")) return Response.json({ models: installed.map((name) => ({ name })) });
      if (String(url).endsWith("/api/version")) return Response.json({ version: "0.40.13" });
      if (String(url).endsWith("/api/generate")) { loads.push((JSON.parse(String(init?.body)) as { model: string }).model); return Response.json({}); }
      if (String(url).endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body)) as (typeof chats)[number];
        chats.push(body);
        const reply = body.model === "lfm3-vl" ? "[POINT:254,229:Save:screen1]" : "Click Save [POINT:187,152:Save button:screen1].";
        return new Response(`${JSON.stringify({ message: { content: reply }, done: true })}\n`);
      }
      throw new Error(`unexpected ${url}`);
    }));
    vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "discrete", vramTotalGb: 8, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
    vi.spyOn(sysinfo, "machineInfo").mockImplementation((_gpu, list) => hw(list ?? []));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("Gemma answers with the screenshot, lfm3-vl places the point, and the answer carries only lfm3-vl's position", async () => {
    const res = await ask(request({ question: "where do I save?", ...shot, provider: "local", history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }));
    expect(await res.text()).toBe("Click Save . [POINT:254,229:Save button:screen1]");
    expect(chats[0].messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(res.headers.get("X-Buddy-Sees")).toBe("screen");
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b", "lfm3-vl"]);
    expect(chats[1].messages.at(-1)?.content).toBe(pointQuestion("Save button"));
    expect(chats[1].messages.at(-1)?.images).toEqual(["YQ=="]);
    // a tag is short: the pointing model gets a small token limit, not the answer's
    expect((chats[1] as { options?: { num_predict?: number } }).options?.num_predict).toBe(60);
    expect((chats[0] as { options?: { num_predict?: number } }).options?.num_predict).toBe(1500);
    // the pointing model gets no conversation: only the screenshot and the one thing to find
    expect(chats[1].messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("the page's own follow-up for a point goes to lfm3-vl, once", async () => {
    await (await ask(request({ question: `where do I save?\nYou answered: "Click Save". Reply with only the tag [POINT:x,y:label:screenN] for that thing.`, ...shot, provider: "local" }))).text();
    expect(chats.map((c) => c.model)).toEqual(["lfm3-vl"]);
  });

  it('with "Look at my screen" off nothing is pointed at and lfm3-vl is not asked', async () => {
    const res = await ask(request({ question: "where do I save?", ...shot, provider: "local", sees: false }));
    await res.text();
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b"]);
    expect(chats[0].messages.at(-1)?.images).toEqual([]);
  });

  it("without the pair nothing changes: one call, the model's own tags", async () => {
    installed = ["qwen3-vl:2b", "gemma4:e4b"];
    const res = await ask(request({ question: "where do I save?", ...shot, provider: "local" }));
    expect(await res.text()).toBe("Click Save [POINT:187,152:Save button:screen1].");
    expect(chats.map((c) => c.model)).toEqual(["qwen3-vl:2b"]);
  });

  it("Settings is told that both models are in use, so neither is offered for deletion as unused", async () => {
    const res = await status(new Request("http://unit.invalid/api/local/status"));
    const { picks } = (await res.json()) as { picks: { okfilow: string[] } };
    expect(picks.okfilow.sort()).toEqual(["gemma4:e4b", "lfm3-vl"]);
  });

  it("warming loads both models of the pair", async () => {
    const res = await warm(request({}));
    expect(await res.json()).toMatchObject({ model: "gemma4:e4b", ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(loads.sort()).toEqual(["gemma4:e4b", "lfm3-vl"]);
  });
});
