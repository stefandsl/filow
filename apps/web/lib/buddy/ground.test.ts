import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sysinfo from "@/lib/sysinfo";
import { POST as ask } from "@/app/api/buddy/ask/route";
import { askedElement, askedNames, canPick, isVagueLabel, matchElements, namedInQuestion, nameScore, pickedIndex, pickNames, pickQuestion, placeBox, placePoint, placeTags, plainName, sanitizeElements, screenHint, withNamedPoint, withPlacedTags, type ScreenElement } from "./ground";
import { lenientPoint, withPointer } from "./pointer";
import { parseBuddyAnswer } from "./prompt";

// The owner's screen, 12 Nov: 1360x768, a taskbar of small icons. A circle labelled "Start" sat on the
// Search and Firefox icons about 40 pixels right of the Start button, and a box labelled "This area"
// covered an arbitrary part of the desktop. Windows knows where Start is; the model only guesses.
// On the 0-1000 grid of that screen a 33-pixel taskbar icon is 24 wide and the taskbar starts at y 938.
const el = (name: string, x1: number, y1: number, x2: number, y2: number, screen = 1): ScreenElement => ({ name, screen, x1, y1, x2, y2 });
const TASKBAR = [
  el("Start", 0, 938, 32, 1000),
  el("Cerca", 34, 938, 66, 1000),
  el("Firefox - 1 finestra in esecuzione", 68, 938, 92, 1000),
  el("Esplora file - 2 finestre in esecuzione", 94, 938, 118, 1000),
];
const DESKTOP = [...TASKBAR, el("Chiudi", 960, 0, 990, 30), el("Chiudi", 560, 200, 590, 230), el("Layers", 620, 140, 980, 560), el("Cestino", 0, 10, 56, 100)];
const stream = async function* (pieces: string[]) { for (const p of pieces) yield p; };
const all = async (g: AsyncIterable<string>) => { const out: string[] = []; for await (const p of g) out.push(p); return out; };

describe("a label is matched to the name Windows gives the thing", () => {
  it("scores the same words 1, a name inside the label or a label inside the name lower, and unrelated names 0", () => {
    expect(nameScore("Start", "Start")).toBe(1);
    expect(nameScore("the Start button", "Start")).toBe(1);
    expect(nameScore("Firefox", "Firefox - 1 finestra in esecuzione")).toBe(1);
    expect(nameScore("Firefox icon", "Mozilla Firefox")).toBeGreaterThanOrEqual(0.6);
    expect(nameScore("blue Save", "Save")).toBeGreaterThanOrEqual(0.6);
    expect(nameScore("Start", "Cerca")).toBe(0);
    expect(nameScore("Search", "Firefox - 1 finestra in esecuzione")).toBe(0);
    // a name without spaces between words
    expect(nameScore("ごみ箱のアイコン", "ごみ箱")).toBeGreaterThanOrEqual(0.6);
    expect(nameScore("button", "Start")).toBe(0);
  });

  it("returns only the best matches of the asked screen", () => {
    expect(matchElements("Start button", DESKTOP, 1).map((e) => e.name)).toEqual(["Start"]);
    expect(matchElements("Chiudi", DESKTOP, 1)).toHaveLength(2);
    expect(matchElements("Start", DESKTOP, 2)).toEqual([]);
    expect(matchElements("Start", [...DESKTOP, el("Start", 0, 900, 30, 1000, 2)], 2)).toHaveLength(1);
  });
});

