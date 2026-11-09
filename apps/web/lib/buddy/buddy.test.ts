import { afterEach, describe, expect, it } from "vitest";
import { buddySystemPrompt, markToDisplay, parseBuddyAnswer, pointToDisplay, trimHistory } from "./prompt";
import { bezierPoint, bubblePlacement } from "./motion";
import { noThinkPrefill, pickLocalModel, resolveBuddyProvider, wantsVisual, BUDDY_DRAW_CANDIDATES } from "./providers";

it("pickLocalModel prefers the configured model, else the best installed vision model", () => {
  expect(pickLocalModel(["clef-flash:latest", "gemma4:e4b", "qwen3-vl:2b"], undefined)).toBe("qwen3-vl:2b");
  expect(pickLocalModel(["gemma4:e4b", "qwen3-vl:8b"], undefined)).toBe("gemma4:e4b");
  expect(pickLocalModel(["qwen3-vl:2b"], undefined)).toBe("qwen3-vl:2b");
  expect(pickLocalModel([], undefined)).toBe("gemma4:e4b");
  expect(pickLocalModel(["gemma4:e4b"], "my-vl")).toBe("my-vl");
});
import { joinTranscript } from "./bridge";
import { createVad, describeMarked } from "./listen";

const screens = [
  { index: 1, width: 1280, height: 720, cursor: true },
  { index: 2, width: 1280, height: 1024 },
];

describe("parseBuddyAnswer", () => {
  it("strips POINT tags from the spoken text and returns the points", () => {
    const out = parseBuddyAnswer("Click Start [POINT:20,985:Start button:screen1], then Settings [POINT:500,400:Settings:screen2].", screens);
    expect(out.text).toBe("Click Start, then Settings.");
    expect(out.points).toEqual([
      { x: 20, y: 985, label: "Start button", screen: 1 },
      { x: 500, y: 400, label: "Settings", screen: 2 },
    ]);
  });

  it("uses the default screen when the tag has none, and drops points outside the image or on unknown screens", () => {
    const out = parseBuddyAnswer("Here [POINT:10,10:Menu] and [POINT:1001,10:Far:screen1] and [POINT:1,1:Ghost:screen7].", screens, 2);
    expect(out.points).toEqual([{ x: 10, y: 10, label: "Menu", screen: 2 }]);
    expect(out.text).toBe("Here and and.");
  });

  it("holds back an unfinished tag while streaming, but keeps a lone bracket in normal text", () => {
    expect(parseBuddyAnswer("Open the menu [POINT:12,3", screens).text).toBe("Open the menu");
    expect(parseBuddyAnswer("Open the menu [PO", screens).text).toBe("Open the menu");
    expect(parseBuddyAnswer("Type [a] here", screens).text).toBe("Type [a] here");
  });

  it("accepts decimals and spaces inside the tag", () => {
    expect(parseBuddyAnswer("x [POINT: 10.5 , 20 : File : screen 1 ]", screens).points).toEqual([{ x: 10.5, y: 20, label: "File", screen: 1 }]);
  });
});

describe("drawing tags", () => {
  it("parses circles, arrows, boxes and underlines, in order, and strips them from the text", () => {
    const out = parseBuddyAnswer(
      "This one [CIRCLE:500,400,60:Save] then drag [ARROW:100,100,300,200:here:screen2] into [BOX:10,20,300,400:panel] and read [UNDERLINE:100,900,400:title].",
      screens,
    );
    expect(out.text).toBe("This one then drag into and read.");
    expect(out.marks).toEqual([
      { kind: "circle", x: 500, y: 400, r: 60, label: "Save", screen: 1 },
      { kind: "arrow", x1: 100, y1: 100, x2: 300, y2: 200, label: "here", screen: 2 },
      { kind: "box", x1: 10, y1: 20, x2: 300, y2: 400, label: "panel", screen: 1 },
      { kind: "underline", x1: 100, y: 900, x2: 400, label: "title", screen: 1 },
    ]);
  });

  it("drops marks with the wrong number of values, off the grid, or on unknown screens, and keeps at most four", () => {
    expect(parseBuddyAnswer("[CIRCLE:5,5] [ARROW:1,2,3,1200] [BOX:1,1,2,2:x:screen9]", screens).marks).toEqual([]);
    const many = Array.from({ length: 6 }, (_, i) => `[CIRCLE:${100 + i},100,20]`).join(" ");
    expect(parseBuddyAnswer(many, screens).marks).toHaveLength(4);
  });

  it("holds back any unfinished tag while streaming", () => {
    expect(parseBuddyAnswer("Look [CIR", screens).text).toBe("Look");
    expect(parseBuddyAnswer("Look [BOX:10,20,3", screens).text).toBe("Look");
    expect(parseBuddyAnswer("Look [UNDERL", screens).text).toBe("Look");
    expect(parseBuddyAnswer("Look [Bob]", screens).text).toBe("Look [Bob]");
  });

  it("maps marks to display coordinates", () => {
    const d = { x: 1920, y: 0, width: 2000, height: 1000 };
    expect(markToDisplay({ kind: "circle", x: 500, y: 500, r: 100, label: "", screen: 2 }, d)).toMatchObject({ x: 2920, y: 500, r: 100 });
    expect(markToDisplay({ kind: "arrow", x1: 0, y1: 0, x2: 1000, y2: 1000, label: "", screen: 2 }, d)).toMatchObject({ x1: 1920, y1: 0, x2: 3919, y2: 999 });
  });
});

