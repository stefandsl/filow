// Pause and Resume for the three voices (docs/okfilow/PILL.md): nothing is cut in the middle of a
// sentence where the voice can tell, nothing is repeated, nothing is skipped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsChunk, OkFilowTtsReply } from "./bridge";
import { createSpeaker, sentencesWithin, webAudioPlayer, type ChunkPlayer } from "./voice";

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** A voice of this PC that keeps "speaking" until the test ends the sentence. */
function fakeSynth() {
  const spoken: Array<{ text: string; onend?: () => void }> = [];
  const synth = {
    speaking: false,
    pending: false,
    cancels: 0,
    cancel() { synth.cancels++; },
    getVoices: () => [{ lang: "en-US", localService: true, name: "David" }],
    speak(u: (typeof spoken)[number]) { spoken.push(u); synth.speaking = true; },
  };
  class Utterance {
    voice = null; lang = ""; rate = 1;
    constructor(public text: string) {}
  }
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  /** The sentence being spoken ends, as the PC's voice reports it. */
  const endSentence = async () => { synth.speaking = false; spoken[spoken.length - 1].onend?.(); await tick(0); };
  return { synth, spoken, texts: () => spoken.map((u) => u.text), endSentence };
}

function recordingPlayer() {
  const p = {
    added: [] as number[],
    left: 0,
    stopped: 0,
    pauses: 0,
    resumes: 0,
    heard: 0,
    add(samples: Float32Array) { p.added.push(samples.length); },
    remaining: () => (p.stopped ? 0 : p.left),
    played: () => p.heard,
    stop() { p.stopped++; },
    pause() { p.pauses++; },
    resume() { p.resumes++; },
    state: () => "running",
  };
  return p satisfies ChunkPlayer;
}

function setup(voice: OkFilowStatus["voice"], cloudAudio?: (text: string) => Promise<Blob | "system" | null>) {
  const listeners = new Set<(c: OkFilowTtsChunk) => void>();
  const replies: Array<(r: OkFilowTtsReply) => void> = [];
  const players: Array<ReturnType<typeof recordingPlayer>> = [];
  const state = { turn: 1 };
  const bridge = {
    tts: {
      speak: () => new Promise<OkFilowTtsReply>((resolve) => { replies.push(resolve); }),
      cancel: async () => {},
      played: () => {},
      onChunk: (fn: (c: OkFilowTtsChunk) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    },
  } as unknown as OkFilowBridge;
  const speaker = createSpeaker({
    bridge: () => bridge,
    status: () => ({ voice, speed: 1, offline: false }) as OkFilowStatus,
    isCurrent: (id) => id === state.turn,
    uiLang: () => "en",
    cloudAudio,
    player: () => { const p = recordingPlayer(); players.push(p); return p; },
  });
  const chunk = (c: Partial<OkFilowTtsChunk>) => { for (const fn of [...listeners]) fn({ id: 1, seq: 0, last: false, samples: new Float32Array(44100), sampleRate: 44100, pause: 0, ...c }); };
  return { speaker, players, state, chunk, reply: (r: OkFilowTtsReply) => replies[replies.length - 1](r) };
}

describe("pausing this PC's voice", () => {
  it("speaks one sentence at a time", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const done = s.speaker.speak("Open the File menu. Then choose Save! Is that all? Yes.", 1);
    expect(v.texts()).toEqual(["Open the File menu."]);
    await v.endSentence();
    await v.endSentence();
    await v.endSentence();
    await v.endSentence();
    await done;
    expect(v.texts()).toEqual(["Open the File menu.", "Then choose Save!", "Is that all?", "Yes."]);
    expect(s.speaker.left()).toBe("");
  });

  it("a pause lets the sentence being spoken finish and holds the next; resume speaks the next one, nothing twice, nothing skipped", async () => {
    const v = fakeSynth();
    const s = setup("system");
    let over = false;
    const done = s.speaker.speak("One is first. Two is next. Three is last.", 1).then(() => { over = true; });
    s.speaker.pause();
    expect(s.speaker.paused()).toBe(true);
    // The sentence in the air is not cut.
    expect(v.synth.cancels).toBe(1);
    await v.endSentence();
    await tick(60_000);
    expect(v.texts()).toEqual(["One is first."]);
    expect(s.speaker.left()).toBe("Two is next. Three is last.");
    expect(over).toBe(false);
    s.speaker.resume();
    await tick(0);
    expect(v.texts()).toEqual(["One is first.", "Two is next."]);
    await v.endSentence();
    await v.endSentence();
    await done;
    expect(v.texts()).toEqual(["One is first.", "Two is next.", "Three is last."]);
  });

  it("a stop during the pause ends it: nothing more is spoken, and the rest is known for a later Resume", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const done = s.speaker.speak("One is first. Two is next. Three is last.", 1);
    await v.endSentence();
    s.speaker.pause();
    await v.endSentence();
    s.speaker.stop();
    await done;
    expect(v.texts()).toEqual(["One is first.", "Two is next."]);
    expect(s.speaker.paused()).toBe(false);
    expect(s.speaker.left()).toBe("Three is last.");
  });

  it("a sentence cut by Stop counts as not spoken", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const done = s.speaker.speak("One is first. Two is next.", 1);
    await v.endSentence();
    s.speaker.stop();
    await done;
    expect(s.speaker.left()).toBe("Two is next.");
  });

  it("does not give up on a sentence because the pause was long", async () => {
    const v = fakeSynth();
    const s = setup("system");
    const done = s.speaker.speak("One is first. Two is next.", 1);
    await v.endSentence();
    s.speaker.pause();
    await v.endSentence();
    await tick(600_000);
    s.speaker.resume();
    await tick(0);
    await v.endSentence();
    await done;
    expect(s.speaker.left()).toBe("");
  });
});

