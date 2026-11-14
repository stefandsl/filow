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
  it("include every local module the app requires", () => {
    const missing = [...required].filter((m) => !files.includes(m));
    expect(missing).toEqual([]);
  });
});
