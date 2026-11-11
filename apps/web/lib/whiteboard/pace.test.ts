import { describe, expect, it } from "vitest";
import { layoutBoard } from "./layout";
import { validateLesson } from "./lesson";
import { DRAW_SHARE, PACE_LIMITS, PaceMeter, drawMsFor, spokenUnits, stepSchedule } from "./pace";

const SENTENCE = "Voltage pushes a current through a resistance, and the resistance limits it.";

describe("the voice drives the clock", () => {
  it("estimates a sentence before any voice was heard, longer for a longer one, within its limits", () => {
    const meter = new PaceMeter();
    expect(meter.measured).toBe(false);
    const short = meter.estimate("Ohm's law.");
    const long = meter.estimate(SENTENCE);
    expect(short).toBeGreaterThanOrEqual(PACE_LIMITS.minMs);
    expect(long).toBeGreaterThan(short * 2);
    expect(long).toBeGreaterThan(4_000);
    expect(long).toBeLessThan(8_000);
    expect(meter.estimate("x".repeat(2_000))).toBe(PACE_LIMITS.maxMs);
    // Japanese carries more sound in each character: the same count of characters takes longer
    expect(meter.estimate("電圧が電流を押し流します")).toBeGreaterThan(meter.estimate("abcdefghijkl"));
    expect(spokenUnits("a, b.")).toBe(5 + 8);
  });

  it("learns the voice in use: after a slow voice the next sentence is given more time, after a fast one less", () => {
    // a fake clock: the test says how long each sentence took
    const slow = new PaceMeter();
    const first = slow.estimate(SENTENCE);
    slow.learn(SENTENCE, first * 2);
    expect(slow.measured).toBe(true);
    expect(slow.estimate(SENTENCE)).toBeGreaterThan(first * 1.8);
    expect(slow.estimate(SENTENCE)).toBeLessThanOrEqual(first * 2 + 50);
    const fast = new PaceMeter();
    fast.learn(SENTENCE, first / 2);
    expect(fast.estimate(SENTENCE)).toBeLessThan(first * 0.6);
    // later sentences move the rate by a third, so one odd sentence does not throw the clock
    const steady = new PaceMeter();
    steady.learn(SENTENCE, first);
    steady.learn(SENTENCE, first * 3);
    expect(steady.estimate(SENTENCE)).toBeGreaterThan(first);
    expect(steady.estimate(SENTENCE)).toBeLessThan(first * 2);
  });

  it("learns nothing from a voice that was cut or never spoke", () => {
    const meter = new PaceMeter();
    const before = meter.estimate(SENTENCE);
    meter.learn(SENTENCE, 120);
    meter.learn("Hi.", 900);
    meter.learn(SENTENCE, 400_000);
    expect(meter.measured).toBe(false);
    expect(meter.estimate(SENTENCE)).toBe(before);
  });

  const lesson = validateLesson({ title: "Ohm's law", scene: "flow", steps: [
    { say: "Voltage drives current.", items: [{ kind: "node", id: "v", text: "Voltage" }, { kind: "node", id: "i", text: "Current" }, { kind: "edge", from: "v", to: "i", text: "drives" }] },
    { say: "One formula ties them.", items: [{ kind: "node", id: "r", text: "Resistance" }, { kind: "edge", from: "r", to: "i", text: "limits" }, { kind: "formula", tex: "V = I R" }, { kind: "plot", expr: "2*x", xmin: 0, xmax: 5 }, { kind: "mark", target: "i", style: "circle" }] },
  ] })!;

  it("spreads the new things of a step over the time of its sentence: one after the other, none before 0, none after the end", () => {
    const board = layoutBoard(lesson, 1, "wide");
    const sayMs = 6_000;
    const slots = stepSchedule(board, 1, drawMsFor(sayMs));
    // only what step 2 adds: the box, the arrow, the mark, the formula, the plot
    expect([...slots.keys()].sort()).toEqual([...board.edges.filter((e) => e.step === 1).map((e) => e.key), ...board.marks.map((m) => m.key), ...board.blocks.map((b) => b.key), "n:r"].sort());
    const order = [...slots.values()];
    expect(order[0].at).toBe(0);
    for (let k = 1; k < order.length; k++) expect(order[k].at).toBeGreaterThanOrEqual(order[k - 1].at + order[k - 1].len - 1);
    const end = Math.max(...order.map((s) => s.at + s.len));
    // the pen never runs ahead of the words, and is done before the voice is
    expect(end).toBeLessThanOrEqual(sayMs * DRAW_SHARE + order.length);
    expect(end).toBeLessThan(sayMs);
    // a plot is more pen work than a mark
    const plot = slots.get(board.blocks.find((b) => b.kind === "plot")!.key)!;
    const mark = slots.get(board.marks[0].key)!;
    expect(plot.len).toBeGreaterThan(mark.len * 2);
  });

  it("does not stretch one box over a long sentence, and gives a step with nothing new no schedule", () => {
    const one = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "A" }] }, { say: "t", items: [{ kind: "mark", target: "a", style: "circle" }] }] })!;
    const slots = stepSchedule(layoutBoard(one, 0, "wide"), 0, 12_000);
    expect(slots.get("n:a")!.len).toBeLessThan(2_000);
    expect(stepSchedule(layoutBoard(one, 1, "wide"), 7, 5_000).size).toBe(0);
    expect(stepSchedule(layoutBoard(one, 0, "wide"), 0, 0).size).toBe(0);
  });
});
