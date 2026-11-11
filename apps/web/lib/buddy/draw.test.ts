import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSetup, type MachineInfo } from "@filow/core";
import { drawnAnswer, hasPicture } from "./draw";
import { buddySystemPrompt, parseBuddyAnswer } from "./prompt";
import { askBuddy, buddyCloudRecipient, localHelper, wantsVisual, type AskShape } from "./providers";
import { consentKey } from "./outbound";
import { OKF_TEXT } from "./text";
import { drawOnlyPrompt, extractVisuals, isExampleCopy, wantsDrawing } from "./visuals";

const CAR = '```drawing2d\n{"title":"Car","shapes":[{"type":"rect","x":60,"y":120,"w":280,"h":70,"fill":"#d33a2c"},{"type":"circle","cx":120,"cy":200,"r":28,"fill":"#222222"},{"type":"circle","cx":280,"cy":200,"r":28,"fill":"#222222"}]}\n```';
const SUN = '```drawing2d\n{"title":"Car","shapes":[{"type":"rect","x":0,"y":0,"w":400,"h":300,"fill":"#bfe3ff"},{"type":"circle","cx":200,"cy":150,"r":60,"fill":"#ffcc33","stroke":"#e0a000","width":4},{"type":"line","x1":200,"y1":60,"x2":200,"y2":20,"stroke":"#e0a000","width":4},{"type":"path","d":"M 170 170 Q 200 195 230 170","fill":"none","stroke":"#7a4b00","width":4}]}\n```';
const MODEL = '```model3d\n{"title":"Car","parts":[{"name":"Body","shape":"box","size":[3,0.8,1.4],"pos":[0,0.4,0],"rot":[0,0,0],"color":"#d33a2c"}]}\n```';
// The owner's screenshot (2026-11-11): the answer he got when he asked for a car.
const REFUSAL = "I can't draw directly on your screen, but I can show you a 3D car model using a drawing tool. Let me describe it: a rectangular body with wheels, a roof, and a hood. Would you like me to guide you through drawing it step by step?";

describe("a plain request to draw is recognised in the five languages", () => {
  it.each([
    ["draw a car", "2d"], ["Draw me a car, please", "2d"], ["sketch a house", "2d"], ["make a quick drawing of a cat", "2d"],
    ["disegna una macchina", "2d"], ["mi disegni un albero?", "2d"],
    ["нарисуй машину", "2d"], ["Нарисуйте дом", "2d"], ["Можешь нарисовать машину?", "2d"], ["Can you draw me a cat?", "2d"],
    // only the user's own words count: the selected text the panel adds on the next lines does not
    ["Draw a car\n(Text I have selected: \"click this button here\")", "2d"],
    ["desenează o mașină", "2d"], ["fă-mi o schiță cu o casă", "2d"],
    ["車の絵を描いて", "2d"], ["猫を描いてください", "2d"],
    ["draw a 3D car", "3d"], ["show me a 3d model of a car", "3d"], ["make a 3-D model of a car", "3d"],
    ["fammi un modello 3D di una macchina", "3d"], ["сделай 3D модель машины", "3d"], ["покажи трёхмерную модель машины", "3d"],
    ["fă un model 3D al unei mașini", "3d"], ["車の3Dモデルを作って", "3d"], ["車の３Ｄモデルを見せて", "3d"],
  ] as const)("%s -> %s", (q, kind) => expect(wantsDrawing(q)).toBe(kind));

  it.each([
    "what model is this laptop?", "where do I save this?", "how do I withdraw money here?", "che modello di telefono è?",
    "what is a 3D printer?", "open the drawer", "",
    // questions about a program or about how something is done keep the normal answer (found in review)
    "How do I draw a table in Word?", "What does the Draw tab do in PowerPoint?", "Come si usa lo strumento disegno in Paint?",
    "How do I make a 3D chart in Excel?", "Which 3D model formats does Blender open?", "3D表示をオフにするには", "как рисовать в Paint?", "cum desenez un tabel în Word?",
    // a 3D thing named without asking for one: a part clicked in the model window asks about it
    "a 3-D car model", "Tell me about the wheel of the 3D car model",
    // the words that would make it a drawing request are in the selected text, not in what the user said
    "What does it mean?\n(Text I have selected: \"draw a horse\")",
    // a mark on what is on the screen is the normal answer's job (its [CIRCLE] and [ARROW] tags)
    "draw a circle around the Save button", "draw an arrow to the menu", "disegna un cerchio intorno al pulsante Salva", "нарисуй стрелку к кнопке", "desenează o săgeată spre buton", "ここに丸を描いて", "draw this",
  ])("%s -> not a drawing request", (q) => expect(wantsDrawing(q)).toBeNull());

  it("sends a drawing in any of the five languages to the bigger picture model on Best quality", () => {
    const hw: MachineInfo = { ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb: 8, ollama: true }, freeDiskGb: 500 };
    const best = resolveSetup("advanced", hw);
    for (const q of ["нарисуй машину", "desenează o mașină", "車の絵を描いて"]) {
      expect(wantsVisual(q)).toBe(true);
      expect(localHelper(best, ["qwen3-vl:2b", "qwen3-vl:8b"], q, undefined).model).toBe("qwen3-vl:8b");
    }
    expect(localHelper(best, ["qwen3-vl:2b", "qwen3-vl:8b"], "где кнопка сохранить?", undefined).model).toBe("qwen3-vl:2b");
  });
});

