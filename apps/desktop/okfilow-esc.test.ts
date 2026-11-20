import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { escTarget, TWICE_MS, overlayEscape } = createRequire(import.meta.url)("./okfilow-esc.js");
it("handles the first Escape keydown only in the focused overlay", () => {
  const close = vi.fn();
  const event = { preventDefault: vi.fn() };
  const input = { type: "keyDown", key: "Escape", isAutoRepeat: false };
  overlayEscape(false, event, input, close);
  overlayEscape(true, event, { ...input, type: "keyUp" }, close);
  overlayEscape(true, event, { ...input, isAutoRepeat: true }, close);
  expect(close).not.toHaveBeenCalled();
  overlayEscape(true, event, input, close);
  expect(close).toHaveBeenCalledTimes(1);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
it("leaves Escape out of both global input paths", () => {
  const main = fs.readFileSync(path.join(__dirname, "okfilow.js"), "utf8");
  expect(main).not.toMatch(/createEscKey|K\.Escape/);
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
