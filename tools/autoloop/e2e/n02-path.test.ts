import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("refuses the current checkout as a replay fixture directory", () => {
  const root = path.resolve(__dirname, "../../..");
  const fixture = path.join(__dirname, "n02-fixtures.mjs");
  const result = spawnSync(process.execPath, [fixture, "prepare", root], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Use a directory outside the checkout");
});