describe("pausing the natural voice", () => {
  it("tells the player to pause and to resume, and keeps handing it the pieces that arrive meanwhile", async () => {
    const s = setup("natural");
    const done = s.speaker.speak("One is first. Two is next.", 1);
    s.chunk({ seq: 0 });
    s.speaker.pause();
    s.chunk({ seq: 1, last: true, samples: new Float32Array(100) });
    expect(s.players[0]).toMatchObject({ pauses: 1, resumes: 0, added: [44100, 100], stopped: 0 });
    s.speaker.resume();
    expect(s.players[0]).toMatchObject({ pauses: 1, resumes: 1, stopped: 0 });
    s.reply({ ok: true, cancelled: false, chunks: 2, sent: 2, level: "standard" });
    await tick(40);
    await done;
    expect(s.speaker.left()).toBe("");
  });

  it("the clock that gives up on lost speech stands still during a pause", async () => {
    const s = setup("natural");
    let over = false;
    void s.speaker.speak("One is first.", 1).then(() => { over = true; });
    s.players[0].left = 5;
    s.speaker.pause();
    await tick(3_600_000);
    expect(over).toBe(false);
    expect(s.players[0].stopped).toBe(0);
    s.speaker.resume();
    // Not paused any more: speech that never ends is given up on, as before.
    await tick(60_000);
    expect(over).toBe(true);
    expect(s.players[0].stopped).toBe(1);
  });

  it("after a stop, knows which sentences were heard whole from the pieces played", async () => {
    const s = setup("natural");
    const done = s.speaker.speak("One is first. Two is next. Three is last.", 1);
    s.chunk({ seq: 0, text: "One is first." });
    s.chunk({ seq: 1, text: "Two is next." });
    s.chunk({ seq: 2, text: "Three is last.", last: true });
    // One second per piece: the first was heard whole, the second only in part.
    s.players[0].heard = 1.6;
    s.players[0].left = 1.4;
    s.speaker.stop();
    await done;
    expect(s.speaker.left()).toBe("Two is next. Three is last.");
  });
});

describe("sentencesWithin", () => {
  it("counts the sentences that fit whole, whatever the spacing and marks", () => {
    const list = ["One is first.", "Two is next.", "Three is last."];
    expect(sentencesWithin(list, 0)).toBe(0);
    expect(sentencesWithin(list, 10)).toBe(1);
    expect(sentencesWithin(list, 19)).toBe(2);
    expect(sentencesWithin(list, 500)).toBe(3);
  });
});

