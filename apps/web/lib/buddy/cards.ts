// Where an answer's explanation cards go, pure so it is unit tested: a column beside the spot the
// cards explain (their subject), in free space, never on the subject itself, off the marks, their
// labels, the pill and the answer bubble, wholly on screen; with a leader line from the subject to
// the nearest edge of its card.
import type { Rect } from "./marks";

type P = { x: number; y: number };
type Size = { width: number; height: number };

/** The column's width (the CSS of .okf-cards says the same). */
export const CARD_WIDTH = 280;
/** How far the column stands off its subject. */
export const CARD_GAP = 44;
/** The square around a subject that a card never covers (half its side). */
export const SUBJECT_CLEAR = 40;
/** Subjects closer than this share one leader (the first card's). */
export const SAME_SUBJECT = 24;
/** How long the cards take to go away (the same as the marks: a fade, then the leader erases). */
export const CARD_EXIT = { cardMs: 140, leaderDelayMs: 40, leaderMs: 200 } as const;
export const CARD_EXIT_MS = CARD_EXIT.leaderDelayMs + CARD_EXIT.leaderMs;

export type CardSide = "right" | "left" | "below" | "above";
export type CardSpot = { x: number; y: number; side: CardSide };
export type Leader = { from: P; to: P };

const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const near = (a: Rect, b: Rect, margin: number) => a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;

/** The point of `r` nearest `p` (p itself when it is inside). */
export function nearestOnRect(r: Rect, p: P): P {
  return { x: Math.max(r.left, Math.min(p.x, r.right)), y: Math.max(r.top, Math.min(p.y, r.bottom)) };
}

/** The square around a subject that no card may cover. */
export function subjectZone(p: P, clear = SUBJECT_CLEAR): Rect {
  return { left: p.x - clear, top: p.y - clear, right: p.x + clear, bottom: p.y + clear };
}

/** Candidate places for the column around its subject, best first: beside it, then below and above, then further out. */
function candidates(s: P, w: number, h: number, gap: number): CardSpot[] {
  const out: CardSpot[] = [];
  for (const reach of [gap, gap + 140]) {
    for (const k of [0.3, 0.06, 1 - Math.min(0.5, 24 / Math.max(1, h))]) {
      out.push({ side: "right", x: s.x + reach, y: s.y - h * k });
      out.push({ side: "left", x: s.x - reach - w, y: s.y - h * k });
    }
    for (const k of [0.3, 0.06, 1 - Math.min(0.5, 24 / Math.max(1, w))]) {
      out.push({ side: "below", x: s.x - w * k, y: s.y + reach });
      out.push({ side: "above", x: s.x - w * k, y: s.y - reach - h });
    }
  }
  return out;
}

/**
 * Places the cards' column (`size`) beside its subject `subject`: off the `subjects` (every card's
 * spot), off the `avoid` boxes (the marks, their labels, the pill, the bubble), and wholly on screen.
 * The first free candidate wins; when none is free, the one covering the least.
 */
export function placeCards(subject: P, size: Size, view: Size, avoid: Rect[] = [], subjects: P[] = [subject], edge = 12, gap = CARD_GAP): CardSpot {
  const { width: w, height: h } = size;
  const zones = subjects.map((p) => subjectZone(p));
  const clamp = (c: CardSpot): CardSpot => ({ ...c, x: Math.max(edge, Math.min(c.x, view.width - edge - w)), y: Math.max(edge, Math.min(c.y, view.height - edge - h)) });
  const cost = (c: CardSpot, order: number) => {
    const r: Rect = { left: c.x, top: c.y, right: c.x + w, bottom: c.y + h };
    let bad = 0;
    // Covering the subject is the worst thing a card can do.
    for (const z of zones) bad += area(r, z) * 1000 + (near(r, z, 0) ? 1e6 : 0);
    for (const a of avoid) bad += area(r, a) * 10 + (near(r, a, 8) ? 500 : 0);
    // Close to the subject, and the earlier candidates first (a tie keeps the preferred side).
    const to = nearestOnRect(r, subject);
    return bad + Math.hypot(to.x - subject.x, to.y - subject.y) * 0.5 + order * 0.01;
  };
  let best = clamp(candidates(subject, w, h, gap)[0]);
  let bestCost = Infinity;
  candidates(subject, w, h, gap).forEach((c0, i) => {
    const c = clamp(c0);
    const k = cost(c, i);
    if (k < bestCost) { best = c; bestCost = k; }
  });
  return best;
}

/** The leader from a subject to its card's box: from the subject itself to the nearest point of the box. */
export function cardLeader(subject: P, box: Rect): Leader {
  return { from: { ...subject }, to: nearestOnRect(box, subject) };
}

/**
 * Which cards get a leader: the first card always; another only when its subject is somewhere else
 * (cards about one spot share the first card's leader).
 */
export function leadersFor(subjects: P[], same = SAME_SUBJECT): boolean[] {
  return subjects.map((p, i) => i === 0 || subjects.slice(0, i).every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= same));
}

type CardLike = { title: string; text: string; photo?: string };
/**
 * Whether `next` is the same cards as `prev` (the same titles and texts in the same order): a picture
 * that arrives later updates the cards on screen instead of showing them again.
 */
export function sameCards(prev: CardLike[], next: CardLike[]): boolean {
  return prev.length === next.length && prev.every((c, i) => c.title === next[i].title && c.text === next[i].text);
}
