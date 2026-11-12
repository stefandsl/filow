import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OkFilowBridge, OkFilowMode, OkFilowStatus, OkFilowTtsChunk, OkFilowTtsReply, OkFilowTtsStatus } from "./bridge";
import { createSpeaker, detectLang, toSamples, voicePanel, type ChunkPlayer, type VoiceFallback } from "./voice";

describe("detectLang", () => {
  it("tells the five languages apart from the text alone", () => {
    expect(detectLang("Click the File menu, then choose Save as.")).toBe("en");
    expect(detectLang("Apri il menu File e poi scegli Salva con nome.")).toBe("it");
    expect(detectLang("Откройте меню Файл и выберите Сохранить как.")).toBe("ru");
    expect(detectLang("Deschide meniul Fișier și apoi alege Salvare ca.")).toBe("ro");
    expect(detectLang("ファイルメニューを開いて、名前を付けて保存を選びます。")).toBe("ja");
  });

  it("does not let a product name in Latin letters change the language", () => {
    expect(detectLang("Откройте PowerPoint и нажмите кнопку Recolor.")).toBe("ru");
    expect(detectLang("PowerPointを開いて、Recolorボタンを押します。")).toBe("ja");
    expect(detectLang("Apri PowerPoint e fai clic su Recolor.")).toBe("it");
  });

  it("reads Romanian written without diacritics", () => {
    expect(detectLang("Apasa pe meniul din stanga si alege ce vrei sa deschizi.")).toBe("ro");
  });

  it("uses the app language when the text gives no hint", () => {
    expect(detectLang("OK.", "it")).toBe("it");
    expect(detectLang("42", "ja")).toBe("ja");
    expect(detectLang("PowerPoint", "ro")).toBe("ro");
    expect(detectLang("PowerPoint")).toBe("en");
    // Latin letters are never Russian or Japanese: an app in one of those languages gets English.
    expect(detectLang("PowerPoint", "ru")).toBe("en");
    expect(detectLang("", "nonsense")).toBe("en");
  });
});

describe("toSamples", () => {
  const data = [0, 0.5, -0.25, 1];

  it("keeps a Float32Array as it is", () => {
    const a = new Float32Array(data);
    expect(toSamples(a)).toBe(a);
  });

  it("rebuilds the samples from the shapes a bridge can deliver", () => {
    const bytes = new Uint8Array(new Float32Array(data).buffer);
    expect(Array.from(toSamples(bytes))).toEqual(data);
    expect(Array.from(toSamples(new Float32Array(data).buffer))).toEqual(data);
    expect(Array.from(toSamples(data))).toEqual(data);
    expect(Array.from(toSamples({ 0: 0, 1: 0.5, 2: -0.25, 3: 1 }))).toEqual(data);
    expect(toSamples(undefined).length).toBe(0);
  });

  it("reads a view that starts inside a larger buffer", () => {
    const whole = new Float32Array([9, 9, ...data]);
    const view = new Uint8Array(whole.buffer, 8, 16);
    expect(Array.from(toSamples(view))).toEqual(data);
  });
});

type Played = { id: number; seconds: number; interrupted: boolean; state: string };

function fakeTts() {
  const listeners = new Set<(c: OkFilowTtsChunk) => void>();
  const requests: Array<{ id: number; text: string; lang: string; voice?: number; speed?: number }> = [];
  const replies: Array<(r: OkFilowTtsReply) => void> = [];
  const rejects: Array<(e: Error) => void> = [];
  const cancelled: Array<number | undefined> = [];
  const played: Played[] = [];
  let warmed = 0;
  const tts: NonNullable<OkFilowBridge["tts"]> = {
    status: async () => { throw new Error("not used"); },
    download: async () => { throw new Error("not used"); },
    remove: async () => { throw new Error("not used"); },
    warm: async () => { warmed++; return true; },
    speak: (req) => {
      requests.push(req);
      return new Promise<OkFilowTtsReply>((resolve, reject) => { replies.push(resolve); rejects.push(reject); });
    },
    cancel: async (id) => { cancelled.push(id); },
    played: (info) => { played.push(info); },
    onChunk: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onStatus: () => () => {},
  };
  return {
    tts, requests, cancelled, played,
    warmed: () => warmed,
    listening: () => listeners.size,
    chunk: (c: Partial<OkFilowTtsChunk> & { id: number }) => {
      for (const fn of [...listeners]) fn({ seq: 0, last: false, samples: new Float32Array(441), sampleRate: 44100, pause: 220, ...c });
    },
    reply: (r: OkFilowTtsReply, n = replies.length - 1) => replies[n](r),
    reject: (e: Error, n = rejects.length - 1) => rejects[n](e),
  };
}

