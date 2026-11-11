import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/cloud-r3.json";
import { finalProblems, generateCloud, orphanBoxes, placeNotes, texOk, validatorLosses, wrongSums, type Ask, type LessonEvent } from "./generate";
import { LIMITS, validateLesson, type Lesson, type LessonItem } from "./lesson";
import { layoutBoard, layoutProblems } from "./layout";
import { checkArithmetic } from "./plot";

// "Do no harm", measured. The fixtures are twenty lessons a real cloud model wrote before round 5
// (two paid runs of the ten proof questions). The guards are replayed over them with a model that
// is played by this file, so every difference between what the model wrote and what is shown was
// made by Filow's own code. The rule for every guard: repair, ask for a rewrite, or refuse the
// WHOLE lesson with a reason; never delete a step, a curve or part of a worked example and show the rest.
type Fixture = { run: string; n: number; question: string; lesson: Lesson };
const FIXTURES = fixtures as unknown as Fixture[];
// lessons written about "[PERSON_NAME]" by a provider that hid the name are refused as a whole: tested at the route
const LESSONS = FIXTURES.filter((f) => !/Krebs/.test(f.question));

type Play = { sentence?: (n: number, lessonNo: number) => boolean; arrow?: (n: number) => "true" | "reversed" | "false"; rewrite?: (first: Lesson) => unknown; unreadable?: boolean };
/** A model played by the test: it writes the fixture, and examines and judges as `play` says. */
function fake(f: Fixture, play: Play = {}) {
  let lessons = 0;
  const asked: string[] = [];
  const ask: Ask = async ({ system, user }) => {
    asked.push(system.slice(0, 40));
    if (system.includes("patient teacher")) {
      lessons++;
      return JSON.stringify(lessons > 1 && play.rewrite ? play.rewrite(f.lesson) : { topic: f.question, ...f.lesson });
    }
    if (play.unreadable) return "I cannot answer that.";
    if (system.includes("strict examiner")) {
      const count = (user.slice(user.indexOf("Sentences:"), user.indexOf("Boxes:")).match(/^\d+\. /gm) ?? []).length;
      return JSON.stringify({ topic: true, answers: true, issues: "", must: "zebra", sentences: Array.from({ length: count }, (_, i) => ({ n: i + 1, true: play.sentence ? play.sentence(i + 1, lessons) : true })) });
    }
    if (system.includes("one line at a time")) return JSON.stringify({ arrows: (user.match(/^\d+\. /gm) ?? []).map((_, i) => ({ n: i + 1, verdict: play.arrow ? play.arrow(i + 1) : "true" })) });
    return "{}";
  };
  return { ask, asked };
}
async function shown(f: Fixture, play: Play = {}, audit = false) {
  const events: LessonEvent[] = [];
  const model = fake(f, play);
  await generateCloud(model.ask, { question: f.question, lang: "en", maxSteps: LIMITS.steps, audit }, (e) => events.push(e));
  const steps = events.flatMap((e) => (e.type === "step" ? [e.step] : []));
  return { events, steps, asked: model.asked, error: events.find((e) => e.type === "error"), done: events.find((e) => e.type === "done"), audit: events.find((e) => e.type === "audit") };
}
/** What a step draws, without regard to order inside the step (notes may be moved to their box's step). */
const drawn = (items: LessonItem[], skip: (it: LessonItem) => boolean = () => false) => items.filter((it) => !skip(it)).map((it) => JSON.stringify(it)).sort();
const everything = (steps: Array<{ items: LessonItem[] }>, skip?: (it: LessonItem) => boolean) => drawn(steps.flatMap((s) => s.items), skip);
const written = (f: Fixture) => validateLesson(f.lesson, { maxSteps: LIMITS.steps, texOk, sketch: true })!;

