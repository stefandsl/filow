import { describe, expect, it } from "vitest";
import { labelsOverlap, markShape, placeLabels, polylineLength } from "./marks";
import { cubicBezier, MARK_EXIT_MS, markTiming, PEN_EASE, strokeMs } from "./motion";
import type { BuddyMark } from "./prompt";

const box: BuddyMark = { kind: "box", x1: 420, y1: 300, x2: 700, y2: 370, label: "Save button", screen: 1 };
const circle: BuddyMark = { kind: "circle", x: 1100, y: 340, r: 60, label: "Search", screen: 1 };
const underline: BuddyMark = { kind: "underline", x1: 420, x2: 820, y: 600, label: "Page title", screen: 1 };
const arrow: BuddyMark = { kind: "arrow", x1: 1400, y1: 720, x2: 1150, y2: 520, label: "Lift fan", screen: 1 };
const scene = [box, circle, underline, arrow];
const view = { width: 1920, height: 1080 };
const size = (text: string) => ({ width: text.length * 9 + 22, height: 30 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const rect = (s: { x: number; y: number; width: number; height: number }) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height });
const hit = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("pen timing", () => {
  it("scales the stroke time with its length, within 300-700 ms", () => {
    expect(strokeMs(0)).toBe(300);
    expect(strokeMs(40)).toBe(300);
    expect(strokeMs(200)).toBe(360);
    expect(strokeMs(600)).toBe(560);
    expect(strokeMs(880)).toBe(700);
    expect(strokeMs(5000)).toBe(700);
    expect(strokeMs(Number.NaN)).toBe(300);
    expect(strokeMs(-50)).toBe(300);
    // strictly longer in the middle of the range
    expect(strokeMs(400)).toBeGreaterThan(strokeMs(300));
  });

  it("starts the ink at once: the ease shows ink in the first frames, and never steps more than 8% per frame", () => {
    const pen = cubicBezier(PEN_EASE);
    // 34 ms into the shortest stroke more than 2% is drawn
    expect(pen.at(34 / 300)).toBeGreaterThan(0.02);
    expect(pen.at(16.7 / 300)).toBeGreaterThan(0.02);
    // the steepest 60 Hz frame of an answer's strokes (400-700 ms), and of the shortest one
    const worst = (d: number) => {
      let w = 0;
      for (let t = 0; t < d; t += 1) w = Math.max(w, pen.at((t + 16.7) / d) - pen.at(t / d));
      return w;
    };
    expect(worst(400)).toBeLessThanOrEqual(0.08);
    expect(worst(700)).toBeLessThanOrEqual(0.05);
    expect(worst(300)).toBeLessThanOrEqual(0.1);
    // an ease-out: faster at the start than at the end
    expect(pen.at(0.1)).toBeGreaterThan(1 - pen.at(0.9));
    expect(pen.at(0)).toBe(0);
    expect(pen.at(1)).toBe(1);
    expect(pen.at(0.5)).toBeGreaterThan(0.5);
  });

  it("inverts the ease: the time the pen reaches a share of the line", () => {
    const pen = cubicBezier(PEN_EASE);
    for (const p of [0.1, 0.5, 0.7, 0.92]) expect(pen.at(pen.timeFor(p))).toBeCloseTo(p, 4);
    // the ease-out reaches 70% well before 70% of the time
    expect(pen.timeFor(0.7)).toBeLessThan(0.55);
    expect(pen.timeFor(0.7)).toBeGreaterThan(0.3);
  });

  it("brings the label in when the pen is ~70% along, the arrow head as the shaft ends", () => {
    const t = markTiming(600);
    expect(t.strokeMs).toBe(560);
    const pen = cubicBezier(PEN_EASE);
    expect(pen.at(t.labelMs / t.strokeMs)).toBeCloseTo(0.7, 2);
    expect(t.headMs).toBeGreaterThan(t.labelMs);
    expect(t.headMs).toBeLessThan(t.strokeMs);
  });

  it("goes away within 200-300 ms", () => {
    expect(MARK_EXIT_MS).toBeGreaterThanOrEqual(200);
    expect(MARK_EXIT_MS).toBeLessThanOrEqual(300);
  });
});