describe('the user\'s "Look at my screen" choice comes before the setup\'s pick on this PC', () => {
  const none: MachineInfo["gpu"] = { kind: "none", vramGb: null };
  const modest = resolveSetup("auto", { ramGb: 7, cores: 4, gpu: none, freeDiskGb: 500 });
  const capable = resolveSetup("auto", { ramGb: 16, cores: 8, gpu: none, freeDiskGb: 500 });

  it("not chosen: the setup decides, as before", () => {
    expect(localHelper(modest, [], "what is this?", undefined)).toEqual({ model: "lfm3-vl", pictures: false });
    expect(localHelper(capable, [], "what is this?", undefined)).toEqual({ model: "lfm3-vl", pictures: true });
  });

  it("on: a modest PC reads the screen too (slower, the user's call); off: a capable one answers from words", () => {
    expect(localHelper(modest, [], "what is this?", undefined, true)).toEqual({ model: "lfm3-vl", pictures: true });
    expect(localHelper(capable, [], "what is this?", undefined, false)).toEqual({ model: "lfm3-vl", pictures: false });
    expect(localHelper(capable, [], "q", "my-vl", false)).toEqual({ model: "my-vl", pictures: false });
  });
});

describe("the prompt tells the model it can draw, whether or not it sees the screen", () => {
  const screens = [{ index: 1, width: 1024, height: 576, cursor: true }];
  const seeing = buddySystemPrompt(screens, "en");
  const words = buddySystemPrompt(screens, "en", { pictures: false });

  it("both modes carry the drawing and the 3D model instructions and say never to refuse", () => {
    for (const p of [seeing, words]) {
      expect(p).toContain("```drawing2d");
      expect(p).toContain("```model3d");
      expect(p).toContain("You can draw.");
      expect(p).toContain("Never say that you cannot draw");
    }
  });

  it("only the mode that sees the screen offers the tags that need a place on it", () => {
    for (const tag of ["[POINT:x,y:label:screenN]", "[CIRCLE:x,y,r:label]", "[ARROW:x1,y1,x2,y2:label]", "[BOX:x1,y1,x2,y2:label]", "[UNDERLINE:x1,y,x2:label]", "[CARD:x,y:"]) {
      expect(seeing).toContain(tag);
      expect(words).not.toContain(tag);
    }
    expect(words).toContain("Never write tags in square brackets");
    expect(words).toContain("you cannot see the screen");
    expect(seeing).not.toContain("you cannot see the screen");
  });

  it("the drawing-only prompt asks for one format, in the user's language, and forbids copying the example", () => {
    const flat = drawOnlyPrompt("2d", "Italian");
    expect(flat).toContain("```drawing2d");
    expect(flat).not.toContain("```model3d");
    expect(flat).toContain("in Italian");
    expect(flat).toContain("Do not copy it");
    expect(flat).not.toContain("[POINT");
    expect(flat).not.toContain("Your last reply");
    const solid = drawOnlyPrompt("3d", "English", true);
    expect(solid).toContain("```model3d");
    expect(solid).not.toContain("```drawing2d");
    expect(solid).toContain("Your last reply had no usable picture");
  });
});

