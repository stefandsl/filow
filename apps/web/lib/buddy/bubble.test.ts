// The answer bubble's rules (docs/okfilow/BUBBLE.md): where it sits, when it holds still, how it
// follows the voice, and the sentences it is made of.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsChunk, OkFilowTtsReply } from "./bridge";
import { BUBBLE_EDGE, BUBBLE_REACH, bubbleOnScreen, bubblePlacement, bubbleSticks, followScroll, overBubble } from "./motion";
import { sentenceParts, splitSentences } from "./turn";
import { createSpeaker, type ChunkPlayer } from "./voice";

const VIEWS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1360x768 (a second screen)", width: 1360, height: 768 },
  { name: "1536x864 (1920x1080 at 125 %)", width: 1536, height: 864 },
  { name: "1280x720 (1920x1080 at 150 %)", width: 1280, height: 720 },
];
/** A tall answer bubble: 380 wide, half the screen high plus its padding. */
const tall = (v: { height: number }) => ({ width: 380, height: Math.round(v.height / 2) + 20 });
const inside = (at: { x: number; y: number }, size: { width: number; height: number }, v: { width: number; height: number }) =>
  at.x >= BUBBLE_EDGE && at.y >= BUBBLE_EDGE && at.x + size.width <= v.width - BUBBLE_EDGE && at.y + size.height <= v.height - BUBBLE_EDGE;
const overlaps = (at: { x: number; y: number }, size: { width: number; height: number }, r: { left: number; top: number; right: number; bottom: number }) =>
  at.x < r.right && at.x + size.width > r.left && at.y < r.bottom && at.y + size.height > r.top;

describe("where the bubble sits", () => {
  it("keeps eight pixels from every edge", () => {
    expect(BUBBLE_EDGE).toBe(8);
    expect(BUBBLE_REACH).toBe(96);
  });
  it("lower right of the dot when there is room", () => {
    expect(bubblePlacement({ x: 100, y: 100 }, { width: 200, height: 80 }, { width: 1920, height: 1080 })).toEqual({ x: 130, y: 118 });
  });
  for (const v of VIEWS) {
    it(`is wholly on screen near every edge and in every corner, small or tall: ${v.name}`, () => {
      const xs = [0, 4, 60, v.width / 2, v.width - 60, v.width - 4, v.width];
      const ys = [0, 4, 60, v.height / 2, v.height - 60, v.height - 4, v.height];
      for (const size of [{ width: 149, height: 40 }, { width: 380, height: 157 }, tall(v)]) {
        for (const x of xs) for (const y of ys) {
          const at = bubblePlacement({ x, y }, size, v);
          expect(inside(at, size, v), `dot ${x},${y} size ${size.width}x${size.height} -> ${at.x},${at.y}`).toBe(true);
        }
      }
    });
  }
  it("flips to the left of the dot at the right edge, and above it at the bottom edge", () => {
    const v = { width: 1920, height: 1080 };
    const size = { width: 380, height: 157 };
    const right = bubblePlacement({ x: 1900, y: 400 }, size, v);
    expect(right.x + size.width).toBeLessThanOrEqual(1900 - 18);
    expect(right.y).toBe(418);
    const bottom = bubblePlacement({ x: 400, y: 1060 }, size, v);
    expect(bottom.y + size.height).toBeLessThanOrEqual(1060 - 18);
    expect(bottom.x).toBe(430);
    const corner = bubblePlacement({ x: 1900, y: 1060 }, size, v);
    expect(corner).toEqual({ x: 1900 - 18 - 380, y: 1060 - 18 - 157 });
  });
  it("never lies over the pill: a bubble that would goes below it", () => {
    for (const v of VIEWS) {
      const pill = { left: v.width / 2 - 170, top: 10, right: v.width / 2 + 170, bottom: 42 };
      const size = tall(v);
      // the pointer low on the screen, under the pill: the tall bubble flips up and would reach the top
      for (const x of [v.width / 2 - 300, v.width / 2 - 100, v.width / 2, v.width / 2 + 100]) {
        for (const y of [60, v.height / 2 - 20, v.height / 2 + 30, v.height - 100]) {
          const at = bubblePlacement({ x, y }, size, v, 18, pill);
          expect(overlaps(at, size, { left: pill.left - BUBBLE_EDGE + 1, top: pill.top, right: pill.right + BUBBLE_EDGE - 1, bottom: pill.bottom + BUBBLE_EDGE - 1 }), `${v.name} dot ${x},${y} -> ${at.x},${at.y}`).toBe(false);
          expect(inside(at, size, v), `${v.name} dot ${x},${y}`).toBe(true);
        }
      }
      // without the pill the same bubble does reach the top there: the rule is what moves it
      const free = bubblePlacement({ x: v.width / 2, y: v.height / 2 + 30 }, size, v);
      expect(free.y).toBe(BUBBLE_EDGE);
      expect(bubblePlacement({ x: v.width / 2, y: v.height / 2 + 30 }, size, v, 18, pill).y).toBe(pill.bottom + BUBBLE_EDGE);
    }
  });
  it("a bubble away from the pill is left where it is", () => {
    const v = { width: 1920, height: 1080 };
    const pill = { left: 790, top: 10, right: 1130, bottom: 42 };
    expect(bubblePlacement({ x: 100, y: 100 }, { width: 200, height: 80 }, v, 18, pill)).toEqual({ x: 130, y: 118 });
    expect(bubblePlacement({ x: 900, y: 300 }, { width: 200, height: 80 }, v, 18, pill)).toEqual({ x: 930, y: 318 });
  });
  it("a bubble that holds still is kept on screen as its text grows", () => {
    const v = { width: 1360, height: 768 };
    expect(bubbleOnScreen({ x: 900, y: 500 }, { width: 380, height: 100 }, v)).toEqual({ x: 900, y: 500 });
    expect(bubbleOnScreen({ x: 900, y: 500 }, { width: 380, height: 400 }, v)).toEqual({ x: 900, y: 768 - BUBBLE_EDGE - 400 });
    expect(bubbleOnScreen({ x: 1200, y: -40 }, { width: 380, height: 100 }, v)).toEqual({ x: 1360 - BUBBLE_EDGE - 380, y: BUBBLE_EDGE });
  });
});

