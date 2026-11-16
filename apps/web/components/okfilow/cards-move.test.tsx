// Prover C7: the cards column must go where the user dragged it (move.moved.cards x/y), and keep that place
// for the next answer. No DOM in this sandbox (environment node, no jsdom), so React's hooks are driven by a
// tiny harness: CardsLayer's own placement layout effect runs unchanged, and what it sets is checked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  sets: [] as unknown[],
  layout: [] as Array<() => void>,
  refs: 0,
  el: null as unknown,
}));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  let si = 0;
  return {
    ...real,
    default: real,
    useState: (init: unknown) => {
      const i = si++ % 2; // CardsLayer: [shown, leaving]
      const v = h.states[i] !== undefined ? h.states[i] : init;
      return [v, (n: unknown) => { if (i === 0) h.sets.push(n); }];
    },
    useRef: (init: unknown) => ({ current: ++h.refs % 4 === 0 ? h.el : init }), // 4th ref is the column
    useEffect: () => {},
    useLayoutEffect: (fn: () => void) => { h.layout.push(fn); },
  };
});

const { CardsLayer } = await import("./cards-layer");

const card = { x: 300, y: 300, title: "A", text: "b", photo: "" } as never;
const userBox = { x: 900, y: 500, w: 300, h: 200 };
const move = { moved: { cards: userBox }, onBox: () => {}, onReset: () => {} };

beforeEach(() => {
  h.states = []; h.sets = []; h.layout = []; h.refs = 0;
  h.el = { offsetHeight: 200, children: [{ offsetTop: 0, offsetHeight: 200 }] };
  (globalThis as { window?: unknown }).window = { innerWidth: 1920, innerHeight: 1080 };
});

function place(spot: { x: number; y: number; side: string } | null) {
  h.states = [{ id: 1, cards: [card], photos: [null], spot, leaders: [] }, null];
  CardsLayer({ cards: [card], avoid: () => [], move, t: (k) => k });
  h.layout.forEach((f) => f());
  const last = h.sets.at(-1) as { spot: { x: number; y: number } } | undefined;
  return last?.spot ?? spot;
}

describe("the cards column follows the user's move", () => {
  it("after a drag (moved.cards changes) the column is placed at the dragged x/y", () => {
    const spot = place({ x: 100, y: 100, side: "right" });
    expect(spot).toMatchObject({ x: userBox.x, y: userBox.y });
  });
  it("the next answer's column keeps the remembered place", () => {
    const spot = place(null);
    expect(spot).toMatchObject({ x: userBox.x, y: userBox.y });
  });
});
