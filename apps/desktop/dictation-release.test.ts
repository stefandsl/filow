import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Tail = { release(payload: unknown, tailMs: number): void; flush(): void; readonly waiting: boolean };
const { createReleaseTail, RELEASE_TAIL_MS } = require("./dictation-release.js") as {
  createReleaseTail: (o: { send: (p: unknown) => void }) => Tail;
  RELEASE_TAIL_MS: number;
};
const here = path.dirname(fileURLToPath(import.meta.url));

// Issue #7: the panel's microphone hands over sound in 128 ms blocks and stopped the moment it heard of
// the release, so the end of what was said as the keys went up was lost (a 1 s press of "Ciao Marco"
// came out "Chao, Matt.", presses under 0.8 s typed nothing).
describe("a held dictation keeps recording a moment after the keys go up (issue #7)", () => {
  let sent: unknown[];
  let tail: Tail;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    tail = createReleaseTail({ send: (p) => sent.push(p) });
  });
  afterEach(() => vi.useRealTimers());

  it("the tail covers at least one whole microphone block (128 ms) and stays short", () => {
    expect(RELEASE_TAIL_MS).toBeGreaterThanOrEqual(250);
    expect(RELEASE_TAIL_MS).toBeLessThanOrEqual(400);
  });

  it("the panel is told to stop only when the tail is over", () => {
    tail.release({ purpose: "dictate" }, RELEASE_TAIL_MS);
    expect(sent).toEqual([]);
    expect(tail.waiting).toBe(true);
    vi.advanceTimersByTime(RELEASE_TAIL_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ purpose: "dictate" }]);
    expect(tail.waiting).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it("with no tail (hands-free, a question) the panel is told at once", () => {
    tail.release({ purpose: "talk" }, 0);
    expect(sent).toEqual([{ purpose: "talk" }]);
    expect(tail.waiting).toBe(false);
  });

  it("a press during the tail sends the waiting release first, once", () => {
    tail.release({ purpose: "dictate" }, RELEASE_TAIL_MS);
    vi.advanceTimersByTime(100);
    tail.flush(); // okfilow.js press(): before the panel hears the new press
    expect(sent).toEqual([{ purpose: "dictate" }]);
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(sent).toHaveLength(1);
    tail.flush();
    expect(sent).toHaveLength(1);
  });

  it("a second release while one waits keeps their order", () => {
    tail.release({ n: 1 }, RELEASE_TAIL_MS);
    tail.release({ n: 2 }, 0);
    expect(sent).toEqual([{ n: 1 }, { n: 2 }]);
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(sent).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe("okfilow.js gives the tail to held dictations only", () => {
  const src = fs.readFileSync(path.join(here, "okfilow.js"), "utf8");
  it("a hold gets the tail; a hands-free dictation or a question stops at once", () => {
    expect(src).toContain('const tail = purpose === "dictate" && !phraseRun ? RELEASE_TAIL_MS : 0;');
    expect(src).toContain("releaseTail.release({ purpose }, tail);");
    // The panel is never told of a release any other way.
    expect(src.match(/sendPanel\("okfilow:release"/g)?.length).toBe(1);
  });
  it("a new press sends the waiting release first", () => {
    expect(src).toMatch(/function press\(kind = "talk", handsFree = false\) \{\s*(\/\/[^\n]*\n\s*)*releaseTail\.flush\(\);/);
  });
});
