import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { createEscapeObserver, escTarget, TWICE_MS } = createRequire(import.meta.url)("./okfilow-esc.js");

it("observes a single Escape per press without consuming it during speech or an open bubble", () => {
  const input = new EventEmitter();
  const press = vi.fn();
  const sync = createEscapeObserver(press);
  const esc = 1;
  sync(input, esc, "idle", false);
  expect(input.listenerCount("keydown")).toBe(0);
  expect(input.listenerCount("keyup")).toBe(0);
  for (const [mode, open] of [["speaking", false], ["idle", true]] as const) {
    sync(input, esc, mode, open);
    sync(input, esc, mode, open);
    expect(input.listenerCount("keydown")).toBe(1);
    const event = Object.freeze({ keycode: esc });
    input.emit("keydown", { keycode: 42 });
    input.emit("keydown", event);
    input.emit("keydown", event);
    expect(press).toHaveBeenCalledTimes(1);
    input.emit("keyup", event);
    input.emit("keydown", event);
    expect(press).toHaveBeenCalledTimes(2);
    sync(input, esc, "idle", false);
    expect(input.listenerCount("keydown")).toBe(0);
    expect(input.listenerCount("keyup")).toBe(0);
    input.emit("keydown", event);
    expect(press).toHaveBeenCalledTimes(2);
    press.mockClear();
  }
});

it.each([
  ["thinking", {}],
  ["listening", {}],
  ["opening", { dictating: true }],
  ["idle", { model: true }],
  ["idle", { items: true }],
] as const)("observes Escape while %s with %o and releases both listeners on idle", (mode, surfaces) => {
  const input = new EventEmitter();
  const press = vi.fn();
  const sync = createEscapeObserver(press);
  sync(input, 1, mode, false, surfaces);
  input.emit("keydown", { keycode: 1 });
  expect(press).toHaveBeenCalledOnce();
  sync(input, 1, "idle", false, {});
  expect(input.listenerCount("keydown") + input.listenerCount("keyup")).toBe(0);
});

describe("what one press closes", () => {
  it("the topmost thing: the 3D window, then the pictures and cards, then the bubble; nothing when nothing is shown", () => {
    expect(escTarget({ model: true, items: true, bubble: true, now: 10_000 })).toBe("model");
    expect(escTarget({ items: true, bubble: true, now: 10_000 })).toBe("items");
    expect(escTarget({ bubble: true, now: 10_000 })).toBe("bubble");
    expect(escTarget({ now: 10_000 })).toBeNull();
  });
  it("a second press soon after closes everything", () => {
    expect(escTarget({ items: true, bubble: true, lastAt: 10_000, now: 10_000 + TWICE_MS - 1 })).toBe("all");
    expect(escTarget({ items: true, bubble: true, lastAt: 10_000, now: 10_000 + TWICE_MS + 1 })).toBe("items");
  });
});
