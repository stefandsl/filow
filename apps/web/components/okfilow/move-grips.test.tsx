import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIMITS, type Box, type MovableKind } from "@/lib/buddy/layout-move";
import { tilesIn } from "@/lib/buddy/media";
import { GRIP_MARGIN, itemHitRects, watchHitRectChanges, type ItemHitRect } from "./hit-rects";

const h = vi.hoisted(() => ({ cleanup: [] as Array<(() => void) | undefined> }));
vi.mock("react", async (orig) => ({
  ...await orig<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
  useMemo: (fn: () => unknown) => fn(),
  useLayoutEffect: () => {},
  useEffect: (fn: () => (() => void) | undefined) => { h.cleanup.push(fn()); },
}));
vi.mock("@filow/ui", () => ({ useLang: () => "en" }));
const { MoveGrips } = await import("./move-grips");
const { MediaLayer } = await import("./media-layer");
const { AnswerBubble } = await import("./bubble");
const { default: Model } = await import("@/app/okfilow/model/page");

let target: EventTarget;
let box: Box;
let item: ReturnType<typeof makeItem>;
let reports: ItemHitRect[][];
const modelMove = vi.fn();
function makeItem() {
  const attrs = new Map<string, string>();
  return {
    getBoundingClientRect: () => ({ left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h }),
    getAttribute: (k: string) => attrs.get(k),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  };
}
const elements = () => [item as unknown as Element];
beforeEach(() => {
  vi.useFakeTimers(); h.cleanup = []; reports = []; modelMove.mockReset();
  box = { x: 300, y: 250, w: 400, h: 320 }; item = makeItem();
  target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, { okFilow: { modelMove, modelRects: (r: ItemHitRect[]) => reports.push(r), onModel: () => () => {}, modelReady() {} } }));
  vi.stubGlobal("document", { querySelectorAll: elements });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => { h.cleanup.forEach((f) => f?.()); vi.unstubAllGlobals(); vi.useRealTimers(); });

function pointer(type: string, x = 740, y = 610, pointerId = 7, buttons = 1, recipient = target) {
  const event = new Event(type);
  Object.assign(event, { clientX: x, clientY: y, screenX: x, screenY: y, pointerId, buttons });
  recipient.dispatchEvent(event);
}
function capture() {
  return Object.assign(new EventTarget(), {
    closest: vi.fn(() => item), setPointerCapture: vi.fn(), hasPointerCapture: (): boolean => true, releasePointerCapture: vi.fn(),
  });
}
function down(cap: ReturnType<typeof capture>) {
  return { button: 0, pointerId: 7, clientX: 700, clientY: 570, screenX: 700, screenY: 570, currentTarget: cap, preventDefault() {}, stopPropagation() {} } as unknown as ReactPointerEvent<HTMLElement>;
}
function start(kind: MovableKind, action: "resize" | "move" = "resize") {
  h.cleanup.push(watchHitRectChanges(() => reports.push(itemHitRects(elements()))));
  const onBox = vi.fn((b: Box) => { box = b; });
  const tree = MoveGrips({ box, area: { x: 0, y: 0, width: 1920, height: 1080 }, lim: LIMITS[kind], onBox, onReset: vi.fn(), moveLabel: "Move", sizeLabel: "Resize" });
  const children = tree.props.children as ReactElement<{ "data-action": string; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }>[];
  const button = children.find((c) => c.props["data-action"] === action)!;
  const cap = capture(); button.props.onPointerDown(down(cap));
  return { onBox, cap };
}