describe("a point goes where the thing is", () => {
  it("the owner's case: a Start guess 40 pixels to the right, on Search and Firefox, lands on the Start button", () => {
    const p = placePoint("Start", { x: 62, y: 968 }, DESKTOP, 1);
    expect(p).toMatchObject({ x: 16, y: 969, how: "name" });
    // and needs no guess at all when one thing carries the name
    expect(placePoint("Start button", null, DESKTOP, 1)).toMatchObject({ x: 16, y: 969, how: "name" });
  });

  it("two things by one name: the one nearest the guess, and nothing certain without a guess", () => {
    expect(placePoint("Chiudi", { x: 600, y: 250 }, DESKTOP, 1)).toMatchObject({ x: 575, y: 215, how: "name-near" });
    expect(placePoint("Chiudi", { x: 900, y: 40 }, DESKTOP, 1)).toMatchObject({ x: 975, y: 15, how: "name-near" });
    expect(placePoint("Chiudi", null, DESKTOP, 1)).toBeNull();
  });

  it("no name fits: the guess moves onto the small element it is in or right beside, never onto a region, and stays put far from everything", () => {
    // inside the Firefox icon: its centre
    expect(placePoint("the browser", { x: 70, y: 990 }, DESKTOP, 1)).toMatchObject({ x: 80, y: 969, how: "snap" });
    // 20 grid units above the Recycle Bin... beside it: its centre
    expect(placePoint("trash", { x: 70, y: 60 }, DESKTOP, 1)).toMatchObject({ x: 28, y: 55, how: "snap" });
    // inside the big Layers panel only: left where the model put it
    expect(placePoint("that thing", { x: 800, y: 400 }, DESKTOP, 1)).toEqual({ x: 800, y: 400, how: "guess" });
    expect(placePoint("that thing", { x: 400, y: 600 }, DESKTOP, 1)).toEqual({ x: 400, y: 600, how: "guess" });
    // no list at all (an app that exposes nothing, or not Windows): the guess as it is
    expect(placePoint("Start", { x: 62, y: 968 }, [], 1)).toEqual({ x: 62, y: 968, how: "guess" });
  });
});

describe("a name that only partly fits does not pull a point across the screen", () => {
  const BAR = [el("Search", 34, 938, 66, 1000), el("File Explorer", 94, 938, 118, 1000), el("Settings", 120, 938, 144, 1000), el("Блокнот", 146, 938, 170, 1000), el("Поиск", 172, 938, 196, 1000), el("Firefox - 1 running window", 68, 938, 92, 1000)];

  it("the browser's own Search bar, File menu and Firefox settings stay where the model put them", () => {
    // "bar", "menu", "settings" say it is another thing than the taskbar icon of that name, and the guess is far from it
    expect(placePoint("Search bar", { x: 500, y: 80 }, BAR, 1)).toEqual({ x: 500, y: 80, how: "guess" });
    expect(placePoint("File menu", { x: 20, y: 30 }, BAR, 1)).toEqual({ x: 20, y: 30, how: "guess" });
    expect(placePoint("Firefox settings", { x: 950, y: 60 }, BAR, 1)).toEqual({ x: 950, y: 60, how: "guess" });
    // the same partial name with the guess in that corner of the screen is the taskbar icon
    expect(placePoint("Search bar", { x: 90, y: 900 }, BAR, 1)).toMatchObject({ x: 50, y: 969, how: "name" });
    // and the exact name wins from anywhere: that is the owner's Start case
    expect(placePoint("the Search icon", { x: 500, y: 80 }, BAR, 1)).toMatchObject({ x: 50, y: 969, how: "name" });
    // without a guess only the exact name is certain
    expect(placePoint("Search bar", null, BAR, 1)).toBeNull();
    expect(placePoint("Search", null, BAR, 1)).toMatchObject({ how: "name" });
  });

  it("short Cyrillic words are not found inside longer ones; Japanese names are", () => {
    expect(nameScore("ОК", "Блокнот")).toBe(0);
    expect(nameScore("по", "Поиск")).toBe(0);
    expect(placePoint("ОК", { x: 600, y: 500 }, BAR, 1)).toEqual({ x: 600, y: 500, how: "guess" });
    expect(nameScore("Блокнот", "Блокнот")).toBe(1);
    expect(nameScore("значок Блокнот", "Блокнот")).toBe(1);
    expect(nameScore("設定", "設定メニュー")).toBeGreaterThanOrEqual(0.6);
    // a label that is only a kind word still matches a thing called that
    expect(nameScore("メニュー", "メニュー")).toBe(1);
    expect(nameScore("アイコン", "アイコン")).toBe(1);
  });

  it("a box around the whole Firefox window is not shrunk to its taskbar icon, and a box with no label is kept", () => {
    expect(placeBox("Firefox", { x1: 0, y1: 0, x2: 1000, y2: 930 }, BAR, 1)).toMatchObject({ x1: 0, y1: 0, x2: 1000, y2: 930, how: "guess" });
    expect(placeBox("Firefox", { x1: 60, y1: 930, x2: 100, y2: 1000 }, BAR, 1)).toMatchObject({ x1: 68, y1: 938, x2: 92, y2: 1000, how: "name" });
    expect(placeBox("", { x1: 100, y1: 100, x2: 500, y2: 500 }, BAR, 1)).toMatchObject({ how: "guess" });
    expect(placeTags("see [BOX:100,100,500,500] here", BAR)).toBe("see [BOX:100,100,500,500] here");
  });

  it("numbers in a sentence are not a place", () => {
    for (const s of ["Screen 1, 420, 880", "I see 2, 3 buttons at 300,400", "about 1,000 px", "[-5,20]", "It is at 300,400."]) expect(lenientPoint(s)).toBeNull();
    expect(lenientPoint("412, 300")).toEqual({ x: 412, y: 300 });
    expect(lenientPoint("(412,300)")).toEqual({ x: 412, y: 300 });
    expect(lenientPoint("[[POINT:921,387:dom:screen1]]")).toEqual({ x: 921, y: 387 });
  });
});

