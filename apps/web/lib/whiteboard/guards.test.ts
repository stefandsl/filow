import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/cloud-r3.json";
import rawFixtures from "./fixtures/cloud-r5-raw.json";
import { GUARDS, finalProblems, generateCloud, labelNotes, missingNames, orphanBoxes, placeNotes, texOk, validatorLosses, wrongSums, type Ask, type LessonEvent } from "./generate";
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
/** The three guards the paid raw-against-shown run showed to lower the score: off by default, tested switched on. */
const ON = { examiner: true, arrows: true, sums: true };
async function shown(f: Fixture, play: Play = {}, audit = false, guards: Partial<typeof GUARDS> = ON) {
  const events: LessonEvent[] = [];
  const model = fake(f, play);
  await generateCloud(model.ask, { question: f.question, lang: "en", maxSteps: LIMITS.steps, audit, guards }, (e) => events.push(e));
  const steps = events.flatMap((e) => (e.type === "step" ? [e.step] : []));
  return { events, steps, asked: model.asked, error: events.find((e) => e.type === "error"), done: events.find((e) => e.type === "done"), audit: events.find((e) => e.type === "audit") };
}
/** What a step draws, without regard to order inside the step (notes may be moved to their box's step). */
const drawn = (items: LessonItem[], skip: (it: LessonItem) => boolean = () => false) => items.filter((it) => !skip(it)).map((it) => JSON.stringify(it)).sort();
const everything = (steps: Array<{ items: LessonItem[] }>, skip?: (it: LessonItem) => boolean) => drawn(steps.flatMap((s) => s.items), skip);
const written = (f: Fixture) => validateLesson(f.lesson, { maxSteps: LIMITS.steps, texOk, sketch: true })!;

describe("the default online path, replayed over the raw lessons of the paid round 5b runs: shown equals raw", () => {
  type Raw = { run: string; n: number; question: string; raw: { topic?: string; title: string; steps: Array<{ say: string; items: unknown[] }> } };
  const RAW = rawFixtures as unknown as Raw[];
  /** The model played by the test writes exactly what the real one wrote, every time it is asked. */
  const replay = async (f: Raw) => {
    const events: LessonEvent[] = [];
    const asked: string[] = [];
    const ask: Ask = async ({ system }) => {
      asked.push(system.slice(0, 60));
      return system.startsWith("Define the topic") ? "A definition of the topic." : JSON.stringify(f.raw);
    };
    await generateCloud(ask, { question: f.question, lang: "en", maxSteps: LIMITS.steps, audit: true }, (e) => events.push(e));
    return { events, asked, steps: events.flatMap((e) => (e.type === "step" ? [e.step] : [])), error: events.find((e) => e.type === "error") as { code: string } | undefined, done: events.find((e) => e.type === "done"), changes: (events.find((e) => e.type === "audit") as { changes: string[] } | undefined)?.changes ?? [] };
  };
  const offTopic = (f: Raw) => missingNames(f.question, `${f.raw.topic ?? ""} ${f.raw.title}`).length > 0;

  it("has the twenty raw lessons, two of them written about another cycle because the provider hid the name", () => {
    expect(RAW).toHaveLength(20);
    expect(RAW.filter(offTopic).map((f) => `${f.n} ${f.raw.title}`)).toEqual(["7 Nitrogen Cycle Outline", "7 The Nitrogen Cycle"]);
  });

  it.each(RAW.filter((f) => !offTopic(f)).map((f) => [`${f.run}/${f.n} ${f.question}`, f] as const))("%s: one call, and the lesson on the board is the lesson the model wrote", async (_name, f) => {
    const got = await replay(f);
    expect(got.error).toBeUndefined();
    expect(got.asked).toHaveLength(1);
    // what the validator makes of the raw answer (what can be drawn safely), with nothing else done to it
    const written = validateLesson(f.raw, { maxSteps: LIMITS.steps, texOk, sketch: true })!;
    expect(got.steps.map((s) => s.say)).toEqual(f.raw.steps.slice(0, LIMITS.steps).map((s) => s.say.trim()));
    // every box, arrow, formula, curve, cell and sketch, in its own step, untouched
    got.steps.forEach((s, k) => expect(drawn(s.items, (it) => it.kind === "note")).toEqual(drawn(written.steps[k].items, (it) => it.kind === "note")));
    // every remark is there: at most moved to the step of its box and given the name of its box
    expect(everything(got.steps)).toEqual(everything(labelNotes(f.raw, placeNotes(written)).steps));
    const bare = (steps: Array<{ items: LessonItem[] }>) => steps.flatMap((s) => s.items).flatMap((it) => (it.kind === "note" ? [it.text.replace(/^[^:]{1,40}: /, "")] : [])).sort();
    expect(bare(got.steps).length).toBe(written.steps.flatMap((s) => s.items).filter((it) => it.kind === "note").length);
    // no arrow turned or removed, no step marked, no doubt raised, no rewrite asked for
    expect(got.done).toEqual({ type: "done", cards: 0, stalled: false });
    expect(got.changes.filter((c) => !c.includes("the validator did not keep") && !c.startsWith("noted only"))).toEqual([]);
  });

  it.each(RAW.filter(offTopic).map((f) => [`${f.run}/${f.n}`, f] as const))("%s: a lesson about another topic is refused whole, never shown", async (_name, f) => {
    const got = await replay(f);
    expect(got.steps).toEqual([]);
    expect(got.error).toMatchObject({ code: "topic" });
    // the lesson, one rewrite, the definition, a third lesson
    expect(got.asked).toHaveLength(4);
  });

  it("is off for the examiner, the arrow judge and the sum rewrite when nothing is asked for: one call even for a lesson with a wrong sum and a doubtful arrow", async () => {
    expect(GUARDS).toEqual({ examiner: false, arrows: false, sums: false, must: false, links: false, removeLoneBoxes: false });
    let calls = 0;
    const wrong = { title: "Sums", scene: "flow", steps: [{ say: "Twice the sum is (3+4)*2 = 12.", items: [{ kind: "node", id: "a", text: "Sum" }, { kind: "node", id: "b", text: "Result" }, { kind: "edge", from: "b", to: "a", text: "receives" }] }, { say: "That is all.", items: [{ kind: "note", text: "done" }] }] };
    const events: LessonEvent[] = [];
    await generateCloud(async () => { calls++; return JSON.stringify(wrong); }, { question: "sums", lang: "en", maxSteps: 7 }, (e) => events.push(e));
    expect(calls).toBe(1);
    expect(events[events.length - 1]).toEqual({ type: "done", cards: 0, stalled: false });
  });
  it("what the validator did not keep of those lessons is only what was written twice", () => {
    const lost = RAW.filter((f) => !offTopic(f)).flatMap((f) => validatorLossesOf(f.raw).map((l) => `${f.run}/${f.n} ${l}`));
    // a remark made twice, the same row of cells with the same pointer, the same plot again: nothing else.
    // (Before this round the cap of 6 items a step cut the arrow from CO2 to the plant, and the cap of 10 boxes cut "Starch" with its arrow.)
    expect(lost).toEqual(["r5-run1/3 step 4: the validator did not keep 1 note", "r5-run1/6 step 3: the validator did not keep 1 cells", "r5-run1/6 step 6: the validator did not keep 1 cells", "r5-run1/8 step 3: the validator did not keep 1 plot", "r5-run2/3 step 4: the validator did not keep 1 note", "r5-run2/6 step 3: the validator did not keep 1 cells", "r5-run2/6 step 5: the validator did not keep 1 cells", "r5-run2/6 step 6: the validator did not keep 1 cells", "r5-run2/8 step 3: the validator did not keep 1 plot"]);
  });
});

