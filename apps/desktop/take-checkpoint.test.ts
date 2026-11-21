import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { CommittedPlace } from "@filow/core";

const require = createRequire(import.meta.url);
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
function open() {
  return require("./take-checkpoint.js").createTakeCheckpoint(dir);
}
const key = "script with two equal labels";
const place: Omit<CommittedPlace, "scriptKey"> = {
  sectionId: "s1", here: "s1b1", points: {
    s0b0: { status: "missed", confidence: 0 },
    s1b0: { status: "waiting", reopened: true, confidence: 0 },
    s0b1: { status: "started", confidence: 1, evidence: { source: "manual", fromMs: 42, toMs: 42 } },
  },
};
describe("desktop take checkpoint", () => {
  it("restores only committed fields and rejects stale writes across loads and restarts", () => {
    dir = mkdtempSync(join(tmpdir(), "filow-place-"));
    const store = open();
    const first = store.begin(key);
    expect(first.place).toBeNull();
    expect(store.save(first.writer, 5, { ...place, transcriptTail: "private-tail", token: "private-token" })).toBe(true);
    expect(store.save(first.writer, 4, { sectionId: "s0", points: {} })).toBe(false);
    const resumed = open();
    const second = resumed.begin(key);
    expect(second.place).toEqual(place);
    expect(resumed.save(first.writer, 9, place)).toBe(false);
    const changed = resumed.begin(key + " edited");
    expect(changed.place).toBeNull();
    expect(resumed.save(second.writer, 11, place)).toBe(false);
    const bytes = readFileSync(join(dir, "take-place.json"), "utf8");
    for (const privateText of [key, "private-tail", "private-token", first.writer]) expect(bytes).not.toContain(privateText);
    expect(resumed.save(changed.writer, 1, { sectionId: "s0", points: {} })).toBe(true);
    expect(open().begin(key).place).toBeNull();
  });
  it("reads the last complete replacement after interruption and treats a damaged file as empty", () => {
    dir = mkdtempSync(join(tmpdir(), "filow-place-"));
    writeFileSync(join(dir, "settings.json"), "{}");
    const store = open();
    const { writer } = store.begin(key);
    expect(store.save(writer, 1, place)).toBe(true);
    writeFileSync(join(dir, "take-place.json.tmp"), "{");
    expect(open().begin(key).place).toEqual(place);
    writeFileSync(join(dir, "take-place.json"), "{");
    expect(open().begin(key).place).toBeNull();
    expect(existsSync(join(dir, "settings.json"))).toBe(true);
  });
});
