// C10: a failed read of the memory file must not make remove()/learn() destroy the facts already kept.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createMemory } = require("./okfilow-memory.js");
type Fact = { id: string; kind: string; text: string };

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seeded() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c10-"));
  dirs.push(dir);
  const m = createMemory(dir);
  const kept = m.learn(true, "I teach physics and I prefer answers as lists", [
    { kind: "me", text: "The user teaches physics" },
    { kind: "answer", text: "Answers as lists" },
  ]) as Fact[];
  expect(kept).toHaveLength(2);
  return { m, kept };
}

// One transient Windows sharing violation on the next read of the memory file (antivirus / indexer).
function failNextReadOf(file: string) {
  const real = fs.readFileSync;
  let failed = false;
  vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (!failed && p === file) {
      failed = true;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${file}'`), { code: "EBUSY" });
    }
    return (real as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof fs.readFileSync);
}

describe("memory file read fails transiently", () => {
  it("remove(id) does not delete the other facts", () => {
    const { m, kept } = seeded();
    failNextReadOf(m.file);
    try { m.remove(kept[0].id); } catch { /* failing loudly is acceptable */ }
    vi.restoreAllMocks();
    expect(fs.existsSync(m.file)).toBe(true);
    expect((m.list() as Fact[]).map((f) => f.text)).toContain("Answers as lists");
  });

  it("learn() does not overwrite the facts already kept", () => {
    const { m } = seeded();
    failNextReadOf(m.file);
    try { m.learn(true, "I live in Rome", [{ kind: "me", text: "The user lives in Rome" }]); } catch { /* failing is acceptable */ }
    vi.restoreAllMocks();
    const texts = (m.list() as Fact[]).map((f) => f.text);
    expect(texts).toContain("The user teaches physics");
    expect(texts).toContain("Answers as lists");
  });
});
