import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X-14: no computer-use driver ships in the default download until it passes its trial.
describe("computer-use pilot packaging", () => {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const shipped: string[] = [...pkg.build.files, ...(pkg.build.asarUnpack || [])];

  it("leaves the driver, gate, loop, planner and native helper out of the packaged app", () => {
    for (const f of ["agent-desktop-driver.js", "agent-desktop-asset.js", "action-driver.js", "action-gate.js", "action-loop.js", "gemini-cu-planner.js"]) {
      expect(shipped).not.toContain(f);
    }
    expect(shipped.filter((f) => f.startsWith("native/action/"))).toEqual([]);
  });

  it("loads the pilot modules only when computer use starts", () => {
    const src = readFileSync(new URL("./okfilow.js", import.meta.url), "utf8");
    const topLevel = src.split("function getAsset")[0];
    expect(topLevel).not.toMatch(/require\("\.\/(action-driver|action-gate|action-loop|gemini-cu-planner|agent-desktop-driver|agent-desktop-asset)"\)/);
    expect(src).toMatch(/reason: "unavailable"/);
  });
});