describe("pausing the cloud voice", () => {
  class FakeAudio {
    static made: FakeAudio[] = [];
    playbackRate = 1;
    volume = 1;
    plays = 0;
    pauses = 0;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { FakeAudio.made.push(this); }
    play() { this.plays++; return Promise.resolve(); }
    pause() { this.pauses++; }
  }
  beforeEach(() => { FakeAudio.made = []; vi.stubGlobal("Audio", FakeAudio); });

  it("pauses at once with a short fade and resumes the same recording, without asking for it again", async () => {
    const cloudAudio = vi.fn(async (): Promise<Blob | "system" | null> => new Blob(["mp3"]));
    const s = setup("cloud", cloudAudio);
    let over = false;
    const done = s.speaker.speak("One is first. Two is next.", 1).then(() => { over = true; });
    await tick(0);
    const el = FakeAudio.made[0];
    expect(el).toMatchObject({ plays: 1, pauses: 0 });
    s.speaker.pause();
    await tick(20);
    // Fading, not yet silent.
    expect(el.pauses).toBe(0);
    expect(el.volume).toBeLessThan(1);
    await tick(30);
    expect(el.pauses).toBe(1);
    // A long pause is not lost speech.
    await tick(3_600_000);
    expect(over).toBe(false);
    s.speaker.resume();
    expect(el).toMatchObject({ plays: 2, volume: 1 });
    expect(FakeAudio.made).toHaveLength(1);
    expect(cloudAudio).toHaveBeenCalledTimes(1);
    el.onended?.();
    await tick(100);
    await done;
  });
});

describe("the player of the natural voice", () => {
  type Source = { length: number; at: number; stopped: boolean };
  class FakeContext {
    static last: FakeContext;
    currentTime = 0;
    state = "running";
    destination = {};
    sources: Source[] = [];
    constructor() { FakeContext.last = this; }
    resume() { return Promise.resolve(); }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} } }; }
    createBuffer(_channels: number, length: number, rate: number) { const data = new Float32Array(length); return { length, duration: length / rate, getChannelData: () => data }; }
    createBufferSource() {
      const sources = this.sources;
      const src = { buffer: null as { length: number } | null, connect() {}, disconnect() {}, start(at: number) { rec.at = at; rec.length = src.buffer!.length; sources.push(rec); }, stop() { rec.stopped = true; } };
      const rec: Source = { length: 0, at: -1, stopped: false };
      return src;
    }
  }
  const piece = (seconds: number) => new Float32Array(Math.round(seconds * 1000));

  it("a pause lets the piece being heard finish, takes the next ones off the schedule and keeps them, with the ones that arrive meanwhile, in order", () => {
    vi.stubGlobal("AudioContext", FakeContext);
    const player = webAudioPlayer();
    const ctx = FakeContext.last;
    player.add(piece(1), 1000, 200);
    player.add(piece(2), 1000, 200);
    player.add(piece(3), 1000, 0);
    expect(ctx.sources.map((s) => [s.length, Number(s.at.toFixed(2))])).toEqual([[1000, 0.03], [2000, 1.23], [3000, 3.43]]);
    ctx.currentTime = 0.5;
    player.pause?.();
    // The first piece plays on; the two that had not begun are off the schedule.
    expect(ctx.sources.map((s) => s.stopped)).toEqual([false, true, true]);
    player.add(piece(4), 1000, 0);
    expect(ctx.sources).toHaveLength(3);
    // Still to be heard: the rest of the first piece and the three kept ones.
    expect(player.remaining()).toBeCloseTo(0.53 + 2 + 3 + 4);
    ctx.currentTime = 10;
    expect(player.remaining()).toBeCloseTo(9);
    expect(player.played()).toBeCloseTo(1);
    player.resume?.();
    const again = ctx.sources.slice(3);
    expect(again.map((s) => s.length)).toEqual([2000, 3000, 4000]);
    expect(again.map((s) => Number(s.at.toFixed(2)))).toEqual([10.03, 12.23, 15.23]);
    expect(again.some((s) => s.stopped)).toBe(false);
    // Half a second into the second piece: one second, the pause between pieces, and that half; the wait is not counted.
    ctx.currentTime = 10.53;
    expect(player.played()).toBeCloseTo(1 + 0.2 + 0.5);
    player.resume?.();
    expect(ctx.sources).toHaveLength(6);
  });
});
