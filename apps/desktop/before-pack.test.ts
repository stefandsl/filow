// The packaging guard: electron-builder must refuse a build whose resources are missing or stale.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { problems, requirements } = require("./before-pack.js") as { problems: (base?: string) => string[]; requirements: (base?: string) => { what: string; file: string; sources: string[]; stamp?: string }[] };

// Test files live in the project's own tmp folder (never on C:).
const base = path.resolve(__dirname, "../../tmp/test-before-pack");
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const write = (file: string, at: Date) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  fs.utimesSync(file, at, at);
};
const OLD = new Date("2026-01-01T10:00:00Z");
const NEW = new Date("2026-01-02T10:00:00Z");

/** A complete tree: every source written first, every build output after. */
function complete() {
  fs.rmSync(base, { recursive: true, force: true });
  for (const r of requirements(base)) {
    for (const s of r.sources) write(path.extname(s) ? s : path.join(s, "index.ts"), OLD);
    write(r.file, NEW);
    if (r.stamp) write(r.stamp, NEW);
  }
}

describe("before-pack guard", () => {
  beforeEach(complete);

  it("passes a complete, fresh build", () => {
    expect(problems(base)).toEqual([]);
  });

  it("names the session server bundle when it is missing, with the command that builds it", () => {
    fs.rmSync(path.join(base, "apps", "server", "dist", "bundle.js"));
    const found = problems(base);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/session server bundle is missing/);
    expect(found[0]).toMatch(/npm run build -w apps\/server/);
  });

  it("reports every missing output, not only the first", () => {
    fs.rmSync(path.join(base, "apps", "server", "dist", "bundle.js"));
    fs.rmSync(path.join(base, "apps", "web", "public", "powerpoint", "index.html"));
    expect(problems(base).map((p) => p.split(" is ")[0])).toEqual(["session server bundle", "PowerPoint task pane"]);
  });

  it("flags a bundle older than its sources", () => {
    write(path.join(base, "apps", "server", "src", "index.ts"), new Date("2026-01-03T10:00:00Z"));
    const found = problems(base);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/session server bundle is older than its sources/);
  });

  it("a newer test file or a file under node_modules does not make a bundle stale", () => {
    write(path.join(base, "apps", "server", "src", "index.test.ts"), new Date("2026-01-03T10:00:00Z"));
    write(path.join(base, "apps", "server", "src", "node_modules", "x", "index.js"), new Date("2026-01-03T10:00:00Z"));
    expect(problems(base)).toEqual([]);
  });

  it("a change in the shared core makes both the web app and the session server stale", () => {
    write(path.join(base, "packages", "core", "src", "engine.ts"), new Date("2026-01-03T10:00:00Z"));
    expect(problems(base).map((p) => p.split(" is ")[0])).toEqual(["web app (Next standalone server)", "session server bundle"]);
  });
});