describe("a box goes around the thing, or is not drawn", () => {
  it("takes the named element's rectangle, else the element the box all but covers", () => {
    expect(placeBox("Layers panel", { x1: 500, y1: 300, x2: 700, y2: 500 }, DESKTOP, 1)).toMatchObject({ x1: 620, y1: 140, x2: 980, y2: 560, how: "name" });
    expect(placeBox("the side list", { x1: 600, y1: 150, x2: 990, y2: 540 }, DESKTOP, 1)).toMatchObject({ x1: 620, y1: 140, x2: 980, y2: 560, how: "overlap" });
  });

  it("the owner's case: a box called This area that covers no element is not drawn; a named one the list does not know stays", () => {
    expect(placeBox("This area", { x1: 200, y1: 300, x2: 500, y2: 700 }, DESKTOP, 1)).toBeNull();
    expect(placeBox("quest'area", { x1: 200, y1: 300, x2: 500, y2: 700 }, DESKTOP, 1)).toBeNull();
    expect(placeBox("The chart", { x1: 200, y1: 300, x2: 500, y2: 700 }, DESKTOP, 1)).toMatchObject({ x1: 200, y2: 700, how: "guess" });
    // without a list nothing is known: the box is drawn as before
    expect(placeBox("This area", { x1: 200, y1: 300, x2: 500, y2: 700 }, [], 1)).toMatchObject({ how: "guess" });
    expect(isVagueLabel("here")).toBe(true);
    expect(isVagueLabel("Layers panel")).toBe(false);
  });
});

describe("tags in an answer", () => {
  it("rewrites POINT, CIRCLE and BOX in place, keeps label and screen, and the page parses the result", () => {
    const text = placeTags("Open Start [CIRCLE:62,968,40:Start] then this [BOX:200,300,500,700:This area] and Firefox [POINT:300,500:Firefox:screen1].", DESKTOP);
    expect(text).toBe("Open Start [CIRCLE:16,969,37:Start] then this  and Firefox [POINT:80,969:Firefox:screen1].");
    const parsed = parseBuddyAnswer(text, [{ index: 1, width: 1024, height: 578 }]);
    expect(parsed.points.map((p) => [p.x, p.y, p.label])).toEqual([[80, 969, "Firefox"]]);
    expect(parsed.marks).toHaveLength(1);
    expect(parsed.marks[0]).toMatchObject({ kind: "circle", x: 16, y: 969, label: "Start" });
  });

  it("leaves everything alone without a list, and POINT tags alone when a pointing model places them", () => {
    const raw = "Open Start [CIRCLE:62,968,40:Start] [POINT:62,968:Start]";
    expect(placeTags(raw, [])).toBe(raw);
    expect(placeTags(raw, DESKTOP, { points: false })).toBe("Open Start [CIRCLE:16,969,37:Start] [POINT:62,968:Start]");
  });

  it("streams: a tag split over pieces waits for its end, text before it goes out at once", async () => {
    const out = await all(withPlacedTags(stream(["Open Start [CIR", "CLE:62,968,", "40:Start] now [not a tag] ok"]), DESKTOP));
    expect(out[0]).toBe("Open Start ");
    expect(out.join("")).toBe("Open Start [CIRCLE:16,969,37:Start] now [not a tag] ok");
    expect(out.join("|")).not.toContain("62,968");
    // an unfinished tag at the very end is passed on as the model wrote it
    expect((await all(withPlacedTags(stream(["See [BOX:1,2"]), DESKTOP))).join("")).toBe("See [BOX:1,2");
  });
});