describe("what counts as a picture", () => {
  it("a real drawing or model does, a refusal or the prompt's own example does not", () => {
    expect(hasPicture(`Here is a car. ${CAR}`)).toBe(true);
    expect(hasPicture(MODEL)).toBe(true);
    expect(hasPicture(REFUSAL)).toBe(false);
    expect(hasPicture(`Here is a car. ${SUN}`)).toBe(false);
    expect(hasPicture("Here is a car. ```drawing2d\n{\"title\":\"Car\",\"shapes\":[{\"type\":\"rect\"")).toBe(false);
  });

  it("the example written back is never shown as the user's drawing", () => {
    expect(isExampleCopy(JSON.parse(SUN.slice(13, -4)))).toBe(true);
    expect(isExampleCopy(JSON.parse(CAR.slice(13, -4)))).toBe(false);
    expect(isExampleCopy(null)).toBe(false);
    const v = extractVisuals(`A car. ${SUN}`, () => true);
    expect(v.drawing).toBeNull();
    expect(v.body.trim()).toBe("A car.");
  });

  it("the label a small model copies from the prompt's examples is not shown or spoken", () => {
    const screens = [{ index: 1, width: 10, height: 10 }];
    expect(parseBuddyAnswer("You: 2 + 2 = 4.", screens).text).toBe("2 + 2 = 4.");
    expect(parseBuddyAnswer("You:Click Save [POINT:42,31:Save button].", screens).text).toBe("Click Save.");
    expect(parseBuddyAnswer("Do you: yes or no?", screens).text).toBe("Do you: yes or no?");
    expect(parseBuddyAnswer("Your file is saved.", screens).text).toBe("Your file is saved.");
  });

  it("a drawing with no sentence around it still parses as an answer with a drawing", () => {
    const a = parseBuddyAnswer(CAR, [{ index: 1, width: 10, height: 10 }]);
    expect(a.text).toBe("");
    expect(a.drawing?.shapes).toHaveLength(3);
  });
});