const validatorLossesOf = (raw: unknown) => validatorLosses(raw, validateLesson(raw, { maxSteps: LIMITS.steps, texOk, sketch: true })!);

describe("the guards that are off by default, switched on and replayed over saved real lessons", () => {
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

describe("nothing is drawn twice on the board", () => {
  const market = validateLesson({ title: "Market", scene: "flow", steps: [
    { say: "Supply rises with price.", items: [{ kind: "plot", expr: "x", xmin: 0, xmax: 10 }] },
    { say: "Demand falls, and they meet.", items: [{ kind: "plot", expr: "10 - x", more: ["x"], xmin: 0, xmax: 10 }] },
    { say: "Another curve.", items: [{ kind: "plot", expr: "x^2", xmin: 0, xmax: 3 }] },
  ] }, { maxSteps: 7, texOk })!;
  it("a plot that draws an earlier plot's curves and one more takes its place", () => {
    const plots = (upto: number) => layoutBoard(market, upto, "wide").blocks.flatMap((b) => (b.kind === "plot" ? [[b.expr, ...(b.more ?? [])].join(" & ")] : []));
    expect(plots(0)).toEqual(["x"]);
    // supply is not drawn a second time on a plot of its own
    expect(plots(1)).toEqual(["10 - x & x"]);
    expect(plots(2)).toEqual(["10 - x & x", "x^2"]);
    // it stays where the first one stood and is drawn anew in its step
    const first = layoutBoard(market, 0, "wide").blocks.find((b) => b.kind === "plot")!;
    const grown = layoutBoard(market, 1, "wide").blocks.find((b) => b.kind === "plot")!;
    expect(grown.key).toBe(first.key);
    expect(grown.step).toBe(1);
  });
  it("a trace that grows by a line is one block, not one more row each step", () => {
    const trace = validateLesson({ title: "Interest", scene: "stack", steps: [
      { say: "Year 0.", items: [{ kind: "cells", values: ["Year 0: 1000", "Year 1: ?"], pointer: 0 }] },
      { say: "Year 1.", items: [{ kind: "cells", values: ["Year 0: 1000", "Year 1: ?", "Year 2: ?"], pointer: 1 }] },
      { say: "Another row.", items: [{ kind: "cells", values: ["Year 9", "Year 10"], pointer: 1 }] },
    ] }, { maxSteps: 7, texOk })!;
    const rows = (upto: number) => layoutBoard(trace, upto, "wide").blocks.flatMap((b) => (b.kind === "cells" ? [b.values.length] : []));
    expect(rows(1)).toEqual([3]);
    expect(rows(2)).toEqual([3, 2]);
  });
  it("lays out every raw lesson of the paid runs: no problem on the wide board", () => {
    const report: string[] = [];
    for (const f of rawFixtures as unknown as Array<{ run: string; n: number; raw: unknown }>) {
      const lesson = validateLesson(f.raw, { maxSteps: LIMITS.steps, texOk, sketch: true })!;
      for (const shape of ["wide", "tall"] as const) for (let i = 0; i < lesson.steps.length; i++) for (const p of layoutProblems(layoutBoard(lesson, i, shape))) report.push(`${f.run}/${f.n} ${shape} step ${i + 1}: ${p}`);
    }
    // the wide board is clean; on the narrow one a label may now stand beside its arrow, which took the
    // dense steps with an arrow or a box on a label from eight to three (those three are open)
    expect(report.filter((r) => r.includes(" wide "))).toEqual([]);
    expect(report.filter((r) => r.includes(" tall ")).length).toBeLessThanOrEqual(3);
  });
});