describe("with a pointing model", () => {
  it("does not ask the model for a thing Windows names, and corrects the model's guess for the rest", async () => {
    const asked: string[] = [];
    const ground = async (label: string) => { asked.push(label); return label === "Chiudi" ? "[POINT:600,250:x]" : "[PONT:70,990:browser icon]"; };
    const out = await all(withPointer(stream(["Press Start [POINT:500,500:Start], close [POINT:1,1:Chiudi] and the browser [POINT:2,2:the browser]."]), ground, () => false, DESKTOP));
    expect(asked).toEqual(["Chiudi", "the browser"]);
    expect(out.join("")).toContain("[POINT:16,969:Start]");
    expect(out.join("")).toContain("[POINT:575,215:Chiudi]");
    // a garbled tag with good numbers still counts, and lands on the icon the guess is in
    expect(out.join("")).toContain("[POINT:80,969:the browser]");
  });

  it("reads the two numbers of a garbled reply, and none from NONE or from numbers off the grid", () => {
    expect(lenientPoint("[IPS:911,62:Condividi(screen1)]")).toEqual({ x: 911, y: 62 });
    expect(lenientPoint("[400, 800:label=Save]")).toEqual({ x: 400, y: 800 });
    expect(lenientPoint("NONE")).toBeNull();
    expect(lenientPoint("None. It is not visible, 12,30 maybe")).toBeNull();
    expect(lenientPoint("NONE [12,30:nothing there]")).toBeNull();
    expect(lenientPoint("[POINT:1360,700:x]")).toBeNull();
    expect(lenientPoint("it is there")).toBeNull();
  });
});

describe("a label in other words than the name: the answering model chooses from the names", () => {
  it("asks only when no name has the label's words, takes the chosen element, and falls back to the pointing model on 0 or nonsense", async () => {
    const picks: Array<[string, string[]]> = [];
    const grounds: string[] = [];
    const run = async (reply: string) => (await all(withPointer(
      stream(["Open [POINT:1,1:File Explorer] and [POINT:2,2:Start]."]),
      async (l) => { grounds.push(l); return "[POINT:500,500:x]"; },
      () => false,
      DESKTOP,
      async (label, names) => { picks.push([label, names]); return reply; },
    ))).join("");
    const names = ["Start", "Cerca", "Firefox - 1 finestra in esecuzione", "Esplora file - 2 finestre in esecuzione", "Chiudi", "Layers", "Cestino"];
    expect(await run(" 4")).toContain("[POINT:106,969:File Explorer]");
    // Start was never put to the model: its name fits; the names are each listed once
    expect(picks).toEqual([["File Explorer", names]]);
    expect(grounds).toEqual([]);
    expect(pickQuestion("File Explorer", names)).toContain('Label: "File Explorer"\nItems:\n1. Start\n2. Cerca\n');
    // "0" (none of them), a number past the list, no number: the pointing model's guess is used
    for (const bad of ["0", "99", "none of these"]) expect(await run(bad)).toContain("[POINT:500,500:File Explorer]");
    expect(grounds).toEqual(["File Explorer", "File Explorer", "File Explorer"]);
    // a name two things carry: the pointing model's guess decides which
    expect(await run("5")).toContain("[POINT:575,215:File Explorer]");
    expect(pickedIndex("3.", 7)).toBe(2);
    expect(pickedIndex("0", 7)).toBeNull();
    expect(pickNames([...DESKTOP, el("Other screen", 0, 0, 9, 9, 2)], 2)).toEqual(["Other screen"]);
  });

  it("a whole question may be about any screen sent: the mouse's screen first, and a name on two screens is no answer", () => {
    const two = [el("Chiudi", 900, 0, 1000, 30, 1), el("Esplora file", 100, 960, 130, 1000, 1), el("Chiudi", 950, 0, 1000, 40, 2), el("holiday-photos", 200, 200, 600, 230, 2)];
    expect(askedNames(two, 1)).toEqual(["Chiudi", "Esplora file", "holiday-photos"]);
    expect(askedNames(two, 2)).toEqual(["Chiudi", "holiday-photos", "Esplora file"]);
    // the thing on the other screen is found there, not on the screen with the mouse
    expect(askedElement(two, "holiday-photos")).toMatchObject({ screen: 2, x1: 200 });
    expect(askedElement(two, "Chiudi")).toBeNull();
    expect(askedElement(two, undefined)).toBeNull();
    expect(askedElement(two, "nothing")).toBeNull();
  });

  it("only a model measured good at it is asked", () => {
    expect(canPick("gemma4:e4b")).toBe(true);
    expect(canPick("lfm3-vl")).toBe(false);
    expect(canPick("qwen3-vl:8b")).toBe(false);
  });
});

