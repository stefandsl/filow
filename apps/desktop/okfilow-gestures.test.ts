import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type G = { keydown(m: string | null): void; keyup(m: string | null): void; mousedown(): void };
const { createGestures } = require("./okfilow-gestures.js") as {
  createGestures: (o: { talk: () => string; dictate: () => string | null; emit: (e: string) => void }) => G;
};

describe("OK Filow gestures", () => {
  let events: string[];
  let g: G;
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    g = createGestures({ talk: () => "ctrl+alt", dictate: () => "ctrl+meta", emit: (e) => events.push(e) });
  });
  afterEach(() => vi.useRealTimers());

  it("talk starts only after the chord is held, and ends on release", () => {
    g.keydown("ctrl"); g.keydown("alt");
    vi.advanceTimersByTime(100);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(events).toEqual(["talk:start"]);
    g.keyup("alt");
    expect(events).toEqual(["talk:start", "talk:end"]);
  });

  it("another key cancels talk (AltGr, shortcuts) and nothing fires until all modifiers are up", () => {
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(300);
    g.keydown(null);
    expect(events).toEqual(["talk:start", "talk:cancel"]);
    g.keyup("alt"); g.keydown("alt"); vi.advanceTimersByTime(300);
    expect(events).toEqual(["talk:start", "talk:cancel"]);
    g.keyup("alt"); g.keyup("ctrl");
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(300);
    expect(events.at(-1)).toBe("talk:start");
  });

  it("a quick AltGr shortcut never starts talking", () => {
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(80); g.keydown(null); g.keyup("alt"); g.keyup("ctrl");
    vi.advanceTimersByTime(500);
    expect(events).toEqual([]);
  });

  it("hold Ctrl+Win dictates", () => {
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(300);
    g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:start", "dictate:end"]);
  });

  it("tapping Ctrl+Win twice toggles hands-free", () => {
    const tap = () => { g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(60); g.keyup("meta"); g.keyup("ctrl"); vi.advanceTimersByTime(60); };
    tap(); tap();
    expect(events).toEqual(["handsfree:toggle"]);
  });

  it("tapping Ctrl alone twice opens the text box, but not with a key or click in between", () => {
    const tap = () => { g.keydown("ctrl"); vi.advanceTimersByTime(50); g.keyup("ctrl"); vi.advanceTimersByTime(80); };
    tap(); tap();
    expect(events).toEqual(["text:open"]);
    events.length = 0;
    tap(); g.keydown("ctrl"); g.keydown(null); g.keyup("ctrl");
    expect(events).toEqual([]);
    vi.advanceTimersByTime(600);
    tap(); g.mousedown(); tap();
    expect(events).toEqual([]);
  });

  it("Ctrl+C held long is not a tap", () => {
    g.keydown("ctrl"); vi.advanceTimersByTime(400); g.keyup("ctrl");
    g.keydown("ctrl"); vi.advanceTimersByTime(50); g.keyup("ctrl");
    expect(events).toEqual([]);
  });

  it("dictation is off when the talk chord is Ctrl+Win", () => {
    const e: string[] = [];
    const h = createGestures({ talk: () => "ctrl+meta", dictate: () => null, emit: (x) => e.push(x) });
    h.keydown("ctrl"); h.keydown("meta"); vi.advanceTimersByTime(300);
    expect(e).toEqual(["talk:start"]);
  });
});

it("after a reset (lock screen) a modifier whose key-up was lost is no longer down", () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const g = createGestures({ talk: () => "ctrl+alt", dictate: () => "ctrl+meta", emit: (e) => events.push(e) }) as G & { reset(): void };
  g.keydown("alt"); // its key-up happens on the secure desktop and never arrives
  g.reset();
  g.keydown("ctrl"); // Ctrl alone (Ctrl+click) must not look like Ctrl+Alt
  vi.advanceTimersByTime(400);
  expect(events).toEqual([]);
  vi.useRealTimers();
});
