import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { cleanSelection, readSelection } = require("./okfilow-selection.js");

it("cleans selected text: trims, joins CRLF, caps the length, and treats whitespace as nothing", () => {
  expect(cleanSelection("  hello \r\nworld  ")).toBe("hello\nworld");
  expect(cleanSelection(" \r\n\t ")).toBe("");
  expect(cleanSelection("x".repeat(30), 10)).toBe("xxxxxxxxxx…");
});

it("never throws and resolves a string even when nothing is focused", async () => {
  expect(typeof (await readSelection(5000))).toBe("string");
}, 10_000);