describe("the ask route with the names Windows gives", () => {
  const PAIR = ["gemma4:e4b", "lfm3-vl:latest", "clef-flash:latest", "qwen3-vl:8b"];
  const shot = { images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 1024, height: 578, cursor: true }] };
  const request = (body: unknown) => new Request("http://unit.invalid/api/buddy/ask", { method: "POST", body: JSON.stringify(body) });
  let chats: Array<{ model: string; messages: Array<{ role: string; content: string; images?: string[] }> }>;
  let answer: string;
  let installed: string[];
  beforeEach(() => {
    for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "1", OLLAMA_URL: "http://127.0.0.1:11434", BUDDY_LOCAL_MODEL: "" })) vi.stubEnv(k, v);
    chats = [];
    installed = PAIR;
    answer = "Press Start [POINT:62,968:Start button:screen1], then this [BOX:200,300,500,700:This area].";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/tags")) return Response.json({ models: installed.map((name) => ({ name })) });
      if (String(url).endsWith("/api/version")) return Response.json({ version: "0.40.13" });
      if (String(url).endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body)) as (typeof chats)[number];
        chats.push(body);
        const last = body.messages.at(-1)?.content ?? "";
        const reply = last.startsWith("Label:") ? "4" : body.model === "lfm3-vl" ? "[POINT:62,968:Start:screen1]" : answer;
        return new Response(`${JSON.stringify({ message: { content: reply }, done: true })}\n`);
      }
      throw new Error(`unexpected ${url}`);
    }));
    vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "discrete", vramTotalGb: 8, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
    vi.spyOn(sysinfo, "machineInfo").mockImplementation((_gpu, list) => ({ ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb: 8, ollama: true }, freeDiskGb: 500, installed: list ?? [] }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("the owner's case: Start lands on the Start button without a second model call, and the box that names nothing is not drawn", async () => {
    const res = await ask(request({ question: "how do I open the menu?", ...shot, provider: "local", elements: DESKTOP }));
    expect(await res.text()).toBe("Press Start , then this . [POINT:16,969:Start button:screen1]");
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b"]);
    // the list is for placing only: no model saw a name from it
    expect(JSON.stringify(chats)).not.toMatch(/Cestino|Esplora file/);
  });

  it("without the list everything is as before: the pointing model's own position, the model's own box", async () => {
    const res = await ask(request({ question: "how do I open the menu?", ...shot, provider: "local" }));
    expect(await res.text()).toBe("Press Start , then this [BOX:200,300,500,700:This area]. [POINT:62,968:Start button:screen1]");
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b", "lfm3-vl"]);
  });

  it("a label in other words is chosen by Gemma from the names, without a picture and without the conversation", async () => {
    answer = "Open [POINT:300,300:File Explorer:screen1].";
    const res = await ask(request({ question: "where are my files?", ...shot, provider: "local", elements: DESKTOP, history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }));
    expect(await res.text()).toBe("Open . [POINT:106,969:File Explorer:screen1]");
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b", "gemma4:e4b"]);
    expect(chats[1].messages.at(-1)?.images).toEqual([]);
    expect(chats[1].messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect((chats[1] as { options?: { num_predict?: number; temperature?: number } }).options).toMatchObject({ num_predict: 8, temperature: 0 });
  });

  it("one model alone (Qwen3-VL 8B, as in 0.9.35 on this PC): its own tags are corrected in place", async () => {
    installed = ["qwen3-vl:8b", "clef-flash:latest"];
    answer = "Press Start [CIRCLE:62,968,40:Start].";
    const res = await ask(request({ question: "draw a circle on the Start menu", ...shot, provider: "local", elements: DESKTOP }));
    expect(await res.text()).toBe("Press Start [CIRCLE:16,969,37:Start].");
  });

  it("the question names a thing Windows lists: Gemma is told where it is, and its answer without a tag still gets the point", async () => {
    answer = "Cestino is not visible in the screenshot.";
    const res = await ask(request({ question: "Where is the Cestino?", ...shot, provider: "local", elements: DESKTOP }));
    expect(await res.text()).toBe("Cestino is not visible in the screenshot. [POINT:28,55:Cestino]");
    expect(chats).toHaveLength(1);
    expect(chats[0].messages.at(-1)?.content).toContain('Where is the Cestino?\n(Found on the screen: "Cestino" is at 28,55.');
    // only the name the question already held went into the prompt
    expect(JSON.stringify(chats)).not.toMatch(/Esplora file|Chiudi|Firefox/);
  });

  it("the panel's follow-up for a point: Gemma says which named thing the question was about, and the pointing model is not asked", async () => {
    const follow = 'where are my files?\nYou answered: "They are in your folders". Reply with only the tag [POINT:x,y:label:screenN] for that thing, on the 0-1000 grid, and nothing else. If it is not visible, reply NONE.';
    const res = await ask(request({ question: follow, ...shot, provider: "local", elements: DESKTOP }));
    expect(await res.text()).toBe("[POINT:106,969:Esplora file:screen1]");
    expect(chats.map((c) => c.model)).toEqual(["gemma4:e4b"]);
    // the question alone, not the earlier answer, and no picture
    expect(chats[0].messages.at(-1)?.content).toMatch(/^Label: "where are my files\?"\nItems:\n1\. Start\n/);
    expect(chats[0].messages.at(-1)?.images).toEqual([]);
    expect(parseBuddyAnswer(await (await ask(request({ question: follow, ...shot, provider: "local", elements: DESKTOP }))).text(), shot.screens).points[0]).toMatchObject({ x: 106, y: 969, label: "Esplora file" });
  });

  it("the follow-up when Gemma says none of them (0), or without the list: the pointing model looks, and its near miss is still corrected", async () => {
    const follow = "what is 2 plus 2?\nReply with only the tag [POINT:x,y:label:screenN] for that thing.";
    const fetchMock = vi.mocked(globalThis.fetch);
    const inner = fetchMock.getMockImplementation() as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/chat") && String(init?.body).includes("Label:")) return new Response(`${JSON.stringify({ message: { content: "0" }, done: true })}\n`);
      return inner(url, init);
    }) as unknown as typeof fetch);
    const res = await ask(request({ question: follow, ...shot, provider: "local", elements: DESKTOP }));
    // lfm3-vl's [POINT:62,968:Start] is 30 grid units right of Start: put on the Start button
    expect(await res.text()).toBe("[POINT:16,969:Start:screen1]");
    expect(chats.map((c) => c.model)).toEqual(["lfm3-vl"]);
    const bare = await ask(request({ question: follow, ...shot, provider: "local" }));
    expect(await bare.text()).toBe("[POINT:62,968:Start:screen1]");
  });

  it("a list with no screenshot (Look at my screen off) or a malformed one is ignored", async () => {
    answer = "Press Start [CIRCLE:62,968,40:Start].";
    installed = ["qwen3-vl:8b", "clef-flash:latest"];
    const res = await ask(request({ question: "draw a circle on the Start menu", ...shot, provider: "local", elements: "everything" }));
    expect(await res.text()).toBe(answer);
  });
});