describe("pointToDisplay", () => {
  it("maps the 0-1000 grid to the display's global coordinates (second monitor, negative origin)", () => {
    expect(pointToDisplay({ x: 500, y: 500, label: "", screen: 2 }, { x: 1920, y: 0, width: 2560, height: 1440 })).toEqual({ x: 3200, y: 720 });
    expect(pointToDisplay({ x: 0, y: 1000, label: "", screen: 1 }, { x: -1536, y: 0, width: 1536, height: 864 })).toEqual({ x: -1536, y: 863 });
  });
});

describe("buddySystemPrompt", () => {
  it("lists every screen without pixel sizes (they make models answer in pixels), marks the cursor screen and names the language", () => {
    const p = buddySystemPrompt(screens, "it");
    expect(p).toContain("screen1 (the mouse is on this one)");
    expect(p).toContain("- screen2\n");
    expect(p).not.toContain("1280x");
    expect(p).toContain("Answer in Italian.");
    expect(p).toContain("[POINT:x,y:label:screenN]");
    expect(p).toContain("0 to 1000 grid");
  });
});

describe("trimHistory", () => {
  it("keeps the newest turns, starts on a user turn and drops junk", () => {
    const h = [
      { role: "user" as const, text: "a" },
      { role: "assistant" as const, text: "b" },
      { role: "user" as const, text: "c" },
      { role: "assistant" as const, text: "d" },
      { role: "system" as unknown as "user", text: "x" },
    ];
    expect(trimHistory(h, 3)).toEqual([{ role: "user", text: "c" }, { role: "assistant", text: "d" }]);
    expect(trimHistory(h, 10, 2)).toEqual([{ role: "user", text: "c" }, { role: "assistant", text: "d" }]);
    expect(trimHistory(h, 10, 1)).toEqual([]);
  });
});

describe("resolveBuddyProvider", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });
  it("is local by default, honours the choice, and offline always wins", () => {
    delete process.env.FILOW_OFFLINE;
    delete process.env.BUDDY_PROVIDER;
    expect(resolveBuddyProvider()).toBe("local");
    expect(resolveBuddyProvider("cloud")).toBe("cloud");
    process.env.BUDDY_PROVIDER = "cloud";
    expect(resolveBuddyProvider("nonsense")).toBe("cloud");
    process.env.FILOW_OFFLINE = "1";
    expect(resolveBuddyProvider("cloud")).toBe("local");
  });
});

describe("motion", () => {
  it("starts and ends the flight exactly on the endpoints and arcs above them", () => {
    const from = { x: 100, y: 500 };
    const to = { x: 900, y: 400 };
    expect(bezierPoint(from, to, 0)).toEqual(from);
    const end = bezierPoint(from, to, 1);
    expect(end.x).toBeCloseTo(900);
    expect(end.y).toBeCloseTo(400);
    expect(bezierPoint(from, to, 0.5).y).toBeLessThan(400);
  });
  it("keeps the bubble on screen", () => {
    expect(bubblePlacement({ x: 100, y: 100 }, { width: 200, height: 80 }, { width: 1920, height: 1080 })).toEqual({ x: 130, y: 118 });
    const corner = bubblePlacement({ x: 1900, y: 1070 }, { width: 200, height: 80 }, { width: 1920, height: 1080 });
    expect(corner.x + 200).toBeLessThanOrEqual(1920);
    expect(corner.y + 80).toBeLessThanOrEqual(1080);
  });
});