describe("the guards of the online path, replayed over saved real lessons", () => {
  it("has the saved lessons to replay", () => {
    expect(FIXTURES).toHaveLength(20);
    expect(LESSONS.length).toBeGreaterThanOrEqual(18);
  });

  it.each(LESSONS.map((f) => [`${f.run}/${f.n} ${f.question}`, f] as const))("an examiner that agrees changes nothing: %s", async (_name, f) => {
    const first = written(f);
    const got = await shown(f);
    expect(got.error).toBeUndefined();
    // every sentence, in order; every box, arrow, formula, curve, cell and note
    expect(got.steps.map((s) => s.say)).toEqual(first.steps.map((s) => s.say));
    expect(everything(got.steps)).toEqual(everything(first.steps));
    // a step keeps what it drew; only a note may have moved to the step of the box it is about
    got.steps.forEach((s, k) => expect(drawn(s.items, (it) => it.kind === "note")).toEqual(drawn(first.steps[k].items, (it) => it.kind === "note")));
    expect(got.done).toMatchObject({ type: "done", cards: 0 });
    expect((got.done as { unchecked?: number[] }).unchecked).toBeUndefined();
    // one lesson, one review, one call for the arrows when there are any: no rewrite was asked for,
    // unless the last look in code finds a fault in the lesson as written (cells cut by the old limit)
    if (!finalProblems(first).length) expect(got.asked.filter((s) => s.includes("patient teacher"))).toHaveLength(1);
  });

  it.each(LESSONS.map((f) => [`${f.run}/${f.n}`, f] as const))("an examiner that refuses one sentence twice never makes a hole: %s", async (_name, f) => {
    const first = written(f);
    const got = await shown(f, { sentence: (n) => n !== 1 });
    // the first step is the one the round 5 guards cut ("Next, Current is ..."): here it stays, named as not confirmed
    expect(got.error).toBeUndefined();
    expect(got.steps.map((s) => s.say)).toEqual(first.steps.map((s) => s.say));
    expect(everything(got.steps)).toEqual(everything(first.steps));
    expect(got.done).toMatchObject({ unchecked: [0] });
    expect(finalProblems({ ...first, steps: got.steps }).filter((p) => p.includes("first sentence"))).toEqual([]);
  });

  it.each(LESSONS.map((f) => [`${f.run}/${f.n}`, f] as const))("whatever the examiner and the judge answer, the lesson is shown whole or not at all: %s", async (_name, f) => {
    const first = written(f);
    const plays: Play[] = [
      { unreadable: true },
      { sentence: () => false },
      { sentence: (n) => n % 2 === 0 },
      { arrow: () => "false" },
      { arrow: (n) => (n % 2 ? "reversed" : "true") },
      { sentence: (n) => n !== 2, rewrite: (l) => ({ ...l, steps: l.steps.slice(1) }) },
    ];
    for (const play of plays) {
      const got = await shown(f, play, true);
      if (got.error) {
        expect(got.steps).toEqual([]);
        continue;
      }
      // no step is missing and nothing but an arrow the judge called false is gone, and that is on record
      expect(got.steps.map((s) => s.say)).toEqual(first.steps.map((s) => s.say));
      const notArrow = (it: LessonItem) => it.kind === "edge";
      expect(everything(got.steps, notArrow)).toEqual(everything(first.steps, notArrow));
      const arrows = (steps: Array<{ items: LessonItem[] }>) => steps.flatMap((s) => s.items).filter((it) => it.kind === "edge").length;
      if (arrows(got.steps) < arrows(first.steps)) expect(JSON.stringify((got.audit as { changes: string[] }).changes)).toContain("called false");
    }
  });

  it("keeps the two guards that only cut switched off: taking lone boxes off would have removed boxes of real lessons", () => {
    const alone = LESSONS.map((f) => orphanBoxes(written(f)).length).reduce((a, b) => a + b, 0);
    // ten boxes in four of these lessons, five of them the trace of a binary search
    expect(alone).toBeGreaterThanOrEqual(8);
  });

  it("the code-only checks raise no false alarm on the saved lessons", () => {
    for (const f of LESSONS) {
      const lesson = written(f);
      expect(wrongSums(lesson), `${f.run}/${f.n}`).toEqual([]);
      expect(validatorLosses(f.lesson, lesson), `${f.run}/${f.n}`).toEqual([]);
      expect(placeNotes(lesson).steps.flatMap((s) => s.items).length).toBe(lesson.steps.flatMap((s) => s.items).length);
      // the only thing the last look finds in them is what the old 6-character cell limit did
      expect(finalProblems(lesson).filter((p) => !p.includes("is cut")), `${f.run}/${f.n}`).toEqual([]);
    }
  });
});

