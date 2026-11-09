import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isQaBuild } = require("./qa.js") as { isQaBuild: (app: { isPackaged: boolean } | null, pkg: () => Record<string, unknown>) => boolean };

it("allows test switches in development and in packages built as QA builds only", () => {
  expect(isQaBuild({ isPackaged: false }, () => ({}))).toBe(true);
  expect(isQaBuild({ isPackaged: true }, () => ({ filowQa: true }))).toBe(true);
  expect(isQaBuild({ isPackaged: true }, () => ({}))).toBe(false);
  expect(isQaBuild({ isPackaged: true }, () => ({ filowQa: "true" }))).toBe(false);
  expect(isQaBuild({ isPackaged: true }, () => { throw new Error("no package.json"); })).toBe(false);
});