describe("the thing the question itself names", () => {
  const PINNED = [...DESKTOP, el("Audacity bloccato", 314, 938, 338, 1000), el("File", 10, 30, 40, 50), el("Blocco note", 400, 300, 440, 360), el("Blocco note", 500, 300, 540, 360)];

  it("finds whole names in the question, longest first, without the state Windows adds; not short single words, not names two things share", () => {
    expect(namedInQuestion("Where is Audacity?", PINNED).map((e) => e.name)).toEqual(["Audacity bloccato"]);
    expect(namedInQuestion("dov'è esplora file e dove firefox", PINNED).map((e) => plainName(e.name))).toEqual(["Esplora file", "Firefox"]);
    // "file" alone is a word of the sentence, "Start" (5 letters) is a name
    expect(namedInQuestion("where is this file", PINNED)).toEqual([]);
    expect(namedInQuestion("where is start", PINNED).map((e) => e.name)).toEqual(["Start"]);
    // a sentence that only holds the word is not about the thing: no hint, no point
    for (const q of ["How do I start a new document in Word?", "what does start do in a for loop", "Come faccio a far partire Firefox più veloce?", "Firefox is slow today", "Как работает Firefox?"]) expect(namedInQuestion(q, PINNED)).toEqual([]);
    for (const q of ["Dov'è Firefox?", "apri Firefox", "Где Firefox?", "Unde este Firefox?", "Firefoxはどこ", "show me Firefox", "which one is Firefox"]) expect(namedInQuestion(q, PINNED).map((e) => plainName(e.name))).toEqual(["Firefox"]);
    expect(namedInQuestion("open blocco note", PINNED)).toEqual([]);
    // part of a word is not the name
    expect(namedInQuestion("restart the computer", PINNED)).toEqual([]);
    expect(namedInQuestion("Where is Audacity?", [])).toEqual([]);
  });

  it("tells the model where they are, with the screen only when there are several", () => {
    const [a] = namedInQuestion("Where is Audacity?", PINNED);
    expect(screenHint([a], 1)).toBe('\n(Found on the screen: "Audacity" is at 326,969. It is visible: if the question is about it, point at it with exactly that position.)');
    expect(screenHint([a], 2)).toContain('"Audacity" is at 326,969 on screen 1');
    expect(screenHint([], 1)).toBe("");
  });

  it("an answer that points at nothing gets the point; one that points or draws, an empty one and an error do not", async () => {
    const [a] = namedInQuestion("Where is Audacity?", PINNED);
    const run = async (pieces: string[], named = [a]) => (await all(withNamedPoint(stream(pieces), named, 1))).join("");
    expect(await run(["Audacity is not ", "visible."])).toBe("Audacity is not visible. [POINT:326,969:Audacity]");
    expect(await run(["It is here [POINT:326,969:Audacity]."])).toBe("It is here [POINT:326,969:Audacity].");
    expect(await run(["Look [BOX:1,2,3,4:x]"])).toBe("Look [BOX:1,2,3,4:x]");
    expect(await run([""])).toBe("");
    expect(await run(["half\n[ERROR] Ollama is not running"])).toBe("half\n[ERROR] Ollama is not running");
    expect(await run(["Nothing named."], [])).toBe("Nothing named.");
  });
});

describe("the list in a request body is not trusted", () => {
  it("keeps well-formed elements, clamps to the grid, drops the rest and stops at the cap", () => {
    const got = sanitizeElements([
      { name: " Start ", screen: 1, x1: -5, y1: 938, x2: 32, y2: 1200, type: "Button" },
      { name: "", screen: 1, x1: 0, y1: 0, x2: 10, y2: 10 },
      { name: "flat", screen: 1, x1: 10, y1: 10, x2: 10, y2: 20 },
      { name: "other screen", screen: 3, x1: 0, y1: 0, x2: 10, y2: 10 },
      { name: "nan", screen: 1, x1: "0", y1: 0, x2: 10, y2: 10 },
      null,
      "x",
    ], 2);
    expect(got).toEqual([{ name: "Start", screen: 1, x1: 0, y1: 938, x2: 32, y2: 1000, type: "Button" }]);
    expect(sanitizeElements("no", 1)).toEqual([]);
    expect(sanitizeElements(Array.from({ length: 900 }, (_, i) => ({ name: `n${i}`, screen: 1, x1: 0, y1: 0, x2: 5, y2: 5 })), 1)).toHaveLength(600);
  });
});
