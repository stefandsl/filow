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

describe("dictation in toggle mode", () => {
  type GT = G & { reset(): void; escape(): void; endToggle(): void; active: string | null };
  const make = (events: string[], dictate = "ctrl+meta") =>
    createGestures({ talk: () => "ctrl+alt", dictate: () => dictate, dictateMode: () => "toggle", emit: (e) => events.push(e) } as never) as unknown as GT;
  const tap = (g: G, ...mods: string[]) => { for (const m of mods) g.keydown(m); for (const m of mods) g.keyup(m); };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("press and let go starts, the next press stops; holding the keys does nothing more", () => {
    const events: string[] = [];
    const g = make(events);
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(800);
    expect(events).toEqual([]);
    g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:start"]);
    expect(g.active).toBe("dictate");
    vi.advanceTimersByTime(5000);
    tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:start", "dictate:end"]);
    expect(g.active).toBeNull();
  });

  it("a Windows shortcut on the same keys (Ctrl+Win+D) and an added modifier never toggle", () => {
    const events: string[] = [];
    const g = make(events);
    g.keydown("ctrl"); g.keydown("meta"); g.keydown(null); g.keyup("meta"); g.keyup("ctrl");
    g.keydown("ctrl"); g.keydown("meta"); g.keydown("shift"); g.keyup("shift"); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual([]);
  });

  it("no hands-free double tap in toggle mode: two taps are start then stop", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta"); tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:start", "dictate:end"]);
  });

  it("Escape and a lock screen cancel; the talk chord is ignored while dictating", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta");
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(400); g.keyup("alt"); g.keyup("ctrl");
    g.escape();
    expect(events).toEqual(["dictate:start", "dictate:cancel"]);
    tap(g, "ctrl", "meta");
    g.reset();
    expect(events.slice(2)).toEqual(["dictate:start", "dictate:cancel"]);
    g.escape();
    expect(events).toHaveLength(4);
  });

  it("after the dictation ended elsewhere, the next press starts again", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta");
    g.endToggle();
    tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:start", "dictate:start"]);
  });

  it("the talk chord still works in toggle mode when no dictation runs", () => {
    const events: string[] = [];
    const g = make(events);
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(300); g.keyup("alt");
    expect(events).toEqual(["talk:start", "talk:end"]);
  });
});