describe("the bubble holds still for the pointer", () => {
  const rect = { left: 500, top: 300, right: 880, bottom: 500 };
  it("while the pointer is on it or near it; a pointer that goes further takes it along", () => {
    expect(bubbleSticks({ x: 600, y: 400 }, rect)).toBe(true);
    // where it sits right after it was put next to the pointer (46 px up and to the left of its corner)
    expect(bubbleSticks({ x: 470, y: 282 }, rect)).toBe(true);
    expect(bubbleSticks({ x: 500 - BUBBLE_REACH, y: 400 }, rect)).toBe(true);
    expect(bubbleSticks({ x: 500 - BUBBLE_REACH - 1, y: 400 }, rect)).toBe(false);
    expect(bubbleSticks({ x: 880 + BUBBLE_REACH + 1, y: 400 }, rect)).toBe(false);
    expect(bubbleSticks({ x: 600, y: 500 + BUBBLE_REACH + 1 }, rect)).toBe(false);
    // diagonal distance, not a square
    expect(bubbleSticks({ x: 500 - 80, y: 300 - 80 }, rect)).toBe(false);
    expect(bubbleSticks({ x: 500 - 60, y: 300 - 60 }, rect)).toBe(true);
  });
  it("no pointer on this screen, or no bubble: nothing to hold", () => {
    expect(bubbleSticks(null, rect)).toBe(false);
    expect(bubbleSticks({ x: 600, y: 400 }, null)).toBe(false);
    expect(bubbleSticks({ x: 600, y: 400 }, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(false);
  });
  it("the pointer is on the bubble only inside it (a pixel of margin)", () => {
    expect(overBubble({ x: 500, y: 300 }, rect)).toBe(true);
    expect(overBubble({ x: 880, y: 500 }, rect)).toBe(true);
    expect(overBubble({ x: 499, y: 400 }, rect)).toBe(true);
    expect(overBubble({ x: 497, y: 400 }, rect)).toBe(false);
    expect(overBubble({ x: 470, y: 282 }, rect)).toBe(false);
    expect(overBubble(null, rect)).toBe(false);
  });
});

describe("the text follows the voice", () => {
  const view = { scrollTop: 0, clientHeight: 380, scrollHeight: 1500 };
  it("a sentence already in view moves nothing", () => {
    expect(followScroll({ top: 100, height: 60 }, view)).toBe(0);
    expect(followScroll({ top: 420, height: 60 }, { ...view, scrollTop: 300 })).toBe(300);
  });
  it("a sentence below the view is brought to a line under the top edge", () => {
    expect(followScroll({ top: 400, height: 60 }, view)).toBe(380);
    expect(followScroll({ top: 360, height: 60 }, view)).toBe(340); // cut by the bottom edge: not in view
  });
  it("a sentence above the view is brought back", () => {
    expect(followScroll({ top: 100, height: 60 }, { ...view, scrollTop: 600 })).toBe(80);
  });
  it("never past the ends", () => {
    expect(followScroll({ top: 1460, height: 40 }, view)).toBe(1500 - 380);
    expect(followScroll({ top: 5, height: 20 }, { ...view, scrollTop: 300 })).toBe(0);
    expect(followScroll({ top: 50, height: 20 }, { scrollTop: 0, clientHeight: 380, scrollHeight: 200 })).toBe(0);
  });
});

describe("the sentences the bubble is made of", () => {
  const LONG = [
    "To keep the files tidy, start with a few folders.  Name them after what they hold!\nIs that all? No: version 3.5 of report.txt goes in \"Work\" (the big one).",
    "Чтобы навести порядок, создайте папки. Назовите их понятно!\n\nЭто всё? Нет…",
    "ファイルを整理するには、まずフォルダーを作ります。名前はわかりやすく！それだけですか？いいえ。",
    "No full stop at the end",
    "  Leading space. Trailing space.  ",
  ];
  it("joined, the pieces are the text again, letter for letter", () => {
    for (const text of LONG) expect(sentenceParts(text).join("")).toBe(text);
  });
  it("one piece per sentence the voice speaks, in the same order", () => {
    for (const text of LONG) expect(sentenceParts(text).map((p) => p.trim())).toEqual(splitSentences(text));
    expect(sentenceParts(LONG[0])).toHaveLength(4);
    expect(sentenceParts(LONG[2])).toHaveLength(4);
  });
  it("nothing in, nothing out; only spaces stay as they are", () => {
    expect(sentenceParts("")).toEqual([]);
    expect(sentenceParts("   ")).toEqual(["   "]);
  });
});

describe("the voice says which sentence it is on", () => {
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function setup(voice: OkFilowStatus["voice"]) {
    const told: number[] = [];
    const listeners = new Set<(c: OkFilowTtsChunk) => void>();
    const replies: Array<(r: OkFilowTtsReply) => void> = [];
    const sound = { heard: 0, left: 1 };
    const player: ChunkPlayer = { add() {}, remaining: () => sound.left, played: () => sound.heard, stop() {}, pause() {}, resume() {}, state: () => "running" };
    const bridge = { tts: { speak: () => new Promise<OkFilowTtsReply>((resolve) => { replies.push(resolve); }), cancel: async () => {}, played: () => {}, onChunk: (fn: (c: OkFilowTtsChunk) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } } } as unknown as OkFilowBridge;
    const speaker = createSpeaker({ bridge: () => bridge, status: () => ({ voice, speed: 1, offline: false }) as OkFilowStatus, isCurrent: () => true, uiLang: () => "en", player: () => player, onSentence: (i) => told.push(i) });
    const chunk = (c: Partial<OkFilowTtsChunk>) => { for (const fn of [...listeners]) fn({ id: 1, seq: 0, last: false, samples: new Float32Array(44100), sampleRate: 44100, pause: 0, ...c }); };
    return { speaker, told, sound, chunk, reply: (r: OkFilowTtsReply) => replies[replies.length - 1](r) };
  }
  function fakeSynth() {
    const spoken: Array<{ text: string; onend?: () => void }> = [];
    const synth = { speaking: false, pending: false, cancel() {}, getVoices: () => [{ lang: "en-US", localService: true, name: "David" }], speak(u: (typeof spoken)[number]) { spoken.push(u); synth.speaking = true; } };
    class Utterance { voice = null; lang = ""; rate = 1; constructor(public text: string) {} }
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    return { endSentence: async () => { synth.speaking = false; spoken[spoken.length - 1].onend?.(); await tick(0); } };
  }

  it("this PC's voice: each sentence as it starts, once", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const done = s.speaker.speak("One is first. Two is next. Three is last.", 1);
    expect(s.told).toEqual([0]);
    await v.endSentence();
    expect(s.told).toEqual([0, 1]);
    await v.endSentence();
    await v.endSentence();
    await done;
    expect(s.told).toEqual([0, 1, 2]);
  });
  it("starts again from the first sentence for the next text", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const first = s.speaker.speak("Only one.", 1);
    await v.endSentence();
    await first;
    const second = s.speaker.speak("Another one.", 1);
    await v.endSentence();
    await second;
    expect(s.told).toEqual([0, 0]);
  });
  it("the natural voice: worked out from the pieces already played", async () => {
    const s = setup("natural");
    const done = s.speaker.speak("One is first. Two is next. Three is last.", 1);
    s.chunk({ seq: 0, text: "One is first." });
    s.chunk({ seq: 1, text: "Two is next." });
    s.chunk({ seq: 2, text: "Three is last.", last: true });
    await tick(40);
    expect(s.told).toEqual([0]);
    // one second per piece: the first has been heard, the second is being spoken
    s.sound.heard = 1.4;
    await tick(40);
    expect(s.told).toEqual([0, 1]);
    s.sound.heard = 2.5;
    await tick(40);
    expect(s.told).toEqual([0, 1, 2]);
    // all heard: the last sentence stays the one it is on, nothing past the end
    s.sound.heard = 3;
    s.sound.left = 0;
    s.reply({ ok: true, sent: 3 } as OkFilowTtsReply);
    await tick(80);
    await done;
    expect(s.told).toEqual([0, 1, 2]);
  });
});
