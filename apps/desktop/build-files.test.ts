import { pilotOnly } from "./cu-packaging-fixture";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every local module the desktop app requires must be in the packaged file list,
// or the installed app crashes at start ("Cannot find module").
const dir = __dirname;
const files: string[] = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).build.files;

const required = new Set<string>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".js") || f.includes(".test.")) continue;
  for (const m of readFileSync(join(dir, f), "utf8").matchAll(/require\(["']\.\/([\w.-]+)["']\)/g)) {
    required.add(m[1].endsWith(".js") || m[1].endsWith(".json") ? m[1] : `${m[1]}.js`);
  }
}

describe("packaged files", () => {
  it.each(["wake-augmentation.js", "wake-enrolment.js"])("P1: includes the required wake module %s", (module) => {
    expect(required.has(module)).toBe(true);
    expect(files).toContain(module);
  });
  it("include every local module the app requires", () => {
    // X-14 pilot modules stay out of the download until their trial passes; okfilow.js loads them
    // lazily and answers "unavailable" without them (cu-packaging.test.ts, R406).
    const missing = [...required].filter((m) => !files.includes(m) && !pilotOnly.includes(m));
    expect(missing).toEqual([]);
  });
});