describe("mark shapes", () => {
  it("measures the stroke it draws", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    for (const m of scene) {
      const s = markShape(m);
      expect(s.length).toBeCloseTo(polylineLength(s.points), 6);
      expect(s.d.startsWith("M")).toBe(true);
      expect(s.d).not.toMatch(/NaN|undefined/);
    }
  });

  it("closes the circle: its last point comes back past its first", () => {
    const s = markShape(circle);
    const first = s.points[0];
    // somewhere after a whole turn the pen passes within a couple of px of where it started
    const near = Math.min(...s.points.slice(Math.floor(s.points.length * 0.85)).map((p) => dist(p, first)));
    expect(near).toBeLessThan(3);
    // and carries on beyond it (an overlap, not a gap)
    expect(dist(s.points[s.points.length - 1], first)).toBeGreaterThan(10);
    // a loop about the circle's size: perimeter of the ellipse plus the overlap
    expect(s.length).toBeGreaterThan(2 * Math.PI * 60);
    expect(s.length).toBeLessThan(2 * Math.PI * 60 * 1.35);
  });

  it("draws the box as a closed, rounded loop around its subject", () => {
    const s = markShape(box);
    const first = s.points[0];
    const near = Math.min(...s.points.slice(Math.floor(s.points.length * 0.8)).map((p) => dist(p, first)));
    expect(near).toBeLessThan(3);
    // never inside the subject: every point is outside the box it marks
    for (const p of s.points) expect(p.x < 420 || p.x > 700 || p.y < 300 || p.y > 370).toBe(true);
    // rounded corners: no point sits at the sharp corner of the padded box
    expect(Math.min(...s.points.map((p) => dist(p, { x: 414, y: 294 })))).toBeGreaterThan(2);
    // a hand-drawn line, not a ruler: the top edge is not perfectly straight
    const top = s.points.filter((p) => p.x > 450 && p.x < 670 && p.y < 300);
    expect(new Set(top.map((p) => p.y.toFixed(1))).size).toBeGreaterThan(1);
    // the same box always looks the same
    expect(markShape(box).d).toBe(s.d);
  });

  it("ends the arrow in a filled, tapered head at its target, the shaft stopping inside it", () => {
    const s = markShape(arrow);
    expect(s.head).toMatch(/^M[\d.,-]+ L[\d.,-]+ L[\d.,-]+ L[\d.,-]+ Z$/);
    const tip = s.head!.slice(1).split(" ")[0].split(",").map(Number);
    expect(dist({ x: tip[0], y: tip[1] }, { x: 1150, y: 520 })).toBeLessThan(1.5);
    // one stroke for the shaft (the head is not drawn as two pen lines)
    expect(s.d.match(/M/g)).toHaveLength(1);
    const end = s.points[s.points.length - 1];
    expect(dist(end, { x: 1150, y: 520 })).toBeGreaterThan(5);
    expect(dist(end, { x: 1150, y: 520 })).toBeLessThan(20);
  });
});

