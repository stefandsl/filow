import { expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);

it("accepts an unpacked package and a fresh profile on caller-selected volumes", () => {
  const { replayPaths } = require("./packaged-replay.cjs");
  const args = ["E:/QA/win-unpacked/Filow.exe", "models", "clips", "F:/fresh-profile"];
  expect(replayPaths(args)).toEqual(args.map(p => path.resolve(p)));
  expect(() => replayPaths(args.slice(0, 3))).toThrow();
  expect(() => replayPaths([...args.slice(0, 3), "."])).toThrow();
});
