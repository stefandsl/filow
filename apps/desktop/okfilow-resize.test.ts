// Real main-process IPC handlers and mouse decisions, with no Electron or native input.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { cleanHitReport, cleanRects, createHitTarget, insideAny, localPoint } = require("./okfilow-hit.js");
const { overlayMouse, overlayLive } = require("./okfilow-stop.js");
const source = readFileSync(new URL("./okfilow.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const item = { left: 300, top: 250, right: 700, bottom: 570 };
const inflated = { ...item, hit: { left: 140, top: 90, right: 860, bottom: 730 } };
function section(start: string, end: string) {
  const at = source.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at) + end.length);
}
function setup() {
  const window = (id: number) => Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { id }), destroyed: false,
    isDestroyed() { return this.destroyed; },
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    setIgnoreMouseEvents: vi.fn(),
  });
  const overlay = window(1), second = window(2), model = window(3), panel = window(4);
  const ipcMain = new EventEmitter();
  let cursor = { x: 710, y: 580 };
  let allowed = true;
  const modelHit = createHitTarget({ setIgnore: model.setIgnoreMouseEvents });
  const context = {
    cleanHitReport, cleanRects, createHitTarget, insideAny, localPoint, overlayMouse, ipcMain, modelHit, modelWin: model,
    overlays: new Map([[1, overlay], [2, second]]), ourSender: () => allowed,
    mediaRects: new Map(), mediaOn: new Set(), stopHover: new Set(), mouseWas: new Map(), bubbleHover: new Set(),
    mouseCaught: false, mode: "idle", pill: {}, bubble: { open: () => false, setHover: vi.fn() }, QA_SHOTS: false,
    lastCursor: "", screen: { getCursorScreenPoint: () => cursor, getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    applyMouse: (_w: typeof overlay) => {}, mediaHit: (_w: typeof overlay, _p: unknown) => {},
    watchHitRects: (_w: typeof overlay, _hit?: unknown) => {},
  };
  runInNewContext([
    "let gripOwner = null;",
    ...["dropBubbleRects", "updateModelCursor", "applyGripReport", "applyMouse", "mediaHit", "dropHover", "watchHitRects"].map((name) => section(`  function ${name}(`, "\n  }")),
    section('  ipcMain.on("okfilow:overlay:rects"', "\n  });"),
    section('  ipcMain.on("okfilow:model:rects"', "\n  });"),
  ].join("\n"), context);
  context.watchHitRects(overlay); context.watchHitRects(model, modelHit);
  context.applyMouse(overlay);
  const send = (w: typeof overlay, rects: unknown, channel = w === model ? "model" : "overlay") => ipcMain.emit(`okfilow:${channel}:rects`, { sender: w.webContents }, rects);
  return { overlay, second, model, panel, modelHit, context, send, deny: () => { allowed = false; }, point: (p: typeof cursor) => { cursor = p; context.mediaHit(overlay, p); modelHit.at(p); } };
}

