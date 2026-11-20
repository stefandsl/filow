import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { createEscapeObserver } = createRequire(import.meta.url)("./okfilow-esc.js");

it("observes a single Escape per press only during speech or an open bubble", () => {
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
