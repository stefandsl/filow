import { describe, expect, it } from "vitest";
import { CARD_EXIT, CARD_EXIT_MS, CARD_GAP, cardLeader, leadersFor, placeCards, sameCards, subjectZone, SUBJECT_CLEAR } from "./cards";
import type { Rect } from "./marks";

const view = { width: 1920, height: 1080 };
const size = { width: 280, height: 420 };
const box = (s: { x: number; y: number }) => ({ left: s.x, top: s.y, right: s.x + size.width, bottom: s.y + size.height });
const hits = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("explanation cards", () => {
  it("go beside their subject, on its right first, a gap away", () => {
    const s = { x: 1000, y: 330 };
    const at = placeCards(s, size, view);
    expect(at.side).toBe("right");
    expect(at.x).toBe(s.x + CARD_GAP);
    expect(hits(box(at), subjectZone(s))).toBe(false);
  });

  it("never cover their subject, near any edge of the screen", () => {
    for (const s of [{ x: 1890, y: 40 }, { x: 30, y: 1050 }, { x: 1900, y: 1060 }, { x: 960, y: 20 }, { x: 960, y: 540 }]) {
      const at = placeCards(s, size, view);
      expect(hits(box(at), subjectZone(s)), JSON.stringify(s)).toBe(false);
      expect(at.x).toBeGreaterThanOrEqual(12);
      expect(at.y).toBeGreaterThanOrEqual(12);
      expect(at.x + size.width).toBeLessThanOrEqual(view.width - 12);
      expect(at.y + size.height).toBeLessThanOrEqual(view.height - 12);
    }
  });

  it("go to the left when a mark and its label hold the right side", () => {
    const s = { x: 1000, y: 330 };
    const mark: Rect = { left: 1040, top: 100, right: 1500, bottom: 800 };
    const at = placeCards(s, size, view, [mark]);
    expect(at.side).toBe("left");
    expect(hits(box(at), mark)).toBe(false);
  });

  it("keep off every card's own subject, not only the first", () => {
    const s = { x: 1000, y: 330 };
    const other = { x: 1100, y: 330 };
    const at = placeCards(s, size, view, [], [s, other]);
    expect(hits(box(at), subjectZone(other))).toBe(false);
    expect(hits(box(at), subjectZone(s))).toBe(false);
  });

  it("keep off the pill and the bubble when there is room elsewhere", () => {
    const s = { x: 960, y: 140 };
    const pill: Rect = { left: 760, top: 10, right: 1160, bottom: 42 };
    const bubble: Rect = { left: 990, top: 160, right: 1370, bottom: 330 };
    const at = placeCards(s, size, view, [pill, bubble]);
    expect(hits(box(at), pill)).toBe(false);
    expect(hits(box(at), bubble)).toBe(false);
  });

  it("draw a leader from the subject to the nearest edge of its card", () => {
    const l = cardLeader({ x: 1000, y: 330 }, { left: 1044, top: 200, right: 1324, bottom: 620 });
    expect(l.from).toEqual({ x: 1000, y: 330 });
    expect(l.to).toEqual({ x: 1044, y: 330 });
    expect(cardLeader({ x: 10, y: 10 }, { left: 100, top: 100, right: 200, bottom: 200 }).to).toEqual({ x: 100, y: 100 });
  });

  it("give one leader to cards about one spot, and one more to a card about another", () => {
    expect(leadersFor([{ x: 10, y: 10 }, { x: 20, y: 15 }])).toEqual([true, false]);
    expect(leadersFor([{ x: 10, y: 10 }, { x: 300, y: 15 }])).toEqual([true, true]);
  });

  it("are the same cards when only a picture arrived", () => {
    const a = [{ title: "Fan", text: "x", photo: "" }];
    expect(sameCards(a, [{ title: "Fan", text: "x", photo: "data:image/png;base64,AA" }])).toBe(true);
    expect(sameCards(a, [{ title: "Fan", text: "y", photo: "" }])).toBe(false);
    expect(sameCards(a, [...a, ...a])).toBe(false);
  });

  it("leave in the marks' time: a fade, then the leader erases", () => {
    expect(CARD_EXIT_MS).toBe(CARD_EXIT.leaderDelayMs + CARD_EXIT.leaderMs);
    expect(SUBJECT_CLEAR).toBeLessThan(CARD_GAP);
  });
});