function fakePlayer() {
  const added: Array<{ length: number; rate: number; pause: number }> = [];
  const p = {
    added,
    left: 0,
    stopped: 0,
    add(samples: Float32Array, rate: number, pause: number) { added.push({ length: samples.length, rate, pause }); },
    remaining() { return p.stopped ? 0 : p.left; },
    played: () => 1.234,
    stop() { p.stopped++; },
    pause() {},
    resume() {},
    state: () => "running",
  };
  return p satisfies ChunkPlayer;
}

const OK: OkFilowTtsReply = { ok: true, cancelled: false, chunks: 1, sent: 1, level: "standard" };

function setup(over: Partial<OkFilowStatus> = {}, opts: { tts?: boolean; cloudAudio?: (text: string) => Promise<Blob | "system" | null> } = {}) {
  const t = fakeTts();
  const players: Array<ReturnType<typeof fakePlayer>> = [];
  const modes = new Set<(m: { mode: OkFilowMode }) => void>();
  const fallbacks: VoiceFallback[] = [];
  const noVoice: string[] = [];
  const state = { status: { voice: "natural", speed: 1, offline: false, naturalVoice: 3, ...over } as OkFilowStatus, turn: 1, ui: "en" };
  const bridge = {
    tts: opts.tts === false ? undefined : t.tts,
    onMode: (fn: (m: { mode: OkFilowMode }) => void) => { modes.add(fn); return () => { modes.delete(fn); }; },
  } as unknown as OkFilowBridge;
  const speaker = createSpeaker({
    bridge: () => bridge,
    status: () => state.status,
    isCurrent: (id) => id === state.turn,
    uiLang: () => state.ui,
    cloudAudio: opts.cloudAudio,
    onFallback: (r) => fallbacks.push(r),
    onNoVoice: (l) => noVoice.push(l),
    player: () => { const p = fakePlayer(); players.push(p); return p; },
  });
  return { ...t, speaker, players, fallbacks, noVoice, state, mode: (mode: OkFilowMode) => { for (const fn of [...modes]) fn({ mode }); }, modeListeners: () => modes.size };
}

/** The voice built into the PC, as the panel sees it. */
function fakeSynth(voices: Array<{ lang: string; localService: boolean; name: string }> = []) {
  const spoken: Array<{ text: string; lang: string; rate: number; voice: { name: string } | null; onend?: () => void }> = [];
  const synth = {
    speaking: false,
    pending: false,
    cancels: 0,
    cancel() { synth.cancels++; synth.speaking = false; },
    getVoices: () => voices,
    // The fake voice has finished by the time the speaker first looks (speaking stays false).
    speak(u: (typeof spoken)[number]) { spoken.push(u); },
  };
  class Utterance {
    voice = null; lang = ""; rate = 1;
    constructor(public text: string) {}
  }
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  return { synth, spoken };
}