describe("bounded live grip reporting", () => {
  it.each(["cards", "gallery", "slide", "bubble"] as const)("%s updates on each move before release and reports its corner plus margin", (kind) => {
    const drag = start(kind);
    expect(reports[0][0].hit?.right).toBe(700 + GRIP_MARGIN);
    for (const step of [1, 2, 3]) {
      const x = 700 + step * 30, y = 570 + step * 20;
      pointer("pointermove", x, y);
      expect(box.w).toBe(400 + step * 30);
      expect(drag.onBox).toHaveBeenLastCalledWith(box, false);
      vi.advanceTimersByTime(16);
      expect(reports.at(-1)![0].hit).toEqual({ left: 300 - GRIP_MARGIN, top: 250 - GRIP_MARGIN, right: x + GRIP_MARGIN, bottom: y + GRIP_MARGIN });
    }
    pointer("pointerup");
    expect(drag.onBox).toHaveBeenLastCalledWith(box, true);
    expect(reports.at(-1)).toEqual([{ left: 300, top: 250, right: 790, bottom: 630 }]);
    expect(drag.cap.releasePointerCapture).toHaveBeenCalledWith(7);
  });
  it("coalesces reports within a frame, preserves every size update and never pads siblings", () => {
    const drag = start("gallery");
    for (let i = 1; i <= 20; i++) pointer("pointermove", 700 + i, 570 + i);
    expect(drag.onBox).toHaveBeenCalledTimes(20);
    expect(reports).toHaveLength(1);
    vi.advanceTimersByTime(16);
    expect(reports).toHaveLength(2);
    expect(reports[1][0].right).toBe(720);
    expect(itemHitRects([makeItem() as unknown as Element])[0].hit).toBeUndefined();
  });
  it.each(["pointerup", "pointercancel", "lostpointercapture", "blur", "unmount", "buttons"])("restores normal rectangles and cancels queued padding on %s", (end) => {
    const drag = start("cards", "move");
    pointer("pointermove", 740, 610);
    if (end === "unmount") h.cleanup.at(-1)?.();
    else if (end === "buttons") { drag.cap.hasPointerCapture = () => false; pointer("pointermove", 740, 610, 7, 0); }
    else pointer(end, 740, 610, 7, 1, end === "lostpointercapture" ? drag.cap : target);
    expect(reports.at(-1)![0].hit).toBeUndefined();
    const count = drag.onBox.mock.calls.length;
    vi.advanceTimersByTime(16); pointer("pointermove");
    expect(drag.onBox).toHaveBeenCalledTimes(count);
    expect(reports.at(-1)![0].hit).toBeUndefined();
  });
  it("ignores a different pointer's moves and release", () => {
    const drag = start("bubble");
    pointer("pointermove", 760, 630, 8); pointer("pointerup", 760, 630, 8);
    expect(drag.onBox).not.toHaveBeenCalled();
    expect(itemHitRects(elements())[0].hit).toBeDefined();
  });
  it("lets a resized bubble exceed its automatic max width", () => {
    const html = renderToStaticMarkup(<AnswerBubble mode="speaking" text="Answer" stopped={false} shown width={520} t={(k) => k} onClose={() => {}} />);
    expect(html).toContain('style="width:520px;max-width:calc(100vw - 16px)"');
  });
  it.each(["okf-model-grip", "okf-model-resize"])("%s updates native bounds and reports padding before release", (className) => {
    modelMove.mockImplementation((d: { dx: number; dy: number; dw?: number; dh?: number }) => {
      box = { x: box.x + d.dx, y: box.y + d.dy, w: box.w + (d.dw ?? 0), h: box.h + (d.dh ?? 0) };
    });
    const tree = Model();
    const find = (node: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>> | undefined => {
      if (!node?.props) return;
      if (node.props.className === className) return node;
      const children = node.props.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        const found = find(child as ReactElement<Record<string, unknown>>); if (found) return found;
      }
    };
    const begin = find(tree)!.props.onPointerDown as (event: unknown) => void;
    begin(down(capture()));
    expect(reports.at(-1)![0].hit).toBeDefined();
    pointer("pointermove", 740, 610);
    expect(modelMove).toHaveBeenLastCalledWith(className === "okf-model-resize" ? { dx: 0, dy: 0, dw: 40, dh: 40 } : { dx: 40, dy: 40 });
    vi.advanceTimersByTime(16);
    expect(reports).toHaveLength(2);
    pointer("pointercancel");
    expect(modelMove).toHaveBeenLastCalledWith({ dx: 0, dy: 0, done: true });
    expect(reports.at(-1)![0].hit).toBeUndefined();
  });
});

