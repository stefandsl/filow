import { describe, expect, it } from "vitest";
import { initialPlayer, playerReducer, readingMs, type PlayerAction, type PlayerState } from "./player";
import { initialLesson, lessonReducer, readLessonStream, whiteboardTopic, type LessonAction, type LessonState } from "./client";
import type { LessonEvent } from "./generate";
import { wbText, WB_TEXT } from "./text";

const run = (actions: PlayerAction[], from: PlayerState = initialPlayer) => actions.reduce(playerReducer, from);
const step = (say: string) => ({ say, items: [], card: true });

describe("whiteboard step player", () => {
  it("shows the first step the moment it arrives and waits for the next one", () => {
    let s = run([{ type: "reset", expected: 0 }, { type: "expect", expected: 3 }]);
    expect(s).toMatchObject({ index: -1, phase: "waiting", playing: true });
    s = run([{ type: "arrived", total: 1 }], s);
    expect(s).toMatchObject({ index: 0, phase: "showing" });
    const spoken = run([{ type: "spoken", turn: s.turn }], s);
    expect(spoken).toMatchObject({ index: 0, phase: "waiting", playing: true });
    expect(run([{ type: "arrived", total: 2 }], spoken)).toMatchObject({ index: 1, phase: "showing" });
  });

  it("moves on when a step has been spoken and stops at the end", () => {
    let s = run([{ type: "reset", expected: 2 }, { type: "arrived", total: 2 }]);
    s = run([{ type: "spoken", turn: s.turn }], s);
    expect(s).toMatchObject({ index: 1, phase: "showing" });
    s = run([{ type: "spoken", turn: s.turn }], s);
    expect(s).toMatchObject({ index: 1, phase: "done", playing: false });
  });

  it("ignores the end of a sentence that is no longer the one on the board", () => {
    const s = run([{ type: "reset", expected: 3 }, { type: "arrived", total: 3 }]);
    const moved = run([{ type: "next" }], s);
    expect(moved.index).toBe(1);
    expect(run([{ type: "spoken", turn: s.turn }], moved)).toEqual(moved);
  });

  it("pauses, goes back, replays and plays again", () => {
    let s = run([{ type: "reset", expected: 3 }, { type: "arrived", total: 3 }, { type: "next" }, { type: "pause" }]);
    expect(s).toMatchObject({ index: 1, playing: false });
    expect(run([{ type: "spoken", turn: s.turn }], s)).toEqual(s);
    const turn = s.turn;
    s = run([{ type: "back" }], s);
    expect(s).toMatchObject({ index: 0, playing: false });
    expect(run([{ type: "back" }], s)).toEqual(s);
    s = run([{ type: "replay" }], s);
    expect(s.index).toBe(0);
    expect(s.turn).toBeGreaterThan(turn + 1);
    s = run([{ type: "play" }], s);
    expect(s).toMatchObject({ index: 0, playing: true, phase: "showing" });
    expect(run([{ type: "next" }, { type: "next" }, { type: "next" }], s).index).toBe(2);
  });

  it("plays from the start again after the end, and a follow-up reopens a finished lesson", () => {
    let s = run([{ type: "reset", expected: 1 }, { type: "arrived", total: 1 }]);
    s = run([{ type: "spoken", turn: s.turn }], s);
    expect(s.phase).toBe("done");
    expect(run([{ type: "play" }], s)).toMatchObject({ index: 0, phase: "showing", playing: true });
    const more = run([{ type: "expect", expected: 3 }], s);
    expect(more).toMatchObject({ phase: "waiting", playing: true });
    expect(run([{ type: "arrived", total: 2 }], more)).toMatchObject({ index: 1, phase: "showing" });
    expect(run([{ type: "goto", index: 1 }], run([{ type: "arrived", total: 2 }], s))).toMatchObject({ index: 1, playing: true });
  });

  it("shows the step that arrived while the lesson was paused, as soon as Play is pressed", () => {
    let s = run([{ type: "reset", expected: 2 }, { type: "arrived", total: 1 }]);
    s = run([{ type: "spoken", turn: s.turn }], s);
    expect(s.phase).toBe("waiting");
    s = run([{ type: "pause" }, { type: "arrived", total: 2 }], s);
    expect(s).toMatchObject({ index: 0, phase: "waiting", playing: false });
    expect(run([{ type: "play" }], s)).toMatchObject({ index: 1, phase: "showing", playing: true });
  });

  it("ends a lesson whose last steps never come", () => {
    let s = run([{ type: "reset", expected: 5 }, { type: "arrived", total: 2 }]);
    s = run([{ type: "spoken", turn: s.turn }], s);
    s = run([{ type: "spoken", turn: s.turn }], s);
    expect(s.phase).toBe("waiting");
    expect(run([{ type: "expect", expected: 2 }], s)).toMatchObject({ phase: "done", playing: false });
  });

  it("gives a sentence time to be read when no voice reads it", () => {
    expect(readingMs("Short.")).toBe(2600);
    expect(readingMs("x".repeat(100))).toBe(7600);
    expect(readingMs("x".repeat(1000))).toBe(12000);
  });
});