describe("bounded resize hit rectangles", () => {
  it.each(["overlay", "model"] as const)("%s stays interactive just beyond the old box, then restores click-through", (kind) => {
    const h = setup(), w = h[kind];
    h.send(w, [item]); expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    h.send(w, [inflated]); expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    h.point({ x: 900, y: 750 }); expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    h.point({ x: 710, y: 580 }); expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    h.send(w, [item]); expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    h.context.applyMouse(h.second); expect(h.second.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  });
  it("clamps forged padding on every edge and to display bounds, with only one padded item", () => {
    const huge = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
    expect(cleanRects([{ ...item, hit: huge }], { width: 1000, height: 800 })).toEqual([inflated.hit]);
    expect(cleanRects([{ left: 10, top: 10, right: 710, bottom: 590, hit: huge }], { width: 1000, height: 800 })).toEqual([{ left: 0, top: 0, right: 870, bottom: 750 }]);
    expect(cleanRects([inflated, inflated], { width: 1000, height: 800 })).toEqual([inflated.hit, item]);
    expect(cleanRects([{ ...item, hit: { ...huge, right: Infinity } }])).toEqual([item]);
  });
  it.each(["overlay", "model"] as const)("%s applies the clamp in its real IPC handler", (kind) => {
    const h = setup();
    h.send(h[kind], [{ ...item, hit: { left: -9999, top: -9999, right: 9999, bottom: 9999 } }]);
    h.point({ x: 861, y: 580 }); expect(h[kind].setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    h.point({ x: 859, y: 580 }); expect(h[kind].setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });
  it("keeps the captured 3D corner interactive outside native bounds, only within its display-clipped margin", () => {
    const h = setup();
    // Local model bounds are 1000 x 800; its corner can briefly precede native resizing.
    const corner = { left: 960, top: 760, right: 1000, bottom: 800 };
    const padded = { ...corner, hit: { left: 800, top: 600, right: 1160, bottom: 960 } };
    h.point({ x: 1050, y: 850 }); h.send(h.model, [padded]);
    expect(h.model.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    h.point({ x: 1161, y: 850 }); h.send(h.model, [padded]);
    expect(h.model.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    h.point({ x: 1050, y: 850 }); h.send(h.model, [corner]);
    expect(h.model.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    expect(cleanRects([padded], { left: -40, top: -20, width: 1100, height: 900 })).toEqual([{ left: 800, top: 600, right: 1060, bottom: 880 }]);
    const bounds = { x: -1000, y: 50, width: 1000, height: 800 };
    expect(localPoint({ x: 50, y: 900 }, bounds, true)).toEqual({ x: 1050, y: 850 });
    expect(localPoint({ x: 50, y: 900 }, bounds)).toBeNull();
  });
  it.each(["closed", "destroyed", "render-process-gone", "did-start-loading"])("forgets every renderer rectangle on %s", (event) => {
    const h = setup();
    h.send(h.overlay, [inflated]); h.send(h.model, [inflated]);
    for (const w of [h.overlay, h.model]) {
      if (event === "closed") w.destroyed = true;
      (event === "closed" ? w : w.webContents).emit(event);
    }
    expect(h.context.mediaRects.size).toBe(0); expect(h.context.mediaOn.size).toBe(0);
    expect(h.context.mouseWas.size).toBe(0);
    expect(h.modelHit.at({ x: 710, y: 580 })).toBe(false);
    if (event !== "closed") expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    if (event === "closed") {
      h.send(h.overlay, [inflated]); h.send(h.model, [inflated]);
      expect(h.context.mediaRects.size).toBe(0); expect(h.modelHit.takes()).toBe(false);
    }
  });
  it("accepts reports only from the owning overlay or model", () => {
    const h = setup();
    h.send(h.panel, [inflated]); h.send(h.overlay, [inflated], "model");
    expect(h.context.mediaRects.size).toBe(0); expect(h.modelHit.takes()).toBe(false);
    h.deny(); h.send(h.overlay, [inflated]); h.send(h.model, [inflated]);
    expect(h.context.mediaRects.size).toBe(0); expect(h.modelHit.takes()).toBe(false);
  });
  it("installs renderer cleanup on both window creation paths without a grip IPC", () => {
    expect(source).toContain("watchHitRects(win, modelHit);");
    expect(source).toContain("applyMouse(w);\n        watchHitRects(w);");
    expect(source).not.toContain('"okfilow:grip"');
  });
  it("preserves normal hit reports across hiding and showing the same renderer", () => {
    const h = setup();
    h.send(h.overlay, [item]); h.send(h.model, [item]);
    h.overlay.emit("hide"); h.model.emit("hide");
    h.overlay.emit("show"); h.model.emit("show");
    h.point({ x: 500, y: 400 });
    expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(h.model.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });
});

it("rejects oversized item bases before padding or clipping", () => {
  const display = { width: 1000, height: 800 };
  const limit = { left: 20, top: 10, right: 820, bottom: 650 };
  expect(cleanRects([limit], display)).toEqual([limit]);
  for (const oversized of [{ ...limit, right: 821 }, { ...limit, bottom: 651 }, { ...limit, left: -900 }]) {
    expect(cleanRects([oversized, { ...oversized, hit: inflated.hit }, item], display)).toEqual([item]);
  }
});

it("transfers the only padded grip across overlays and the model, preserving ordinary hits", () => {
  const h = setup();
  for (const [previous, next] of [[h.overlay, h.second], [h.second, h.model], [h.model, h.overlay]]) {
    h.send(previous, [inflated]);
    h.send(next, [inflated]);
    expect(previous.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    expect(next.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    h.point({ x: 500, y: 400 });
    h.context.mediaHit(previous, { x: 500, y: 400 });
    expect(previous.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    h.point({ x: 710, y: 580 });
  }
});

it("rechecks the current display edge after native translation without a new report", () => {
  const h = setup();
  const bounds = { x: 1000, y: 200, width: 400, height: 300 };
  h.model.getBounds = () => bounds;
  const tool = { left: 330, top: 8, right: 392, bottom: 42 };
  h.send(h.model, [{ ...tool, hit: { left: 170, top: -152, right: 552, bottom: 202 } }]);
  let tick = () => {};
  Object.assign(h.model, { isVisible: () => true });
  Object.assign(h.context, { modelCursorTimer: null, clearInterval: vi.fn(),
    setInterval: (callback: () => void) => { tick = callback; } });
  runInNewContext(section("  function watchModelCursor(", "\n  }") + "\nwatchModelCursor();", h.context);
  bounds.x = 1512;
  for (const [x, ignores] of [[1919, false], [1920, true], [1950, true]] as const) {
    h.context.screen.getCursorScreenPoint = () => ({ x, y: 240 });
    tick();
    expect(h.model.setIgnoreMouseEvents).toHaveBeenLastCalledWith(ignores);
  }
});

it.each(["overlay", "model"] as const)("drops the outgoing %s document's last report at navigation commit", (kind) => {
  const h = setup(), w = h[kind];
  h.send(w, [item]);
  w.webContents.emit("did-start-loading");
  h.send(w, [inflated]);
  expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  w.webContents.emit("did-navigate");
  expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  h.send(w, [inflated]);
  expect(w.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
});

it.each(["idle", "bubble grip", "picture grip"])("releases a dismissed bubble immediately and preserves adjacent media (%s)", (active) => {
  const h = setup();
  const dismiss = runInNewContext(
    section("  const bubble = createBubble(", "\n  });").replace("const bubble = ", ""),
    Object.assign(h.context, { createBubble: (options: unknown) => options, overlayLive,
      logLine: vi.fn(), sendOverlays: vi.fn(), answerMarks: { drop: vi.fn() }, scheduleFade: vi.fn() }),
  ).dismiss;
  h.context.bubble.open = () => true;
  h.point({ x: 500, y: 400 });
  h.context.stopHover.add(1);
  h.context.bubbleHover.add(1);
  const picture = { left: 10, top: 10, right: 250, bottom: 170 };
  const rects = [
    active === "picture grip" ? { ...picture, hit: { ...picture, right: 290 } } : picture,
    { ...(active === "bubble grip" ? inflated : item), bubble: true },
  ];
  h.send(h.overlay, rects);
  expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  h.context.bubble.open = () => false;
  dismiss("button");
  expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  h.send(h.model, [inflated]); // Transferring the picture's grip must also preserve the dismissal.
  expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  h.send(h.overlay, rects); // The old renderer can still have a poll in flight.
  expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  h.point({ x: 50, y: 50 });
  expect(h.overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
});