it.each([3, 5])("keeps the grip of a %i-tile gallery under a diagonal drag on every frame", (count) => {
  box = { x: 100, y: 100, w: 804, h: count === 3 ? 244 : 500 };
  const lastTile = () => tilesIn(count, box)[count - 1];
  item.getBoundingClientRect = lastTile;
  const first = lastTile();
  const x = first.right - 16, y = first.bottom - 16;
  const cap = capture();
  h.cleanup.push(watchHitRectChanges(() => reports.push(itemHitRects(elements()))));
  const tree = MoveGrips({ box, area: { x: 0, y: 0, width: 1920, height: 1080 }, lim: LIMITS.gallery,
    onBox: (next) => { box = next; }, onReset: vi.fn(), moveLabel: "Move", sizeLabel: "Resize" });
  tree.props.children[1].props.onPointerDown({ ...down(cap), clientX: x, clientY: y });
  for (let d = 10; d <= 300; d += 10) {
    pointer("pointermove", x + d, y + d);
    vi.advanceTimersByTime(16);
    const tile = lastTile();
    const report = reports.at(-1)![0];
    expect(report).toMatchObject(tile);
    expect(report.hit).toEqual({ left: tile.left - GRIP_MARGIN, top: tile.top - GRIP_MARGIN,
      right: tile.right + GRIP_MARGIN, bottom: tile.bottom + GRIP_MARGIN });
    // Equal columns can leave a couple of pixels of rounding at the outer edge.
    expect(Math.abs(tile.right - first.right - d)).toBeLessThanOrEqual(2);
    expect(Math.abs(tile.bottom - first.bottom - d)).toBeLessThanOrEqual(1);
  }
});

it("leaves room for media and controls in all six tiles when a gallery is dragged up to its minimum", () => {
  box = { x: 40, y: 40, w: 804, h: 500 };
  Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
  const photo = { kind: "photo" as const, src: "picture.png", caption: "Caption", source: "Source" };
  const show = { x: 0, y: 0, gallery: Array(6).fill(photo), slide: null };
  const layer = MediaLayer({ show, avoid: () => [], t: (k) => k,
    move: { moved: { gallery: box }, onBox: (_kind, next) => { box = next; }, onReset: vi.fn() } })!;
  const figures = layer.type(layer.props).props.children[1];
  const grip = figures[5].props.children[1];
  MoveGrips(grip.props).props.children[1].props.onPointerDown(down(capture()));
  pointer("pointermove", 700, 0);
  pointer("pointerup", 700, 0);
  expect(box.w).toBe(804);
  const tiles = tilesIn(6, box);
  expect(tiles).toHaveLength(6);
  for (const tile of tiles) {
    // Handle clearance, caption padding, button row, row gap and one source line.
    expect(tile.bottom - tile.top - (36 + 14 + 28 + 2 + 15)).toBeGreaterThanOrEqual(48);
  }
});

it.each([false, true])("resumes the 3D resize after a forwarded buttonless hover (lost capture: %s)", (lostCapture) => {
  const tree = Model();
  const children = tree.props.children as ReactElement<Record<string, unknown>>[];
  const grip = children.find((c) => c?.props?.className === "okf-model-resize")!;
  const cap = capture();
  const begin = grip.props.onPointerDown as (event: unknown) => void;
  begin(down(cap));
  if (lostCapture) {
    cap.hasPointerCapture = () => false;
    pointer("lostpointercapture", 380, 350, 7, 0, cap);
  }
  pointer("pointermove", 380, 350, 7, 0);
  expect(modelMove).not.toHaveBeenCalled();
  pointer("pointermove", 680, 550, 7, 1);
  expect(modelMove).toHaveBeenLastCalledWith({ dx: 0, dy: 0, dw: -20, dh: -20 });
  if (lostCapture) {
    // A fresh press reaches the window before the grip's React handler starts the next gesture.
    target.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerId: 7, button: 0, buttons: 1 }));
    expect(modelMove).toHaveBeenLastCalledWith({ dx: 0, dy: 0, done: true });
    begin(down(capture()));
    pointer("pointermove", 705, 575);
    expect(modelMove).toHaveBeenLastCalledWith({ dx: 0, dy: 0, dw: 5, dh: 5 });
  }
  pointer("pointerup", 680, 550, 7, 0);
  expect(reports.at(-1)![0].hit).toBeUndefined();
});

it("identifies only the laid-out bubble in a mixed media report", () => {
  const picture = makeItem() as unknown as Element;
  const bubble = item as unknown as Element;
  const [pictureRect, bubbleRect] = itemHitRects([picture, bubble], bubble);
  expect(pictureRect.bubble).toBeUndefined();
  expect(bubbleRect.bubble).toBe(true);
});
