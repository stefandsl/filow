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

  const tapChord = (a: string, b: string, gap = 60) => { g.keydown(a); g.keydown(b); vi.advanceTimersByTime(60); g.keyup(b); g.keyup(a); vi.advanceTimersByTime(gap); };

  it("tapping Ctrl+Win twice starts hands-free dictation (issue #2), not OK Filow's questions", () => {
    tapChord("ctrl", "meta"); tapChord("ctrl", "meta");
    expect(events).toEqual(["dictate:handsfree"]);
    expect((g as G & { active: string | null }).active).toBe("dictate");
  });

  it("hands-free dictation runs with the keys up, and one more press of the keys ends it", () => {
    tapChord("ctrl", "meta"); tapChord("ctrl", "meta");
    vi.advanceTimersByTime(20_000);
    expect(events).toEqual(["dictate:handsfree"]);
    // However long that press is held: it is a press, not a new hold-to-talk.
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(700); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:handsfree", "dictate:end"]);
    expect((g as G & { active: string | null }).active).toBeNull();
    // And hold-to-talk works again right after.
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(300); g.keyup("meta"); g.keyup("ctrl");
    expect(events.slice(2)).toEqual(["dictate:start", "dictate:end"]);
  });

  it("Escape ends hands-free dictation; the talk keys do nothing while it runs", () => {
    tapChord("ctrl", "meta"); tapChord("ctrl", "meta");
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(400); g.keyup("alt"); g.keyup("ctrl");
    (g as G & { escape(): void }).escape();
    expect(events).toEqual(["dictate:handsfree", "dictate:cancel"]);
  });

  it("two slow taps, a tap with another key, or a tap then a hold are not a double tap", () => {
    tapChord("ctrl", "meta", 600); tapChord("ctrl", "meta", 600);
    expect(events).toEqual([]);
    tapChord("ctrl", "meta");
    g.keydown("ctrl"); g.keydown("meta"); g.keydown(null); g.keyup("meta"); g.keyup("ctrl"); // Ctrl+Win+D
    expect(events).toEqual([]);
    vi.advanceTimersByTime(600);
    // An added modifier (Ctrl+Win+Shift) is another shortcut, not a tap.
    tapChord("ctrl", "meta");
    g.keydown("ctrl"); g.keydown("meta"); g.keydown("shift"); g.keyup("shift"); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual([]);
    vi.advanceTimersByTime(600);
    tapChord("ctrl", "meta");
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(900); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:start", "dictate:end"]);
  });

  // Issue #7: the owner's presses of Ctrl+Win were 0.45 to 0.85 s long (the log shows dictate:start and,
  // 0.2 to 0.6 s later, dictate:end), far longer than the 0.25 s a tap was allowed, so two of them never
  // started hands-free dictation.
  const press = (ms: number, gap: number) => { g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(ms); g.keyup("meta"); g.keyup("ctrl"); vi.advanceTimersByTime(gap); };

  it("two brief presses as real fingers make them (half a second each) start hands-free dictation", () => {
    press(500, 400);
    expect(events).toEqual(["dictate:start", "dictate:end"]);
    press(550, 0);
    // The second press had started a dictation: it goes on with the keys up instead of ending.
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:start", "dictate:handsfree"]);
    expect((g as G & { active: string | null }).active).toBe("dictate");
    vi.advanceTimersByTime(10_000);
    press(500, 0);
    expect(events.slice(4)).toEqual(["dictate:end"]);
  });

  it("a brief press then a quick tap, or a quick tap then a brief press, also start it", () => {
    press(450, 300); tapChord("ctrl", "meta");
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:handsfree"]);
    (g as G & { escape(): void }).escape();
    vi.advanceTimersByTime(2000);
    events.length = 0;
    tapChord("ctrl", "meta", 300); press(600, 0);
    expect(events).toEqual(["dictate:start", "dictate:handsfree"]);
  });

  it("a brief press then a real hold, or a second press that comes late, stay two dictations", () => {
    press(500, 300); press(1500, 0);
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:start", "dictate:end"]);
    vi.advanceTimersByTime(2000);
    events.length = 0;
    press(500, 700); press(500, 0);
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:start", "dictate:end"]);
  });

  it("a brief press and then a Windows shortcut on the same keys is not hands-free", () => {
    press(500, 200);
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(300); g.keydown(null); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:start", "dictate:cancel"]);
    // An added modifier ends the hold as a hold, never as the second press of a pair.
    vi.advanceTimersByTime(2000);
    events.length = 0;
    press(500, 200);
    g.keydown("ctrl"); g.keydown("meta"); vi.advanceTimersByTime(300); g.keydown("shift"); g.keyup("shift"); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual(["dictate:start", "dictate:end", "dictate:start", "dictate:end"]);
  });

  it("the talk keys keep their own rule: two brief holds are two questions", () => {
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(500); g.keyup("alt"); g.keyup("ctrl"); vi.advanceTimersByTime(300);
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(500); g.keyup("alt"); g.keyup("ctrl");
    expect(events).toEqual(["talk:start", "talk:end", "talk:start", "talk:end"]);
  });

  it("OK Filow's hands-free questions are on its own keys: tapping the talk keys twice", () => {
    tapChord("ctrl", "alt"); tapChord("ctrl", "alt");
    expect(events).toEqual(["handsfree:toggle"]);
    vi.advanceTimersByTime(600);
    // One tap of each chord is not a double tap of either.
    tapChord("ctrl", "alt"); tapChord("ctrl", "meta");
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
    expect(events).toEqual(["dictate:handsfree"]);
    expect(g.active).toBe("dictate");
    vi.advanceTimersByTime(5000);
    tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:handsfree", "dictate:end"]);
    expect(g.active).toBeNull();
  });

  it("a Windows shortcut on the same keys (Ctrl+Win+D) and an added modifier never toggle", () => {
    const events: string[] = [];
    const g = make(events);
    g.keydown("ctrl"); g.keydown("meta"); g.keydown(null); g.keyup("meta"); g.keyup("ctrl");
    g.keydown("ctrl"); g.keydown("meta"); g.keydown("shift"); g.keyup("shift"); g.keyup("meta"); g.keyup("ctrl");
    expect(events).toEqual([]);
  });

  it("in toggle mode one press starts hands-free dictation; two taps are start then stop", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta"); tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:handsfree", "dictate:end"]);
  });

  it("Escape and a lock screen cancel; the talk chord is ignored while dictating", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta");
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(400); g.keyup("alt"); g.keyup("ctrl");
    g.escape();
    expect(events).toEqual(["dictate:handsfree", "dictate:cancel"]);
    tap(g, "ctrl", "meta");
    g.reset();
    expect(events.slice(2)).toEqual(["dictate:handsfree", "dictate:cancel"]);
    g.escape();
    expect(events).toHaveLength(4);
  });

  it("after the dictation ended elsewhere, the next press starts again", () => {
    const events: string[] = [];
    const g = make(events);
    tap(g, "ctrl", "meta");
    g.endToggle();
    tap(g, "ctrl", "meta");
    expect(events).toEqual(["dictate:handsfree", "dictate:handsfree"]);
  });

  it("the talk chord still works in toggle mode when no dictation runs", () => {
    const events: string[] = [];
    const g = make(events);
    g.keydown("ctrl"); g.keydown("alt"); vi.advanceTimersByTime(300); g.keyup("alt");
    expect(events).toEqual(["talk:start", "talk:end"]);
  });
});