describe("a draw request is answered with a picture, never with a refusal", () => {
  const run = async (replies: Array<string | Error>, opts: { signal?: AbortSignal; firstMs?: number; retryMs?: number; lang?: string } = {}) => {
    const shapes: AskShape[] = [];
    const ask = (shape: AskShape, signal: AbortSignal) => (async function* () {
      shapes.push(shape);
      const r = replies[shapes.length - 1];
      if (r instanceof Error) throw r;
      if (r === "HANG") { await new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new DOMException("timed out", "TimeoutError")))); }
      for (const piece of (r ?? "").match(/[\s\S]{1,40}/g) ?? []) yield piece;
    })();
    let out = "";
    for await (const piece of drawnAnswer(ask, { kind: "2d", language: "en", lang: opts.lang ?? "en", signal: opts.signal ?? new AbortController().signal, firstMs: opts.firstMs, retryMs: opts.retryMs })) out += piece;
    return { out, shapes };
  };

  it("a first reply with a drawing goes out whole, after one call, with no screenshot", async () => {
    const { out, shapes } = await run([`Here is a car. ${CAR}`]);
    expect(out).toBe(`Here is a car. ${CAR}`);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].pictures).toBe(false);
    expect(shapes[0].system).toContain("```drawing2d");
    expect(shapes[0].system).not.toContain("Your last reply");
  });

  it("a refusal is never shown: the model is asked once more and that drawing is the answer", async () => {
    const { out, shapes } = await run([REFUSAL, `Ecco. ${CAR}`]);
    expect(out).toBe(`Ecco. ${CAR}`);
    expect(out).not.toContain("can't draw");
    expect(shapes).toHaveLength(2);
    expect(shapes[1].system).toContain("Your last reply had no usable picture");
    expect(shapes[1].pictures).toBe(false);
  });

  it("the example written back counts as no drawing and is asked again", async () => {
    const { out, shapes } = await run([`A car. ${SUN}`, `A car. ${CAR}`]);
    expect(out).toBe(`A car. ${CAR}`);
    expect(shapes).toHaveLength(2);
  });

  it("asks at most twice, then says plainly that the drawing did not come, in the user's language", async () => {
    const { out, shapes } = await run([REFUSAL, REFUSAL, `late ${CAR}`]);
    expect(shapes).toHaveLength(2);
    expect(out).toBe(OKF_TEXT.en.drawFailed);
    expect((await run([REFUSAL, REFUSAL], { lang: "it" })).out).toBe(OKF_TEXT.it.drawFailed);
  });

  it("the second try has a time limit, and a failure of it is not an error", async () => {
    const slow = await run([REFUSAL, "HANG"], { retryMs: 30 });
    expect(slow.out).toBe(OKF_TEXT.en.drawFailed);
    expect((await run([REFUSAL, new Error("Ollama 500")])).out).toBe(OKF_TEXT.en.drawFailed);
  });

  it("a first try that runs out of time is not waited for: the second try's drawing is the answer", async () => {
    const { out, shapes } = await run(["HANG", `A car. ${CAR}`], { firstMs: 30 });
    expect(out).toBe(`A car. ${CAR}`);
    expect(shapes).toHaveLength(2);
    expect((await run(["HANG", "HANG"], { firstMs: 30, retryMs: 30 })).out).toBe(OKF_TEXT.en.drawFailed);
  });

  it("a failure of the first try is the answer's error, as for any question", async () => {
    await expect(run([new Error("Ollama, which runs OK Filow's answers on this PC, is not running.")])).rejects.toThrow("is not running");
  });

  it("after a Stop nothing more is asked and nothing is shown", async () => {
    const stop = new AbortController();
    stop.abort();
    const { out, shapes } = await run([REFUSAL, `x ${CAR}`], { signal: stop.signal });
    expect(out).toBe("");
    expect(shapes).toHaveLength(1);
  });
});

describe("online answers follow the switch too (stubbed, nothing is sent)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const cloud = async (sees: boolean | undefined, shape?: AskShape) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("FILOW_OFFLINE", "");
    const sent: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    let out = "";
    for await (const p of askBuddy("cloud", { question: "what is this?", images: [image], screens: [{ index: 1, width: 10, height: 10 }], consent: consentKey("ask", buddyCloudRecipient()), sees }, undefined, undefined, shape)) out += p;
    expect(out).toBe("ok");
    const user = sent[0].messages.at(-1)!.content as Array<{ type: string }>;
    return { system: String(sent[0].messages[0].content), pictures: user.filter((c) => c.type === "image_url").length };
  };

  it("on (or not chosen): the screenshot goes and the prompt offers the screen tags", async () => {
    for (const sees of [true, undefined]) {
      const r = await cloud(sees);
      expect(r.pictures).toBe(1);
      expect(r.system).toContain("[POINT:x,y:label:screenN]");
    }
  });

  it("off: no screenshot leaves, and the prompt is the words-only one that can still draw", async () => {
    const r = await cloud(false);
    expect(r.pictures).toBe(0);
    expect(r.system).toContain("you cannot see the screen");
    expect(r.system).toContain("```drawing2d");
  });

  it("a draw call carries its own prompt and no screenshot, whatever the switch says", async () => {
    const r = await cloud(true, { system: drawOnlyPrompt("2d", "English"), pictures: false });
    expect(r.pictures).toBe(0);
    expect(r.system).toContain("The user asked you for a drawing");
  });
});