describe("whiteboard lesson assembly on the page", () => {
  const ev = (event: LessonEvent): LessonAction => ({ type: "event", event });
  const feed = (actions: LessonAction[], from: LessonState = initialLesson) => actions.reduce(lessonReducer, from);
  const start: LessonEvent = { type: "start", provider: "local", model: "m", lang: "en", lite: false, more: false };
  const outline: LessonEvent = { type: "outline", title: "T", scene: "flow", says: ["a", "b"] };

  it("builds the lesson step by step", () => {
    let s = feed([{ type: "ask", more: false }]);
    expect(s.phase).toBe("planning");
    s = feed([ev(start), ev(outline), ev({ type: "step", index: 0, step: step("a") })], s);
    expect(s).toMatchObject({ phase: "drawing", expected: 2, meta: { model: "m" } });
    expect(s.lesson?.steps).toHaveLength(1);
    s = feed([ev({ type: "step", index: 1, step: step("b") }), ev({ type: "done", cards: 2, stalled: false })], s);
    expect(s).toMatchObject({ phase: "done", cards: 2, expected: 2 });
  });

  it("ignores a step out of order and anything that arrives when nothing was asked", () => {
    const s = feed([{ type: "ask", more: false }, ev(start), ev(outline), ev({ type: "step", index: 1, step: step("b") })]);
    expect(s.lesson?.steps).toHaveLength(0);
    expect(feed([ev(outline)])).toEqual(initialLesson);
  });

  it("a follow-up adds to the same lesson and keeps its title", () => {
    const done = feed([{ type: "ask", more: false }, ev(start), ev(outline), ev({ type: "step", index: 0, step: step("a") }), ev({ type: "step", index: 1, step: step("b") }), ev({ type: "done", cards: 0, stalled: false })]);
    let s = feed([{ type: "ask", more: true }], done);
    expect(s).toMatchObject({ base: 2, phase: "planning" });
    s = feed([ev({ ...start, more: true }), ev({ type: "outline", title: "ignored", scene: "cycle", says: ["c"] }), ev({ type: "step", index: 0, step: step("c") }), ev({ type: "done", cards: 1, stalled: true })], s);
    expect(s.lesson).toMatchObject({ title: "T", scene: "flow" });
    expect(s.lesson?.steps.map((x) => x.say)).toEqual(["a", "b", "c"]);
    expect(s).toMatchObject({ phase: "done", stalled: true, cards: 1, expected: 3 });
  });

  it("keeps what arrived when the answer fails, and says why", () => {
    const s = feed([{ type: "ask", more: false }, ev(start), ev(outline), ev({ type: "step", index: 0, step: step("a") }), ev({ type: "error", code: "stalled", message: "slow" })]);
    expect(s).toMatchObject({ phase: "error", error: { code: "stalled" }, expected: 1 });
    expect(s.lesson?.steps).toHaveLength(1);
    expect(feed([{ type: "ask", more: false }, { type: "fail", code: "no_local_helper", message: "x" }])).toMatchObject({ phase: "error", lesson: null });
    expect(feed([{ type: "ask", more: false }, { type: "cancel" }])).toMatchObject({ phase: "idle" });
  });

  it("reads JSON lines across chunk borders and skips a line that is not JSON", async () => {
    const lines = `${JSON.stringify(start)}\nnot json\n${JSON.stringify(outline)}\n${JSON.stringify({ type: "done", cards: 0, stalled: false })}`;
    const bytes = new TextEncoder().encode(lines);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    const got: string[] = [];
    await readLessonStream(body, (e) => got.push(e.type));
    expect(got).toEqual(["start", "outline", "done"]);
  });
});