const tick = (ms = 40) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the natural voice", () => {
  it("asks the desktop for the answer in the language of the text, with the chosen voice and speed", async () => {
    const s = setup({ speed: 1.3, naturalVoice: 7 });
    const done = s.speaker.speak("Откройте меню Файл.", 1);
    expect(s.requests).toEqual([{ id: 1, text: "Откройте меню Файл.", lang: "ru", voice: 7, speed: 1.3 }]);
    s.reply({ ...OK, sent: 0 });
    await tick();
    await done;
  });

  it("lets the caller name the language", async () => {
    const s = setup();
    const done = s.speaker.speak("OK", 1, { lang: "ja" });
    expect(s.requests[0].lang).toBe("ja");
    s.reply({ ...OK, sent: 0 });
    await tick();
    await done;
  });

  it("plays the pieces as they arrive and ends when the last one has been heard", async () => {
    const s = setup();
    let ended = false;
    const done = s.speaker.speak("Open the File menu. Then choose Save.", 1).then(() => { ended = true; });
    const player = s.players[0];
    s.chunk({ id: 1, seq: 0, samples: new Float32Array(1000), pause: 220 });
    s.chunk({ id: 1, seq: 1, last: true, samples: new Float32Array(2000), pause: 220 });
    expect(player.added).toEqual([{ length: 1000, rate: 44100, pause: 220 }, { length: 2000, rate: 44100, pause: 0 }]);
    player.left = 2;
    s.reply({ ...OK, chunks: 2, sent: 2 });
    await tick(200);
    expect(ended).toBe(false);
    player.left = 0;
    await tick();
    await done;
    expect(ended).toBe(true);
    expect(player.stopped).toBe(0);
    expect(s.cancelled).toEqual([]);
    expect(s.played).toEqual([{ id: 1, seconds: 1.23, interrupted: false, state: "running" }]);
    expect(s.listening()).toBe(0);
  });

  it("ignores the pieces of another answer and an empty piece", async () => {
    const s = setup();
    const done = s.speaker.speak("Hello there.", 1);
    s.chunk({ id: 99, samples: new Float32Array(500) });
    s.chunk({ id: 1, seq: 0, samples: new Float32Array(0) });
    s.chunk({ id: 1, seq: 1, last: true, samples: new Float32Array(0) });
    expect(s.players[0].added).toEqual([]);
    s.reply({ ...OK, chunks: 2, sent: 2 });
    await tick();
    await done;
  });

  it("takes samples that crossed the bridge as plain bytes", async () => {
    const s = setup();
    const done = s.speaker.speak("Hello there.", 1);
    s.chunk({ id: 1, last: true, samples: new Uint8Array(new Float32Array(300).buffer) as unknown as Float32Array });
    expect(s.players[0].added).toEqual([{ length: 300, rate: 44100, pause: 0 }]);
    s.reply(OK);
    await tick();
    await done;
  });

  it("goes silent at once when stopped, without waiting for a timer", async () => {
    const s = setup();
    const done = s.speaker.speak("A long answer that is still being spoken.", 1);
    s.chunk({ id: 1, samples: new Float32Array(4000) });
    s.players[0].left = 5;
    s.speaker.stop();
    await done; // no timer was advanced
    expect(s.players[0].stopped).toBe(1);
    expect(s.cancelled).toEqual([1]);
    expect(s.played[0]).toMatchObject({ id: 1, interrupted: true });
    // What the desktop still sends for the old answer is not played.
    s.chunk({ id: 1, seq: 1, samples: new Float32Array(4000) });
    expect(s.players[0].added).toHaveLength(1);
    expect(s.listening()).toBe(0);
  });

  it("goes silent when a new question takes the turn", async () => {
    const s = setup();
    let ended = false;
    const done = s.speaker.speak("A long answer that is still being spoken.", 1).then(() => { ended = true; });
    s.chunk({ id: 1, samples: new Float32Array(4000) });
    s.players[0].left = 5;
    s.state.turn = 2;
    await tick();
    await done;
    expect(ended).toBe(true);
    expect(s.players[0].stopped).toBe(1);
    expect(s.cancelled).toEqual([1]);
    expect(s.played[0].interrupted).toBe(true);
  });

  it("cuts the answer in progress when the next one starts, and only that one", async () => {
    const s = setup();
    const first = s.speaker.speak("The first answer.", 1);
    s.chunk({ id: 1, samples: new Float32Array(4000) });
    s.players[0].left = 5;
    s.state.turn = 2;
    const second = s.speaker.speak("The second answer.", 2);
    await first;
    expect(s.players[0].stopped).toBe(1);
    expect(s.cancelled).toEqual([1]);
    expect(s.requests.map((r) => r.id)).toEqual([1, 2]);
    // A late piece of the first answer never reaches the second player.
    s.chunk({ id: 1, seq: 1, samples: new Float32Array(4000) });
    s.chunk({ id: 2, last: true, samples: new Float32Array(700) });
    expect(s.players[1].added).toEqual([{ length: 700, rate: 44100, pause: 0 }]);
    s.reply(OK);
    await tick();
    await second;
    expect(s.players[1].stopped).toBe(0);
    expect(s.cancelled).toEqual([1]);
  });

  it("gives up on an answer that never comes instead of staying on speaking", async () => {
    const s = setup();
    let ended = false;
    const done = s.speaker.speak("Hello.", 1).then(() => { ended = true; });
    await tick(5000);
    expect(ended).toBe(false);
    await tick(20000);
    await done;
    expect(s.players[0].stopped).toBe(1);
    expect(s.cancelled).toEqual([1]);
    expect(s.played[0].interrupted).toBe(false);
  });

  it("never calls the network", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    fakeSynth();
    const s = setup();
    const done = s.speaker.speak("Hello.", 1);
    s.reply({ ok: false, reason: "failed", error: "boom" });
    await tick(200);
    await done;
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("falling back to this PC's voice", () => {
  it("speaks with the system voice and says why, once", async () => {
    const { spoken } = fakeSynth();
    const s = setup();
    const first = s.speaker.speak("Apri il menu File.", 1);
    s.reply({ ok: false, reason: "notInstalled" });
    await tick(200);
    await first;
    expect(spoken.map((u) => [u.text, u.lang])).toEqual([["Apri il menu File.", "it-IT"]]);
    expect(s.fallbacks).toEqual(["notInstalled"]);
    const second = s.speaker.speak("Poi scegli Salva.", 1);
    s.reply({ ok: false, reason: "notInstalled" });
    await tick(200);
    await second;
    expect(spoken).toHaveLength(2);
    expect(s.fallbacks).toEqual(["notInstalled"]);
  });

  it("names each reason: a PC that cannot carry the model, a model that failed", async () => {
    fakeSynth();
    const s = setup();
    for (const reason of ["lowMemory", "slow", "failed"] as const) {
      const done = s.speaker.speak("Hello.", 1);
      s.reply({ ok: false, reason });
      await tick(200);
      await done;
    }
    expect(s.fallbacks).toEqual(["lowMemory", "slow", "failed"]);
  });

  it("treats a desktop call that throws as a failure", async () => {
    const { spoken } = fakeSynth();
    const s = setup();
    const done = s.speaker.speak("Hello.", 1);
    s.reject(new Error("no handler"));
    await tick(200);
    await done;
    expect(s.fallbacks).toEqual(["failed"]);
    expect(spoken).toHaveLength(1);
  });

  it("works on a desktop build that has no natural voice", async () => {
    const { spoken } = fakeSynth();
    const s = setup({}, { tts: false });
    const done = s.speaker.speak("Hello.", 1);
    await tick(200);
    await done;
    expect(s.fallbacks).toEqual(["failed"]);
    expect(spoken).toHaveLength(1);
  });

  it("does not start the answer again when part of it was already heard", async () => {
    const { spoken } = fakeSynth();
    const s = setup();
    const done = s.speaker.speak("First sentence. Second sentence.", 1);
    s.chunk({ id: 1, samples: new Float32Array(900) });
    s.reply({ ok: false, reason: "failed", error: "worker died" });
    await tick(200);
    await done;
    expect(s.fallbacks).toEqual(["failed"]);
    expect(spoken).toEqual([]);
  });

  it("does not speak with the system voice when the question was replaced meanwhile", async () => {
    const { spoken } = fakeSynth();
    const s = setup();
    const done = s.speaker.speak("Hello.", 1);
    s.state.turn = 2;
    s.reply({ ok: false, reason: "notInstalled" });
    await tick(200);
    await done;
    expect(spoken).toEqual([]);
  });
});

describe("this PC's voice", () => {
  const VOICES = [
    { lang: "en-US", localService: true, name: "David" },
    { lang: "it-IT", localService: false, name: "Remote Elsa" },
    { lang: "it-IT", localService: true, name: "Elsa" },
  ];

  it("picks a voice for the language of the text, a local one first", async () => {
    const { spoken, synth } = fakeSynth(VOICES);
    const s = setup({ voice: "system", speed: 1.5 });
    const done = s.speaker.speak("Apri il menu File e poi scegli Salva.", 1);
    expect(spoken[0]).toMatchObject({ lang: "it-IT", voice: { name: "Elsa" } });
    expect(spoken[0].rate).toBeCloseTo(1.575);
    synth.speaking = false;
    await tick(150);
    await done;
    expect(s.requests).toEqual([]);
  });

  // Review of the five-language pass, finding 4: Russian, Romanian and Japanese text was handed to
  // an English or Italian voice, which reads it as noise.
  it("stays silent and says so, once per language, when this PC has no voice for the text", async () => {
    const { spoken } = fakeSynth(VOICES);
    const s = setup({ voice: "system" });
    s.state.ui = "it";
    await s.speaker.speak("Откройте меню Файл.", 1);
    await s.speaker.speak("Привет, я OK Filow.", 1, { lang: "ru" });
    await s.speaker.speak("こんにちは、OK Filowです。", 1);
    await s.speaker.speak("Bună, sunt OK Filow. Așa sun pe acest PC.", 1, { lang: "ro" });
    expect(spoken).toEqual([]);
    expect(s.noVoice).toEqual(["ru", "ja", "ro"]);
  });

  it("speaks the interface language with its own voice when this PC has one (the preview's fallback)", async () => {
    const { spoken, synth } = fakeSynth([...VOICES, { lang: "ru-RU", localService: true, name: "Irina" }, { lang: "ja-JP", localService: true, name: "Haruka" }, { lang: "ro-RO", localService: true, name: "Andrei" }]);
    const s = setup({ voice: "system" });
    for (const [lang, name, text] of [["ru", "Irina", "Привет, я OK Filow."], ["ja", "Haruka", "こんにちは、OK Filowです。"], ["ro", "Andrei", "Buna, sunt OK Filow."]] as const) {
      spoken.length = 0;
      const done = s.speaker.speak(text, 1, { lang });
      expect(spoken[0]).toMatchObject({ voice: { name } });
      expect(spoken[0].lang.slice(0, 2)).toBe(lang);
      synth.speaking = false;
      await tick(150);
      await done;
    }
    expect(s.noVoice).toEqual([]);
  });

  it("lets the system choose while the list of voices is not known yet", async () => {
    const { spoken, synth } = fakeSynth([]);
    const s = setup({ voice: "system" });
    const done = s.speaker.speak("Привет.", 1);
    expect(spoken[0]).toMatchObject({ lang: "ru-RU", voice: null });
    synth.speaking = false;
    await tick(150);
    await done;
  });
  it("stops at once when interrupted", async () => {
    const { synth } = fakeSynth(VOICES);
    const s = setup({ voice: "system" });
    const done = s.speaker.speak("A long answer.", 1);
    const before = synth.cancels;
    s.speaker.stop();
    await done;
    expect(synth.cancels).toBeGreaterThan(before);
  });

  it("says nothing when the voice is off or the text is empty", async () => {
    const { spoken } = fakeSynth(VOICES);
    const s = setup({ voice: "off" });
    await s.speaker.speak("Hello.", 1);
    s.state.status.voice = "natural";
    await s.speaker.speak("   ", 1);
    expect(spoken).toEqual([]);
    expect(s.requests).toEqual([]);
  });

  it("can be asked for one answer while another voice is chosen (the preview)", async () => {
    fakeSynth(VOICES);
    const s = setup({ voice: "system" });
    const done = s.speaker.speak("This is how I sound.", 1, { voice: "natural" });
    expect(s.requests).toHaveLength(1);
    s.reply({ ...OK, sent: 0 });
    await tick();
    await done;
  });
});

describe("the cloud voice", () => {
  class FakeAudio {
    static made: FakeAudio[] = [];
    playbackRate = 1;
    paused = false;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { FakeAudio.made.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  beforeEach(() => { FakeAudio.made = []; vi.stubGlobal("Audio", FakeAudio); });

  const mp3 = () => vi.fn(async (_text: string): Promise<Blob | "system" | null> => new Blob(["mp3"]));

  it("is used only when chosen, gets its audio only through the gated cloudAudio, and sends nothing itself", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const cloudAudio = mp3();
    const s = setup({ voice: "cloud", speed: 1.15 }, { cloudAudio });
    const done = s.speaker.speak("Hello.", 1);
    await tick(0);
    expect(cloudAudio).toHaveBeenCalledWith("Hello.");
    expect(fetched).not.toHaveBeenCalled();
    expect(FakeAudio.made[0].playbackRate).toBe(1.15);
    FakeAudio.made[0].onended?.();
    await tick(100);
    await done;
    expect(s.requests).toEqual([]);
  });

  it("never sends when no gated cloudAudio is given: this PC's voice speaks instead", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { spoken, synth } = fakeSynth();
    const s = setup({ voice: "cloud" });
    const done = s.speaker.speak("Hello.", 1);
    await tick(0);
    expect(spoken).toHaveLength(1);
    synth.speaking = false;
    await tick(150);
    await done;
    expect(fetched).not.toHaveBeenCalled();
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("speaks with this PC's voice when the user keeps the voice on this PC, and says nothing when the notice was closed", async () => {
    const { spoken, synth } = fakeSynth();
    const kept = setup({ voice: "cloud" }, { cloudAudio: async () => "system" });
    const done = kept.speaker.speak("Hello.", 1);
    await tick(0);
    expect(spoken).toHaveLength(1);
    synth.speaking = false;
    await tick(150);
    await done;
    const closed = setup({ voice: "cloud" }, { cloudAudio: async () => null });
    await closed.speaker.speak("Hello again.", 1);
    expect(spoken).toHaveLength(1);
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("reports a cloud error instead of quietly speaking with another voice", async () => {
    const { spoken } = fakeSynth();
    const s = setup({ voice: "cloud" }, { cloudAudio: async () => { throw new Error("no credit"); } });
    await expect(s.speaker.speak("Hello.", 1)).rejects.toThrow("no credit");
    expect(spoken).toEqual([]);
    expect(s.requests).toEqual([]);
  });

  it("stays on this PC in offline mode", async () => {
    const cloudAudio = mp3();
    const { spoken, synth } = fakeSynth();
    const s = setup({ voice: "cloud", offline: true }, { cloudAudio });
    const done = s.speaker.speak("Hello.", 1);
    expect(spoken).toHaveLength(1);
    synth.speaking = false;
    await tick(150);
    await done;
    expect(cloudAudio).not.toHaveBeenCalled();
  });

  it("is cut by a new question", async () => {
    const s = setup({ voice: "cloud" }, { cloudAudio: mp3() });
    const done = s.speaker.speak("Hello.", 1);
    await tick(0);
    s.speaker.stop();
    await done;
    expect(FakeAudio.made[0].paused).toBe(true);
  });
});

describe("warming the model", () => {
  it("loads the natural voice when a question starts", () => {
    const s = setup();
    const off = s.speaker.attach();
    s.mode("listening");
    s.mode("thinking");
    s.mode("speaking");
    s.mode("idle");
    expect(s.warmed()).toBe(2);
    off();
    expect(s.modeListeners()).toBe(0);
  });

  it("leaves the model alone when another voice is chosen", () => {
    const s = setup({ voice: "system" });
    s.speaker.attach();
    s.mode("listening");
    expect(s.warmed()).toBe(0);
  });
});

describe("what the settings show for the natural voice", () => {
  const base: OkFilowTtsStatus = { installed: false, state: "idle", pct: 0, error: "", sizeBytes: 128774318, voices: 10, mode: "natural", level: "standard", reason: "" };

  it("shows nothing on a desktop build without the natural voice", () => {
    expect(voicePanel(null)).toEqual({ show: "none" });
    expect(voicePanel(undefined)).toEqual({ show: "none" });
  });

  it("offers the download with its size in megabytes", () => {
    expect(voicePanel(base)).toEqual({ show: "get", busy: "", resume: false, pct: 0, sizeMb: 129, problem: "" });
  });

  it("offers to resume when part of the download is already on disk", () => {
    expect(voicePanel({ ...base, pct: 41.6 })).toMatchObject({ show: "get", resume: true, pct: 42, busy: "" });
  });

  it("shows progress while downloading and unpacking, not a second download button", () => {
    expect(voicePanel({ ...base, state: "downloading", pct: 12 })).toMatchObject({ show: "get", busy: "downloading", pct: 12, resume: false });
    expect(voicePanel({ ...base, state: "extracting", pct: 100 })).toMatchObject({ show: "get", busy: "extracting", resume: false });
  });

  it("tells an offline refusal from a download that stopped", () => {
    expect(voicePanel({ ...base, state: "error", error: "offline" })).toMatchObject({ show: "get", problem: "offline" });
    expect(voicePanel({ ...base, state: "error", error: "socket hang up", pct: 30 })).toMatchObject({ show: "get", problem: "failed", resume: true, pct: 30 });
  });

  it("says why instead of offering a download this PC cannot use", () => {
    expect(voicePanel({ ...base, mode: "system", level: "", reason: "lowMemory" })).toEqual({ show: "blocked", reason: "lowMemory" });
    expect(voicePanel({ ...base, mode: "system", level: "", reason: "fewCores" })).toEqual({ show: "blocked", reason: "fewCores" });
    // Downloaded, then found too slow: the model is on disk but the system voice speaks.
    expect(voicePanel({ ...base, installed: true, state: "ready", pct: 100, mode: "system", level: "", reason: "slow" })).toEqual({ show: "blocked", reason: "slow" });
  });

  it("shows the voice as ready once installed, and marks the lighter setting", () => {
    expect(voicePanel({ ...base, installed: true, state: "ready", pct: 100 })).toEqual({ show: "ready", light: false, voices: 10 });
    expect(voicePanel({ ...base, installed: true, state: "ready", pct: 100, level: "light" })).toEqual({ show: "ready", light: true, voices: 10 });
  });

  it("keeps a wild percentage inside 0 to 100", () => {
    expect(voicePanel({ ...base, pct: 250 })).toMatchObject({ pct: 100 });
    expect(voicePanel({ ...base, pct: -3 })).toMatchObject({ pct: 0, resume: false });
  });
});
