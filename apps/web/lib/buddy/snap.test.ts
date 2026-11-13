import { describe, expect, it } from "vitest";
import { avoidRects, elementRects, localRects, markTarget, snapMark, snapMarks, UNDERLINE_DROP, type ElementRect } from "./snap";
import { markShape } from "./marks";
import type { BuddyMark } from "./prompt";

const D = { x: 0, y: 0, width: 1920, height: 1080 };
const save: ElementRect = { name: "Save", screen: 1, left: 420, top: 300, right: 520, bottom: 332, type: "Button" };
const title: ElementRect = { name: "Quarterly report", screen: 1, left: 400, top: 560, right: 742, bottom: 590, type: "Text" };
const search: ElementRect = { name: "Search", screen: 1, left: 1060, top: 320, right: 1240, bottom: 356, type: "Edit" };
const settings: ElementRect = { name: "Settings", screen: 1, left: 1500, top: 40, right: 1532, bottom: 72, type: "Button" };
const window_: ElementRect = { name: "Report - Editor", screen: 1, left: 0, top: 0, right: 1920, bottom: 1040, type: "Window" };
const rects = [window_, save, title, search, settings];

describe("marks fit the real thing (UI Automation rectangles)", () => {
  it("a box that names a thing takes its rectangle, whatever the model's rough box was", () => {
    const rough: BuddyMark = { kind: "box", x1: 404, y1: 288, x2: 548, y2: 350, label: "the Save button", screen: 1 };
    const m = snapMark(rough, rects, D);
    expect(m).toMatchObject({ x1: 420, y1: 300, x2: 520, y2: 332 });
    // drawn with the pen's even padding: every side of the stroke within 6 +- 2 px of the thing
    const b = markShape(m).bounds;
    const pad = 4.5; // bounds include the pen width
    for (const gap of [save.left - (b.left + pad), save.top - (b.top + pad), b.right - pad - save.right, b.bottom - pad - save.bottom]) expect(Math.abs(gap - 6)).toBeLessThanOrEqual(2.5);
  });
  it("an unnamed box snaps only when it all but covers a thing of its size", () => {
    const close: BuddyMark = { kind: "box", x1: 412, y1: 296, x2: 530, y2: 340, label: "", screen: 1 };
    expect(snapMark(close, rects, D)).toMatchObject({ x1: 420, x2: 520 });
    const far: BuddyMark = { kind: "box", x1: 800, y1: 700, x2: 900, y2: 760, label: "", screen: 1 };
    expect(snapMark(far, rects, D)).toEqual(far);
  });
  it("an underline runs the text's whole width just below it", () => {
    const rough: BuddyMark = { kind: "underline", x1: 430, x2: 700, y: 604, label: "Quarterly report", screen: 1 };
    expect(snapMark(rough, rects, D)).toMatchObject({ x1: 400, x2: 742, y: 590 + UNDERLINE_DROP });
    // without a name: under the text it lies on, when it covers most of it
    const plain: BuddyMark = { kind: "underline", x1: 410, x2: 730, y: 598, label: "", screen: 1 };
    expect(snapMark(plain, rects, D)).toMatchObject({ x1: 400, x2: 742 });
  });
  it("a circle rings the whole thing, centred on it", () => {
    const rough: BuddyMark = { kind: "circle", x: 1130, y: 330, r: 50, label: "Search", screen: 1 };
    const m = snapMark(rough, rects, D) as Extract<BuddyMark, { kind: "circle" }>;
    expect(m.x).toBe(1150);
    expect(m.y).toBe(338);
    const b = markShape(m).bounds;
    expect(b.left).toBeLessThan(search.left);
    expect(b.right).toBeGreaterThan(search.right);
    expect(b.top).toBeLessThan(search.top);
    expect(b.bottom).toBeGreaterThan(search.bottom);
  });
  it("an arrow's tip stops at the thing's edge, on the tail's side", () => {
    const rough: BuddyMark = { kind: "arrow", x1: 1700, y1: 300, x2: 1530, y2: 60, label: "Settings", screen: 1 };
    const m = snapMark(rough, rects, D) as Extract<BuddyMark, { kind: "arrow" }>;
    // just outside the button, never inside it
    const inside = m.x2 > settings.left && m.x2 < settings.right && m.y2 > settings.top && m.y2 < settings.bottom;
    expect(inside).toBe(false);
    expect(Math.hypot(m.x2 - 1516, m.y2 - 56)).toBeLessThan(30);
    expect([m.x1, m.y1]).toEqual([1700, 300]);
  });
  it("a whole window is never a mark's thing, and another screen's things are not either", () => {
    const rough: BuddyMark = { kind: "box", x1: 0, y1: 0, x2: 1900, y2: 1000, label: "Report - Editor", screen: 1 };
    expect(markTarget(rough, rects, D)).toBeNull();
    const other: BuddyMark = { kind: "box", x1: 404, y1: 288, x2: 548, y2: 350, label: "Save", screen: 2 };
    expect(snapMark(other, rects, D)).toEqual(other);
  });
  it("with no rectangles the marks are untouched", () => {
    const list: BuddyMark[] = [{ kind: "box", x1: 1, y1: 2, x2: 30, y2: 40, label: "x", screen: 1 }];
    expect(snapMarks(list, [])).toBe(list);
  });
});

describe("rectangles for the overlays", () => {
  it("maps the helper's grid to the display's pixels without rounding", () => {
    const [r] = elementRects([{ name: "OK", screen: 2, x1: 100.5, y1: 200, x2: 150, y2: 250 }], [{ index: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }]);
    expect(r.left).toBeCloseTo(1920 + 257.28, 5);
    expect(r.bottom).toBe(360);
  });
  it("keeps the small things (text, buttons), smallest first, and gives each overlay its own", () => {
    const keep = avoidRects(rects, [{ index: 1, bounds: D }]);
    expect(keep.map((r) => r.left)).toEqual([1500, 420, 1060, 400]);
    expect(localRects(keep, { x: 1000, y: 0, width: 920, height: 1080 }).map((r) => r.left)).toEqual([500, 60]);
  });
});