describe("whiteboard entry from OK Filow and its strings", () => {
  it("finds the topic in a question that asks for the whiteboard", () => {
    expect(whiteboardTopic("whiteboard: how does photosynthesis work?")).toBe("how does photosynthesis work?");
    expect(whiteboardTopic("Explain compound interest on the whiteboard")).toBe("Explain compound interest");
    expect(whiteboardTopic("Lavagna: la fotosintesi")).toBe("la fotosintesi");
    expect(whiteboardTopic("spiegami il teorema di Pitagora alla lavagna")).toBe("spiegami il teorema di Pitagora");
    expect(whiteboardTopic("Where is the whiteboard button?")).toBeNull();
    expect(whiteboardTopic("what did he write on the whiteboard?")).toBeNull();
    expect(whiteboardTopic("cosa ha scritto alla lavagna?")).toBeNull();
    const started = Date.now();
    expect(whiteboardTopic("explain " + " ".repeat(30000) + "x on the whiteboard")).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
    expect(whiteboardTopic("What is on my screen?")).toBeNull();
    expect(whiteboardTopic("whiteboard:")).toBeNull();
  });

  it("has every string in the five interface languages, with the same placeholders, and falls back to English", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const keys = Object.keys(WB_TEXT.en) as Array<keyof typeof WB_TEXT.en>;
    for (const lang of ["it", "ru", "ro", "ja"] as const) {
      expect(Object.keys(WB_TEXT[lang]).sort(), lang).toEqual([...keys].sort());
      for (const key of keys) {
        expect(WB_TEXT[lang][key], `${lang} ${key}`).toBeTruthy();
        expect(holes(WB_TEXT[lang][key]), `${lang} ${key}`).toBe(holes(WB_TEXT.en[key]));
        expect(WB_TEXT[lang][key], `${lang} ${key}`).not.toContain(String.fromCharCode(0x2014));
      }
    }
    // a translation is not the English left in place (names and "Cloud" aside)
    for (const lang of ["ru", "ja"] as const) expect(keys.filter((k) => WB_TEXT[lang][k] === WB_TEXT.en[k])).toEqual([]);
    expect(wbText("it", "stepOf", { n: 2, total: 5 })).toBe("Passo 2 di 5");
    expect(wbText("ja", "from_local")).not.toBe(WB_TEXT.en.from_local);
    expect(wbText("de", "stepOf", { n: 2, total: 5 })).toBe("Step 2 of 5");
  });

  it("opens the whiteboard from the short form in each interface language", () => {
    const d = String.fromCharCode(0x434, 0x43e, 0x441, 0x43a, 0x430);
    expect(whiteboardTopic(`${d}: abc`)).toBe("abc");
    expect(whiteboardTopic("tabla: fotosinteza")).toBe("fotosinteza");
    expect(whiteboardTopic(String.fromCharCode(0x30db, 0x30ef, 0x30a4, 0x30c8, 0x30dc, 0x30fc, 0x30c9, 0xff1a) + "abc")).toBe("abc");
  });
});
