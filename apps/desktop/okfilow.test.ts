import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { hotkeyHeld, HOTKEYS } = require("./okfilow.js") as { hotkeyHeld: (h: string, d: Record<string, boolean>) => boolean; HOTKEYS: string[] };

it("triggers only on exactly the hotkey's modifiers", () => {
  expect(hotkeyHeld("ctrl+alt", { ctrl: true, alt: true })).toBe(true);
  expect(hotkeyHeld("ctrl+alt", { ctrl: true })).toBe(false);
  expect(hotkeyHeld("ctrl+alt", { ctrl: true, alt: true, shift: true })).toBe(false);
  expect(hotkeyHeld("alt+shift", { alt: true, shift: true })).toBe(true);
  expect(HOTKEYS).toContain("ctrl+alt");
});