it("joinTranscript joins committed segments and the live partial", () => {
  expect(joinTranscript(["where is", " the  start "], "button")).toBe("where is the start button");
  expect(joinTranscript([], "  ")).toBe("");
});

describe("listening helpers", () => {
  it("describes what the user marked as grid boxes, and nothing when there is nothing", () => {
    expect(describeMarked([])).toBe("");
    const d = describeMarked([{ screen: 1, points: [[100, 200], [300, 150], [250, 400]] }, { screen: 2, points: [[5, 5]] }]);
    expect(d).toContain("screen1 from 100,150 to 300,400");
    expect(d).not.toContain("screen2");
  });

  it("hands-free VAD ends the question after a pause, not before speech, and ignores a click", () => {
    const v = createVad({ threshold: 0.1, silenceMs: 1000, minSpeechMs: 300 });
    let t = 0;
    const feed = (level: number, ms: number) => { let done = false; for (const end = t + ms; t < end; t += 50) done = v.push(level, t) || done; return done; };
    expect(feed(0.01, 3000)).toBe(false); // silence before speaking never ends it
    expect(feed(0.5, 100)).toBe(false); // a click: too short to count as speech...
    expect(feed(0.01, 1500)).toBe(false); // ...so the pause after it does not end it
    expect(feed(0.5, 800)).toBe(false);
    expect(feed(0.01, 600)).toBe(false);
    expect(feed(0.01, 600)).toBe(true);
  });
});

it("hands-free VAD ignores a steady noisy room and still hears the user over it", () => {
  const v = createVad({ threshold: 0.06, silenceMs: 1000, minSpeechMs: 300 });
  let t = 0;
  const feed = (level: number, ms: number) => { let done = false; for (const end = t + ms; t < end; t += 50) done = v.push(level, t) || done; return done; };
  expect(feed(0.1, 4000)).toBe(false); // a fan at 0.1: not speech
  expect(v.heardSpeech).toBe(false);
  expect(feed(0.6, 800)).toBe(false); // the user talks over it
  expect(feed(0.1, 1200)).toBe(true); // back to the fan: question over
});

it("ignores the general text model setting when choosing the vision model", () => {
  const old = process.env.GENERATE_LOCAL_MODEL;
  process.env.GENERATE_LOCAL_MODEL = "gemma4:e2b";
  try {
    expect(pickLocalModel(["qwen3-vl:8b", "gemma4:e4b"])).toBe("gemma4:e4b");
  } finally {
    if (old === undefined) delete process.env.GENERATE_LOCAL_MODEL; else process.env.GENERATE_LOCAL_MODEL = old;
  }
});

it("a point on the last row or column (grid 1000, like the taskbar's Start button) stays on its display", () => {
  const d = { x: 0, y: 0, width: 1920, height: 1080 };
  const p = pointToDisplay({ x: 1000, y: 1000, label: "", screen: 1 }, d);
  expect(p.x).toBeLessThan(d.x + d.width);
  expect(p.y).toBeLessThan(d.y + d.height);
});

describe("local reply speed", () => {
  it("closes Qwen3-VL's think block up front so the answer starts at once, and leaves other models alone", () => {
    expect(noThinkPrefill("qwen3-vl:8b")).toEqual([{ role: "assistant", content: "<think>\n\n</think>\n\n" }]);
    expect(noThinkPrefill("gemma4:e4b")).toEqual([]);
  });

  it("sends drawing and 3D requests to the biggest installed vision model, everything else to the fast one", () => {
    expect(wantsVisual("explain photosynthesis with a drawing")).toBe(true);
    expect(wantsVisual("disegnami un motore in 3D")).toBe(true);
    expect(wantsVisual("what does this button do?")).toBe(false);
    expect(pickLocalModel(["qwen3-vl:2b", "qwen3-vl:8b"], undefined, BUDDY_DRAW_CANDIDATES)).toBe("qwen3-vl:8b");
    expect(pickLocalModel(["qwen3-vl:2b", "qwen3-vl:8b"], undefined)).toBe("qwen3-vl:2b");
  });
});