describe("label placement", () => {
  it("places the four labels of an answer apart, off the marks and on screen", () => {
    const spots = placeLabels(scene, scene.map((m) => size(m.label)), view);
    expect(labelsOverlap(spots)).toBe(false);
    spots.forEach((s, i) => {
      expect(s).not.toBeNull();
      const r = rect(s!);
      expect(r.left).toBeGreaterThanOrEqual(8);
      expect(r.top).toBeGreaterThanOrEqual(8);
      expect(r.right).toBeLessThanOrEqual(view.width - 8);
      expect(r.bottom).toBeLessThanOrEqual(view.height - 8);
      // not on its own mark
      expect(hit(r, markShape(scene[i]).bounds)).toBe(false);
    });
  });

  it("joins each label to its mark with a leader from the mark's edge to the label's edge", () => {
    const spots = placeLabels(scene, scene.map((m) => size(m.label)), view);
    spots.forEach((s, i) => {
      const r = rect(s!);
      // the leader ends on the label's border
      const onEdge = Math.abs(s!.to.x - r.left) < 0.01 || Math.abs(s!.to.x - r.right) < 0.01 || Math.abs(s!.to.y - r.top) < 0.01 || Math.abs(s!.to.y - r.bottom) < 0.01;
      expect(onEdge).toBe(true);
      // and starts on the mark: a point of its stroke (or the arrow's tail)
      const pts = scene[i].kind === "arrow" ? [{ x: 1400, y: 720 }] : markShape(scene[i]).points;
      expect(Math.min(...pts.map((p) => dist(p, s!.from)))).toBeLessThan(0.01);
      // short and visible
      expect(dist(s!.from, s!.to)).toBeGreaterThan(4);
      expect(dist(s!.from, s!.to)).toBeLessThan(80);
    });
  });

  it("pushes labels apart when marks crowd together", () => {
    const crowd: BuddyMark[] = [
      { kind: "circle", x: 500, y: 400, r: 20, label: "One long label here", screen: 1 },
      { kind: "circle", x: 540, y: 400, r: 20, label: "Second long label", screen: 1 },
      { kind: "circle", x: 580, y: 400, r: 20, label: "Third long label", screen: 1 },
      { kind: "underline", x1: 480, x2: 620, y: 440, label: "Fourth one", screen: 1 },
      { kind: "box", x1: 470, y1: 380, x2: 630, y2: 450, label: "Fifth", screen: 1 },
    ];
    const spots = placeLabels(crowd, crowd.map((m) => size(m.label)), view);
    expect(labelsOverlap(spots)).toBe(false);
    // each one still next to its own mark (a free spot beside it, not pushed far down the screen)
    for (const s of spots) expect(dist(s!.from, s!.to)).toBeLessThan(60);
  });

  it("keeps a label off the other marks, not only its own", () => {
    // the box's first choice (below it) lies on the underline right under the box
    const pair: BuddyMark[] = [
      { kind: "box", x1: 400, y1: 400, x2: 600, y2: 440, label: "Save button", screen: 1 },
      { kind: "underline", x1: 380, x2: 640, y: 480, label: "", screen: 1 },
    ];
    const spots = placeLabels(pair, [size("Save button"), null], view);
    expect(hit(rect(spots[0]!), markShape(pair[1]).bounds)).toBe(false);
  });

  it("keeps labels off the pill and on screen near the edges", () => {
    const pill = { left: 860, top: 10, right: 1060, bottom: 42 };
    const top: BuddyMark[] = [
      { kind: "circle", x: 960, y: 70, r: 24, label: "Under the pill", screen: 1 },
      { kind: "box", x1: 1860, y1: 1040, x2: 1915, y2: 1075, label: "Corner", screen: 1 },
    ];
    const spots = placeLabels(top, top.map((m) => size(m.label)), view, [pill]);
    expect(hit(rect(spots[0]!), pill)).toBe(false);
    // it finds the free side of its circle instead of being pushed away from it
    expect(dist(spots[0]!.from, spots[0]!.to)).toBeLessThan(40);
    expect(hit(rect(spots[0]!), markShape(top[0]).bounds)).toBe(false);
    for (const s of spots) {
      const r = rect(s!);
      expect(r.right).toBeLessThanOrEqual(view.width - 8);
      expect(r.bottom).toBeLessThanOrEqual(view.height - 8);
    }
  });

  it("gives no spot to a mark with no label", () => {
    const spots = placeLabels([{ ...box, label: "" }, circle], [null, size("Search")], view);
    expect(spots[0]).toBeNull();
    expect(spots[1]).not.toBeNull();
    // an empty label gets no spot even when a size is given for it
    expect(placeLabels([{ ...box, label: "" }], [size("x")], view)[0]).toBeNull();
  });

  it("puts a box's and a line's label on their trailing side, off the badges rows start with", () => {
    const row: BuddyMark[] = [
      { kind: "box", x1: 420, y1: 300, x2: 700, y2: 370, label: "Save button", screen: 1 },
      { kind: "underline", x1: 420, x2: 820, y: 600, label: "Page title", screen: 1 },
    ];
    const spots = placeLabels(row, row.map((m) => size(m.label)), view);
    // the left edge of a row (where its 01, 02... badge sits) stays clear: each label starts right of its mark
    expect(spots[0]!.x).toBeGreaterThan(700);
    expect(spots[1]!.x).toBeGreaterThan(820);
  });

  it("tells overlapping labels apart from clear ones", () => {
    const a = { x: 0, y: 0, width: 50, height: 30, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
    expect(labelsOverlap([a, { ...a, x: 40 }])).toBe(true);
    expect(labelsOverlap([a, { ...a, x: 60 }, null])).toBe(false);
  });
});