describe("the last look in code", () => {
  const lesson = (steps: Array<{ say: string; items?: unknown[] }>) => validateLesson({ title: "T", scene: "flow", steps: steps.map((s) => ({ say: s.say, items: s.items ?? [] })) }, { maxSteps: 7, texOk })!;
  it("wants the first step to introduce the topic, in the five languages", () => {
    for (const say of ["Next, Current is the flow of charge.", "Then there is resistance.", "Finally the result.", "Poi la corrente scorre.", "Затем идёт ток.", "Apoi curentul circulă.", "次に電流が流れます。"]) {
      expect(finalProblems(lesson([{ say }, { say: "Second." }])).join(" "), say).toContain("first sentence");
    }
    for (const say of ["Ohm's law ties voltage to current.", "Nextcloud is a file server.", "Thenar muscles move the thumb."]) expect(finalProblems(lesson([{ say }, { say: "Next, more." }])), say).toEqual([]);
  });
  it("wants every curve a note speaks of to be drawn", () => {
    const note = { kind: "note", text: "Upper line: Compound Interest" };
    expect(finalProblems(lesson([{ say: "A." }, { say: "B.", items: [{ kind: "plot", expr: "1000 * (1 + 0.05 * x)", xmin: 0, xmax: 10 }, note] }])).join(" ")).toContain("no plot draws");
    expect(finalProblems(lesson([{ say: "A." }, { say: "B.", items: [{ kind: "plot", expr: "1000 * (1 + 0.05 * x)", more: ["1000 * 1.05^x"], xmin: 0, xmax: 10 }, note] }]))).toEqual([]);
  });
  it("wants every cell readable in full and every number of a plot to be one the lesson gives", () => {
    const long = "x".repeat(60);
    expect(finalProblems(lesson([{ say: "A." }, { say: "B.", items: [{ kind: "cells", values: [long, "2"], pointer: 0 }] }])).join(" ")).toContain("is cut");
    expect(finalProblems(lesson([{ say: "A." }, { say: "B.", items: [{ kind: "cells", values: ["3 * Factorial(2)", "3 * (2 * Factorial(1))"], pointer: 0 }] }]))).toEqual([]);
    const ohm = (expr: string) => lesson([{ say: "If current is 4 Amperes and resistance is 6 Ohms, voltage is 24 Volts." }, { say: "The plot shows it.", items: [{ kind: "plot", expr, xmin: 0, xmax: 5 }] }]);
    expect(finalProblems(ohm("7*x")).join(" ")).toContain("a number the lesson never gives");
    expect(finalProblems(ohm("6*x"))).toEqual([]);
    expect(finalProblems(ohm("x^2"))).toEqual([]);
  });
  it("recomputes a middle index and accepts a floor only when the sentence says so", () => {
    expect(checkArithmetic("With low = 4 and high = 7, mid = 9.")).toEqual(["mid of low 4 and high 7 = 9"]);
    expect(checkArithmetic("With low = 4 and high = 7, mid = 5.")).toEqual([]);
    expect(checkArithmetic("low is 0, high is 6, so mid = (0 + 6) / 2 = 3.")).toEqual([]);
    expect(checkArithmetic("mid = (4 + 7) / 2 = 5, rounded down.")).toEqual([]);
    expect(checkArithmetic("mid = (4 + 7) / 2 = 5.")).toEqual(["(4 + 7) / 2 = 5"]);
    expect(checkArithmetic("mid = (4 + 7) / 2 = 4, rounded down.")).toEqual(["(4 + 7) / 2 = 4"]);
  });
});

describe("a worked example stays readable", () => {
  const TRACE = ["Factorial(3)", "3 * Factorial(2)", "3 * (2 * Factorial(1))", "3 * (2 * (1 * Factorial(0)))", "3 * 2", "6"];
  const lesson = validateLesson({ title: "Recursion", scene: "stack", steps: [{ say: "A function calls itself.", items: [{ kind: "node", id: "f", text: "Function" }] }, { say: "The trace.", items: [{ kind: "cells", values: TRACE, pointer: 3 }] }] }, { maxSteps: 7, texOk })!;
  it("keeps every value of a row of cells whole", () => {
    expect(lesson.steps[1].items).toEqual([{ kind: "cells", values: TRACE, pointer: 3 }]);
  });
  it.each(["wide", "tall"] as const)("draws long values one under the other on the %s board, none cut", (shape) => {
    const board = layoutBoard(lesson, 1, shape);
    const cells = board.blocks.find((b) => b.kind === "cells");
    expect(cells).toMatchObject({ column: true, cut: false, values: TRACE });
    expect(layoutProblems(board)).toEqual([]);
    // short values still make a row
    const short = validateLesson({ title: "Search", scene: "stack", steps: [{ say: "A list.", items: [{ kind: "cells", values: ["1", "3", "5", "7", "9", "11", "13"], pointer: 3 }] }, { say: "B." }] }, { maxSteps: 7, texOk })!;
    expect(layoutBoard(short, 0, shape).blocks.find((b) => b.kind === "cells")).toMatchObject({ column: false, cut: false });
  });
  it("keeps a plot that adds a second curve to one already drawn", () => {
    const market = validateLesson({ title: "Market", scene: "flow", steps: [{ say: "Demand falls with price.", items: [{ kind: "plot", expr: "10 - x", xmin: 0, xmax: 8 }] }, { say: "Supply rises, and they meet.", items: [{ kind: "plot", expr: "10 - x", more: ["x"], xmin: 0, xmax: 8 }] }, { say: "The same again.", items: [{ kind: "plot", expr: "10 - x", more: ["x"], xmin: 0, xmax: 8 }] }] }, { maxSteps: 7, texOk })!;
    expect(market.steps[1].items).toEqual([{ kind: "plot", expr: "10 - x", xmin: 0, xmax: 8, text: "", more: ["x"] }]);
    expect(market.steps[2].items).toEqual([]);
  });
});
