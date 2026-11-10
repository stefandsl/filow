// The natural voice on this PC (docs/okfilow/VOICE.md): which voice speaks which language, how an
// answer is cut into pieces that stream, interruption, the pinned and resumable model download,
// and the fallback on a PC too small for the model.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";
import { startArchiveServer, type ArchiveServer } from "./test-archive-server";

const require = createRequire(import.meta.url);
const tts = require("./tts.js");
const { partFile } = require("./stt.js");

type Piece = { text: string; pause: number };
type Chunk = { seq: number; last: boolean; samples: Float32Array; sampleRate: number; pause: number; text: string };
type Status = { installed: boolean; state: string; pct: number; error: string; sizeBytes: number; voices: number; mode: string; level: string; reason: string };
type SpeakReply = { ok: boolean; reason?: string; cancelled?: boolean; chunks?: number; sent?: number; level?: string };

const texts = (text: string, lang: string): string[] => tts.splitSentences(text, lang).map((p: Piece) => p.text);
const GIB = 1024 ** 3;

// Test files live in the project's own tmp folder (never on C:).
const root = tmpRoot("tts");

describe("voice for a language", () => {
  it("speaks each of the five languages in that language", () => {
    for (const lang of ["en", "it", "ru", "ro", "ja"]) expect(tts.voiceFor(lang, 3)).toEqual({ lang, sid: 3 });
    expect(tts.LANGS).toEqual(["en", "it", "ru", "ro", "ja"]);
  });

  it("falls back to English and the first voice for anything it does not know", () => {
    expect(tts.voiceFor("de", 2)).toEqual({ lang: "en", sid: 2 });
    expect(tts.voiceFor(undefined, undefined)).toEqual({ lang: "en", sid: 0 });
    expect(tts.voiceFor("ja", 10)).toEqual({ lang: "ja", sid: 0 });
    expect(tts.voiceFor("ru", -1)).toEqual({ lang: "ru", sid: 0 });
    expect(tts.voiceFor("it", "9")).toEqual({ lang: "it", sid: 9 });
    expect(tts.voiceFor("it", 1.5)).toEqual({ lang: "it", sid: 0 });
  });
});

describe("text that reads well aloud", () => {
  it("drops markdown, links and emoji", () => {
    const md = "## Export\n- Click **File**, then `Export`.\n1. See [the guide](https://filow.app/docs/a(b)) or https://example.com/x?y=1 \u{1F44D}";
    expect(tts.speakable(md, "en")).toBe("Export\nClick File, then Export.\nSee the guide or example.com");
  });

  it("writes a clock time the way the voice reads it right in each language", () => {
    expect(tts.speakable("Встреча в 9:30.", "ru")).toBe("Встреча в девять тридцать.");
    expect(tts.speakable("В 21:05 и в 0:00.", "ru")).toBe("В двадцать один ноль пять и в ноль ноль ноль.");
    expect(tts.speakable("会議は9:30です。10:00から。", "ja")).toBe("会議は9時30分です。10時から。");
    expect(tts.speakable("Alle 9:30, poi alle 10:00.", "it")).toBe("Alle 9 30, poi alle 10.");
    expect(tts.speakable("La 9:05.", "ro")).toBe("La 9 05.");
    expect(tts.speakable("At 9:30.", "en")).toBe("At 9:30.");
  });

  it("leaves numbers that are not a clock time alone", () => {
    expect(tts.speakable("Счёт 10:30:15, версия 1.2:3.", "ru")).toBe("Счёт 10:30:15, версия 1.2:3.");
    expect(tts.speakable("Ratio 25:99.", "it")).toBe("Ratio 25:99.");
  });

  it("spells a Latin acronym in katakana for Japanese only", () => {
    expect(tts.speakable("PDFとしてエクスポート。", "ja")).toBe("ピーディーエフとしてエクスポート。");
    expect(tts.speakable("Export as PDF.", "en")).toBe("Export as PDF.");
    // A product name is not an acronym: it stays.
    expect(tts.speakable("Filowを開く。", "ja")).toBe("Filowを開く。");
  });

  it("caps a very long answer", () => {
    expect(tts.speakable("a".repeat(9000), "en").length).toBe(4000);
  });
});

describe("cutting an answer into pieces that stream", () => {
  it("makes each sentence a piece", () => {
    expect(texts("Open the File menu first. Then choose Export. That is all!", "en")).toEqual(["Open the File menu first.", "Then choose Export.", "That is all!"]);
    expect(texts("ファイルメニューを開きます。次にエクスポートを選びます。", "ja")).toEqual(["ファイルメニューを開きます。", "次にエクスポートを選びます。"]);
    expect(texts("Откройте меню Файл. Затем выберите Экспорт?", "ru")).toEqual(["Откройте меню Файл.", "Затем выберите Экспорт?"]);
  });

  it("does not cut at a decimal point, an abbreviation, a time or a number with a comma", () => {
    expect(texts("Pi is about 3.14 and v2.0 is out.", "en")).toEqual(["Pi is about 3.14 and v2.0 is out."]);
    expect(texts("Use a format, e.g. the PDF one.", "en")).toEqual(["Use a format, e.g. the PDF one."]);
    const long = "The meeting that everybody was waiting for starts at 9:30 and costs 1,000 euro or 3,14 percent of it";
    for (const p of texts(long, "en")) {
      expect(p).not.toMatch(/9:$/);
      expect(p).not.toMatch(/^30/);
      expect(p).not.toMatch(/1,$|3,$/);
    }
  });

  it("gives up the first clause of a long opening sentence so speech starts early", () => {
    const long = "This is a rather long first sentence that keeps going for a while, with a clause in the middle, and then it carries on until it finally reaches the end.";
    const pieces: Piece[] = tts.splitSentences(long, "en");
    expect(pieces[0]).toEqual({ text: "This is a rather long first sentence that keeps going for a while,", pause: 60 });
    expect(pieces.at(-1)?.pause).toBe(220);
    expect(pieces.map((p) => p.text).join(" ")).toBe(long);
  });

  it("says a one-word opening together with what follows", () => {
    expect(texts("Sure. Click File, then choose Export as PDF.", "en")[0]).toBe("Sure. Click File, then choose Export as PDF.");
    expect(texts("はい。ファイルを開きます。", "ja")[0]).toBe("はい。ファイルを開きます。");
    // Alone, it is still spoken.
    expect(texts("Sure.", "en")).toEqual(["Sure."]);
  });

  it("never lets a piece be much longer than the one before, so the voice does not run dry", () => {
    const answer = "Open the File menu. Then, once the dialog is on screen, pick the folder where the exported file should go, give it a name you will recognise later, check that the format is the one you want, and confirm with the button at the bottom right of the window.";
    const pieces = texts(answer, "en");
    expect(pieces.length).toBeGreaterThan(2);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].length).toBeLessThanOrEqual(Math.max(48, 3 * pieces[i - 1].length) + 40);
    expect(pieces.join(" ")).toBe(answer);
  });

  it("cuts a very long stretch with no punctuation between words, never inside one", () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`);
    const pieces = texts(words.join(" "), "en");
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(220);
    expect(pieces.join(" ").split(" ")).toEqual(words);
  });

  it("leaves out a piece with nothing to say", () => {
    expect(texts("Done. :) ...", "en")).toEqual(["Done."]);
    expect(texts("... !!!", "en")).toEqual([]);
    expect(texts("", "en")).toEqual([]);
  });

  it("treats a line break as the end of a thought", () => {
    expect(texts("First step is to open the menu\nSecond step is to choose Export", "en")).toEqual(["First step is to open the menu", "Second step is to choose Export"]);
  });
});

describe("silence around a piece", () => {
  it("keeps a short margin and drops the rest", () => {
    const rate = 1000;
    const s = new Float32Array(3000);
    for (let i = 1000; i < 2000; i++) s[i] = 0.5;
    const out: Float32Array = tts.trimSilence(s, rate);
    // 20 ms before, 60 ms after.
    expect(out.length).toBe(1000 + 20 + 60);
    expect(out[19]).toBe(0);
    expect(out[20]).toBe(0.5);
    // A copy, not a view on the big buffer: only these samples travel to the window.
    expect(out.buffer.byteLength).toBe(out.length * 4);
  });

  it("returns nothing for a piece that is all silence", () => {
    expect(tts.trimSilence(new Float32Array(500), 1000).length).toBe(0);
    expect(tts.trimSilence(new Float32Array(500).fill(0.001), 1000).length).toBe(0);
  });

  it("does not run past the ends of the audio", () => {
    const s = new Float32Array(10).fill(0.5);
    expect(tts.trimSilence(s, 1000).length).toBe(10);
  });
});

describe("the setting this PC can carry", () => {
  it("uses the standard setting on a normal PC", () => {
    expect(tts.pickProfile({ cores: 8, memBytes: 16 * GIB })).toEqual({ mode: "natural", level: "standard", steps: 5, threads: 4 });
    expect(tts.pickProfile({ cores: 6, memBytes: 8 * GIB })).toEqual({ mode: "natural", level: "standard", steps: 5, threads: 4 });
  });

  it("picks the lighter setting on low-spec hardware", () => {
    expect(tts.pickProfile({ cores: 4, memBytes: 16 * GIB })).toEqual({ mode: "natural", level: "light", steps: 4, threads: 2 });
    expect(tts.pickProfile({ cores: 8, memBytes: 6 * GIB })).toEqual({ mode: "natural", level: "light", steps: 4, threads: 2 });
    expect(tts.pickProfile({ cores: 2, memBytes: 4 * GIB })).toEqual({ mode: "natural", level: "light", steps: 4, threads: 2 });
  });

  it("falls back to the system voice, with the reason, when the model cannot run", () => {
    expect(tts.pickProfile({ cores: 1, memBytes: 16 * GIB })).toEqual({ mode: "system", reason: "fewCores" });
    expect(tts.pickProfile({ cores: 4, memBytes: 2 * GIB })).toEqual({ mode: "system", reason: "lowMemory" });
  });

  it("steps down after two slow answers in a row, not after one", () => {
    const standard = tts.pickProfile({ cores: 8, memBytes: 16 * GIB });
    const one = tts.nextProfile(standard, 1.2, 0);
    expect(one).toEqual({ profile: standard, strikes: 1 });
    // A fast answer in between forgives the slow one.
    expect(tts.nextProfile(standard, 0.3, 1)).toEqual({ profile: standard, strikes: 0 });
    const two = tts.nextProfile(one.profile, 1.2, one.strikes);
    // The same light setting a small PC starts with: 4 steps on 2 threads (VOICE.md).
    expect(standard.threads).toBe(4);
    expect(two.profile).toEqual(tts.pickProfile({ cores: 4, memBytes: 16 * GIB }));
    expect(two.profile).toMatchObject({ mode: "natural", level: "light", steps: 4, threads: 2 });
    const three = tts.nextProfile(two.profile, 0.9, two.strikes);
    const four = tts.nextProfile(three.profile, 0.9, three.strikes);
    expect(four.profile).toEqual({ mode: "system", reason: "slow" });
    // Nothing below the system voice.
    expect(tts.nextProfile(four.profile, 5, 0)).toEqual({ profile: four.profile, strikes: 0 });
  });
});

// ---- a worker that makes audio without a model ----

type SayMsg = { type: string; rid: number; text: string; lang: string; sid: number; speed: number; steps: number; dir?: string; threads?: number };

class FakeWorker extends EventEmitter {
  said: SayMsg[] = [];
  inits: SayMsg[] = [];
  terminated = false;
  /** Time the "model" reports for each piece, and the real delay before the audio arrives. */
  constructor(private opts: { workMs?: number; delayMs?: number; failInit?: string; failSay?: string; silent?: boolean } = {}) {
    super();
  }
  postMessage(msg: SayMsg) {
    if (msg.type === "init") {
      this.inits.push(msg);
      setTimeout(() => this.emit("message", this.opts.failInit ? { type: "error", message: this.opts.failInit } : { type: "ready", loadMs: 1 }), 1);
      return;
    }
    this.said.push(msg);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.opts.failSay) return this.emit("message", { type: "error", rid: msg.rid, message: this.opts.failSay });
      // Half a second of sound between two stretches of silence, like the real model.
      const samples = new Float32Array(1000);
      if (!this.opts.silent) for (let i = 250; i < 750; i++) samples[i] = 0.5;
      this.emit("message", { type: "audio", rid: msg.rid, samples, sampleRate: 1000, ms: this.opts.workMs ?? 50 });
    }, this.opts.delayMs ?? 2);
  }
  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function session(opts: ConstructorParameters<typeof FakeWorker>[0] = {}) {
  const workers: FakeWorker[] = [];
  const s = new tts.TtsSession(path.join(root, "nowhere"), () => {}, {
    makeWorker: () => {
      const w = new FakeWorker(opts);
      workers.push(w);
      return w;
    },
  });
  return { s, workers };
}

const REQ = { lang: "en", sid: 0, speed: 1, steps: 5, threads: 2 };
const THREE = "Open the File menu first. Then choose Export as PDF. That is all you need to do.";

describe("speaking piece by piece", () => {
  it("delivers each sentence as its own chunk, in order, with the silence trimmed", async () => {
    const { s, workers } = session();
    const chunks: Chunk[] = [];
    const out = await s.speak({ text: THREE, ...REQ }, (c: Chunk) => chunks.push(c));
    expect(out).toMatchObject({ chunks: 3, sent: 3, cancelled: false });
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.last)).toEqual([false, false, true]);
    expect(chunks.map((c) => c.text)).toEqual(["Open the File menu first.", "Then choose Export as PDF.", "That is all you need to do."]);
    for (const c of chunks) expect(c.samples.length).toBe(500 + 20 + 60);
    // One piece is asked for at a time: the next starts only when the one before has arrived.
    expect(workers[0].said.map((m) => m.text)).toEqual(chunks.map((c) => c.text));
    expect(workers[0].said[0]).toMatchObject({ lang: "en", sid: 0, speed: 1, steps: 5 });
    expect(out.rtf).toBeCloseTo(50 / 580, 3);
    s.dispose();
  });

  it("loads the model once and keeps it for the next answer", async () => {
    const { s, workers } = session();
    await s.speak({ text: "First answer here.", ...REQ }, () => {});
    await s.speak({ text: "Second answer here.", ...REQ }, () => {});
    expect(workers.length).toBe(1);
    expect(workers[0].inits.length).toBe(1);
    expect(workers[0].inits[0]).toMatchObject({ threads: 2 });
    // Another thread count is another setting: the model is loaded again.
    await s.speak({ text: "Third answer here.", ...REQ, threads: 4 }, () => {});
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    s.dispose();
    expect(workers[1].terminated).toBe(true);
  });

  it("stops at once when cancelled: nothing more is delivered or asked for", async () => {
    const { s, workers } = session();
    const chunks: Chunk[] = [];
    const out = await s.speak({ text: THREE, ...REQ }, (c: Chunk) => {
      chunks.push(c);
      s.cancel();
    });
    expect(out).toMatchObject({ cancelled: true, sent: 1, chunks: 3 });
    expect(chunks.length).toBe(1);
    expect(workers[0].said.length).toBe(1);
    s.dispose();
  });

  it("drops a piece that was being made when the cancel came", async () => {
    const { s } = session({ delayMs: 30 });
    const chunks: Chunk[] = [];
    const p = s.speak({ text: THREE, ...REQ }, (c: Chunk) => chunks.push(c));
    setTimeout(() => s.cancel(), 15);
    const out = await p;
    expect(out.cancelled).toBe(true);
    expect(chunks.length).toBe(0);
    s.dispose();
  });

  it("lets a new question cut the old answer", async () => {
    const { s } = session({ delayMs: 10 });
    const first: Chunk[] = [];
    const second: Chunk[] = [];
    const a = s.speak({ text: THREE, ...REQ }, (c: Chunk) => first.push(c));
    await new Promise((r) => setTimeout(r, 25));
    const b = s.speak({ text: "A new answer now.", ...REQ }, (c: Chunk) => second.push(c));
    const [outA, outB] = await Promise.all([a, b]);
    expect(outA.cancelled).toBe(true);
    expect(first.length).toBeLessThan(3);
    expect(outB).toMatchObject({ cancelled: false, sent: 1 });
    expect(second.map((c) => c.text)).toEqual(["A new answer now."]);
    // Nothing of the old answer arrives after the new one started.
    const before = first.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(first.length).toBe(before);
    s.dispose();
  });

  it("reports the end even when the last piece is silent, and skips silent pieces before it", async () => {
    const { s } = session({ silent: true });
    const chunks: Chunk[] = [];
    const out = await s.speak({ text: THREE, ...REQ }, (c: Chunk) => chunks.push(c));
    expect(out.cancelled).toBe(false);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toMatchObject({ last: true, seq: 2 });
    expect(chunks[0].samples.length).toBe(0);
    s.dispose();
  });

  it("says nothing, and loads nothing, for an answer with no words", async () => {
    const { s, workers } = session();
    const out = await s.speak({ text: "\u{1F44D} ...", ...REQ }, () => {
      throw new Error("no chunk expected");
    });
    expect(out).toMatchObject({ chunks: 0, sent: 0, cancelled: false });
    expect(workers.length).toBe(0);
    s.dispose();
  });

  it("fails loudly when the model cannot be loaded or a piece cannot be made", async () => {
    const bad = session({ failInit: "model file is damaged" });
    await expect(bad.s.speak({ text: THREE, ...REQ }, () => {})).rejects.toThrow("model file is damaged");
    // The next answer tries again with a fresh worker.
    await expect(bad.s.speak({ text: THREE, ...REQ }, () => {})).rejects.toThrow("model file is damaged");
    expect(bad.workers.length).toBe(2);
    bad.s.dispose();
    const half = session({ failSay: "out of memory" });
    await expect(half.s.speak({ text: THREE, ...REQ }, () => {})).rejects.toThrow("out of memory");
    half.s.dispose();
  });

  it("rejects the piece in flight when the worker dies", async () => {
    const { s, workers } = session({ delayMs: 50 });
    const p = s.speak({ text: THREE, ...REQ }, () => {});
    await new Promise((r) => setTimeout(r, 20));
    workers[0].emit("exit", 1);
    await expect(p).rejects.toThrow("voice worker stopped (1)");
    s.dispose();
  });

  it("never leaves an answer hanging when the worker is stopped while the model loads", async () => {
    const hung = (p: Promise<unknown>) => Promise.race([p.then((v) => v, (e) => e), new Promise((r) => setTimeout(() => r("hung"), 200))]);
    // Filow closing (or a new question) while the model loads: the answer is over, not stuck.
    const a = session();
    const closing = a.s.speak({ text: THREE, ...REQ }, () => {});
    a.s.dispose();
    expect(await hung(closing)).toMatchObject({ cancelled: true, sent: 0 });
    // The voice removed while it loads (the worker stops, the answer is still the current one): an error the panel can fall back from.
    const b = session();
    const removed = b.s.speak({ text: THREE, ...REQ }, () => {});
    b.s.stopWorker();
    const got = await hung(removed);
    expect(got).toBeInstanceOf(Error);
    expect((got as Error).message).toBe("voice stopped");
    // A piece asked for after the worker is gone fails at once instead of waiting forever.
    expect(await hung(b.s.say({ text: "Hi.", lang: "en", sid: 0, speed: 1, steps: 5 }))).toBeInstanceOf(Error);
    b.s.dispose();
  });

  it("unloads the model after a while without speech", async () => {
    const workers: FakeWorker[] = [];
    const s = new tts.TtsSession(path.join(root, "nowhere"), () => {}, {
      idleMs: 20,
      makeWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
    });
    await s.speak({ text: "Short answer here.", ...REQ }, () => {});
    expect(workers[0].terminated).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(workers[0].terminated).toBe(true);
    s.dispose();
  });
});

// ---- the IPC channels, with a small real archive behind a local server ----

type Sent = { channel: string; payload: unknown };
function sender() {
  const sent: Sent[] = [];
  return { sent, isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push({ channel, payload }) };
}
type Sender = ReturnType<typeof sender>;

function ipc() {
  const handlers = new Map<string, (event: { sender: Sender }, ...args: unknown[]) => unknown>();
  const listeners = new Map<string, (event: { sender: Sender }, ...args: unknown[]) => void>();
  return {
    handle: (channel: string, fn: (event: { sender: Sender }, ...args: unknown[]) => unknown) => void handlers.set(channel, fn),
    on: (channel: string, fn: (event: { sender: Sender }, ...args: unknown[]) => void) => void listeners.set(channel, fn),
    invoke: async (channel: string, from: Sender, ...args: unknown[]) => handlers.get(channel)!({ sender: from }, ...args),
    emit: (channel: string, from: Sender, ...args: unknown[]) => listeners.get(channel)!({ sender: from }, ...args),
  };
}

const ARCHIVE = "fixture-voice-2026";
const FILES = ["voice.onnx", "voice.bin"];
let srv: ArchiveServer;

beforeAll(async () => {
  srv = await startArchiveServer(root, ARCHIVE, FILES, 512 * 1024);
});

afterAll(async () => {
  await srv.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function spec() {
  return { id: "fixture-voice", archive: ARCHIVE, url: `${srv.base}/voice.tar.bz2`, sizeBytes: srv.bytes.length, sha256: srv.sha256, files: FILES };
}

function wire(name: string, extra: Record<string, unknown> = {}) {
  const userData = path.join(root, name);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(path.join(userData, "models"), { recursive: true });
  srv.reset();
  const bus = ipc();
  const log: string[] = [];
  const workers: FakeWorker[] = [];
  const model = spec();
  const made = new tts.TtsSession(userData, (l: string) => log.push(l), {
    model,
    makeWorker: () => {
      const w = new FakeWorker((extra.worker as ConstructorParameters<typeof FakeWorker>[0]) || {});
      workers.push(w);
      return w;
    },
  });
  const api = tts.wireTts({
    ipcMain: bus,
    ours: (event: { sender: Sender & { foreign?: boolean } }) => !event.sender.foreign,
    userData,
    logLine: (l: string) => log.push(l),
    hardware: { cores: 8, memBytes: 16 * GIB },
    session: made,
    model,
    ...extra,
  });
  return { userData, bus, log, workers, model, api };
}

function install(userData: string) {
  const dir = path.join(userData, "models", "fixture-voice");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(dir, f), "x");
}

async function until(test: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!test()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the pinned model", () => {
  it("comes from the engine's release page over https with a full SHA-256", () => {
    expect(tts.MODEL.url).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\/[\w.-]+\.tar\.bz2$/);
    expect(tts.MODEL.url.endsWith(`${tts.MODEL.archive}.tar.bz2`)).toBe(true);
    expect(tts.MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(tts.MODEL.sizeBytes).toBe(128774318);
    expect(tts.MODEL.files.length).toBe(7);
  });
});

describe("okfilow:tts channels", () => {
  it("refuses a sender that is not one of OK Filow's windows", async () => {
    const { bus } = wire("denied");
    const stranger = Object.assign(sender(), { foreign: true });
    for (const channel of ["okfilow:tts:status", "okfilow:tts:download", "okfilow:tts:remove", "okfilow:tts:warm", "okfilow:tts:speak", "okfilow:tts:cancel"]) {
      await expect(bus.invoke(channel, stranger, {})).rejects.toThrow("Denied");
    }
    expect(srv.requests).toBe(0);
  });

  it("says the voice is not installed instead of speaking, and never downloads on its own", async () => {
    const { bus, workers } = wire("not-installed");
    const panel = sender();
    const st = (await bus.invoke("okfilow:tts:status", panel)) as Status;
    expect(st).toMatchObject({ installed: false, state: "idle", pct: 0, mode: "natural", level: "standard", voices: 10 });
    expect(st.sizeBytes).toBe(srv.bytes.length);
    expect(await bus.invoke("okfilow:tts:speak", panel, { id: 1, text: THREE, lang: "en" })).toEqual({ ok: false, reason: "notInstalled" });
    expect(await bus.invoke("okfilow:tts:warm", panel)).toBe(false);
    expect(srv.requests).toBe(0);
    expect(workers.length).toBe(0);
  });

  it("downloads on request, checks the pinned hash and unpacks the model", async () => {
    const { bus, userData, model } = wire("download");
    const panel = sender();
    const started = (await bus.invoke("okfilow:tts:download", panel)) as Status;
    expect(started.state).toBe("downloading");
    await until(() => panel.sent.some((s) => (s.payload as Status).installed));
    const done = (await bus.invoke("okfilow:tts:status", panel)) as Status;
    expect(done).toMatchObject({ installed: true, state: "ready", pct: 100, error: "" });
    for (const f of FILES) expect(fs.readFileSync(path.join(userData, "models", "fixture-voice", f)).length).toBe(512 * 1024);
    expect(fs.existsSync(partFile(userData, model))).toBe(false);
    expect(srv.requests).toBe(1);
    // Progress reached the window while it ran.
    expect(panel.sent.every((s) => s.channel === "okfilow:tts:status")).toBe(true);
    // Asking again downloads nothing.
    await bus.invoke("okfilow:tts:download", panel);
    expect(srv.requests).toBe(1);
  });

  it("resumes a download that stopped half way, from the bytes already on disk", async () => {
    const { bus, userData, model } = wire("resume");
    const panel = sender();
    const cut = Math.ceil(srv.bytes.length * 0.4);
    fs.writeFileSync(partFile(userData, model), srv.bytes.subarray(0, cut));
    // Before the click: the window can offer "Resume" with what is already there.
    expect(await bus.invoke("okfilow:tts:status", panel)).toMatchObject({ installed: false, state: "idle", pct: 40 });
    await bus.invoke("okfilow:tts:download", panel);
    await until(() => panel.sent.some((s) => (s.payload as Status).installed));
    expect(srv.seenRanges).toEqual([`bytes=${cut}-`]);
  });

  it("throws away bytes that fail the pinned hash and fetches them again", async () => {
    const { bus, userData, model } = wire("corrupt");
    const panel = sender();
    // Right length, wrong bytes: only the hash can tell.
    const bad = Buffer.from(srv.bytes);
    bad[100] ^= 0xff;
    fs.writeFileSync(partFile(userData, model), bad);
    await bus.invoke("okfilow:tts:download", panel);
    await until(() => panel.sent.some((s) => (s.payload as Status).installed));
    expect(srv.requests).toBe(1);
    expect(srv.seenRanges).toEqual([]);
    expect(fs.readFileSync(path.join(userData, "models", "fixture-voice", FILES[0])).length).toBe(512 * 1024);
  }, 20_000);

  it("runs one download at a time: a second click joins the first", async () => {
    const { bus } = wire("single");
    const panel = sender();
    srv.mode = "hold-next";
    await bus.invoke("okfilow:tts:download", panel);
    await until(() => srv.held());
    const again = (await bus.invoke("okfilow:tts:download", panel)) as Status;
    expect(again.state).toBe("downloading");
    // Removing while it downloads is ignored.
    expect(((await bus.invoke("okfilow:tts:remove", panel)) as Status).state).toBe("downloading");
    srv.release();
    await until(() => panel.sent.some((s) => (s.payload as Status).installed));
    expect(srv.requests).toBe(1);
  });

  it("does not download when Filow is offline, and says why", async () => {
    const { bus } = wire("offline", { isOffline: () => true });
    const panel = sender();
    expect(await bus.invoke("okfilow:tts:download", panel)).toMatchObject({ installed: false, state: "error", error: "offline" });
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.requests).toBe(0);
  });

  it("still speaks offline once the model is installed", async () => {
    const { bus, userData } = wire("offline-speaks", { isOffline: () => true });
    install(userData);
    const panel = sender();
    expect(await bus.invoke("okfilow:tts:speak", panel, { id: 4, text: "Short answer here.", lang: "it" })).toMatchObject({ ok: true, sent: 1 });
    expect(srv.requests).toBe(0);
  });

  it("reports a failed download and keeps the reason", async () => {
    const { bus } = wire("failed", {
      download: async (onStatus: (s: { state: string; pct: number; error?: string }) => void) => {
        onStatus({ state: "downloading", pct: 12 });
        onStatus({ state: "error", pct: 12, error: "connection lost" });
      },
    });
    const panel = sender();
    await bus.invoke("okfilow:tts:download", panel);
    await until(() => panel.sent.some((s) => (s.payload as Status).state === "error"));
    expect(await bus.invoke("okfilow:tts:status", panel)).toMatchObject({ installed: false, state: "error", error: "connection lost" });
    // A new click starts again.
    await bus.invoke("okfilow:tts:download", panel);
    expect(panel.sent.some((s) => (s.payload as Status).state === "downloading")).toBe(true);
  });

  it("streams an answer to the window that asked, in the language asked for", async () => {
    const { bus, userData, workers, log } = wire("speak");
    install(userData);
    const panel = sender();
    const out = (await bus.invoke("okfilow:tts:speak", panel, { id: 7, text: "Certo. Apri il menu File, poi scegli Esporta. Fatto!", lang: "it", voice: 6, speed: 1.2 })) as SpeakReply;
    expect(out).toMatchObject({ ok: true, cancelled: false, level: "standard" });
    const chunks = panel.sent.filter((s) => s.channel === "okfilow:tts:chunk").map((s) => s.payload as Chunk & { id: number });
    expect(chunks.length).toBe(out.sent);
    expect(chunks.every((c) => c.id === 7)).toBe(true);
    expect(chunks.at(-1)?.last).toBe(true);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(chunks[0].sampleRate).toBe(1000);
    expect(workers[0].said[0]).toMatchObject({ lang: "it", sid: 6, steps: 5 });
    // The speed setting reaches the model (with the same small lift as the system voice).
    expect(workers[0].said[0].speed).toBeCloseTo(1.05 * 1.2, 5);
    expect(workers[0].inits[0]).toMatchObject({ threads: 4 });
    expect(log.some((l) => /^tts: it voice 6 standard/.test(l))).toBe(true);
  });

  it("clamps the speed and falls back to English and the first voice", async () => {
    const { bus, userData, workers } = wire("clamp");
    install(userData);
    const panel = sender();
    await bus.invoke("okfilow:tts:speak", panel, { id: 1, text: "Short answer here.", lang: "xx", voice: 99, speed: 9 });
    await bus.invoke("okfilow:tts:speak", panel, { id: 2, text: "Short answer here.", speed: 0.1 });
    await bus.invoke("okfilow:tts:speak", panel, null);
    expect(workers[0].said[0]).toMatchObject({ lang: "en", sid: 0 });
    expect(workers[0].said[0].speed).toBeCloseTo(1.05 * 1.5, 5);
    expect(workers[0].said[1].speed).toBeCloseTo(1.05 * 0.75, 5);
    expect(workers[0].said.length).toBe(2);
  });

  it("cuts the answer short on cancel", async () => {
    const { bus, userData } = wire("cancel", { worker: { delayMs: 20 } });
    install(userData);
    const panel = sender();
    const speaking = bus.invoke("okfilow:tts:speak", panel, { id: 9, text: THREE, lang: "en" }) as Promise<SpeakReply>;
    await until(() => panel.sent.some((s) => s.channel === "okfilow:tts:chunk"));
    await bus.invoke("okfilow:tts:cancel", panel);
    const out = await speaking;
    expect(out).toMatchObject({ ok: true, cancelled: true });
    expect(panel.sent.filter((s) => s.channel === "okfilow:tts:chunk").length).toBeLessThan(3);
  });

  it("ignores a late stop meant for an older answer", async () => {
    const { bus, userData } = wire("late-cancel", { worker: { delayMs: 20 } });
    install(userData);
    const panel = sender();
    const speaking = bus.invoke("okfilow:tts:speak", panel, { id: 12, text: THREE, lang: "en" }) as Promise<SpeakReply>;
    await until(() => panel.sent.some((s) => s.channel === "okfilow:tts:chunk"));
    await bus.invoke("okfilow:tts:cancel", panel, 11);
    expect(await speaking).toMatchObject({ ok: true, cancelled: false, sent: 3 });
    const again = bus.invoke("okfilow:tts:speak", panel, { id: 13, text: THREE, lang: "en" }) as Promise<SpeakReply>;
    await bus.invoke("okfilow:tts:cancel", panel, 13);
    expect(await again).toMatchObject({ ok: true, cancelled: true });
  });

  it("uses the lighter setting on low-spec hardware and says so", async () => {
    const { bus, userData, workers } = wire("light", { hardware: { cores: 4, memBytes: 8 * GIB } });
    install(userData);
    const panel = sender();
    expect(await bus.invoke("okfilow:tts:status", panel)).toMatchObject({ mode: "natural", level: "light" });
    expect(await bus.invoke("okfilow:tts:speak", panel, { id: 1, text: "Short answer here.", lang: "en" })).toMatchObject({ ok: true, level: "light" });
    expect(workers[0].said[0].steps).toBe(4);
    expect(workers[0].inits[0]).toMatchObject({ threads: 2 });
  });

  it("does not load the model on a PC too small for it and gives the reason", async () => {
    const { bus, userData, workers } = wire("tiny", { hardware: { cores: 2, memBytes: 2 * GIB } });
    install(userData);
    const panel = sender();
    expect(await bus.invoke("okfilow:tts:status", panel)).toMatchObject({ installed: true, mode: "system", reason: "lowMemory" });
    expect(await bus.invoke("okfilow:tts:speak", panel, { id: 1, text: THREE, lang: "en" })).toEqual({ ok: false, reason: "lowMemory" });
    expect(await bus.invoke("okfilow:tts:warm", panel)).toBe(false);
    expect(workers.length).toBe(0);
  });

  it("steps down when this PC makes speech slower than it is spoken, and tells the window", async () => {
    // 900 ms of work for 580 ms of sound.
    const { bus, userData, workers } = wire("slow", { worker: { workMs: 900 } });
    install(userData);
    const panel = sender();
    const ask = (id: number) => bus.invoke("okfilow:tts:speak", panel, { id, text: "Short answer here.", lang: "en" }) as Promise<SpeakReply>;
    expect((await ask(1)).level).toBe("standard");
    expect((await ask(2)).level).toBe("standard");
    expect(panel.sent.filter((s) => s.channel === "okfilow:tts:status").map((s) => (s.payload as Status).level)).toEqual(["light"]);
    expect((await ask(3)).level).toBe("light");
    // The light setting reloads the model once, on 2 threads, and speaks with 4 steps.
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].inits[0]).toMatchObject({ threads: 2 });
    expect(workers[1].said[0].steps).toBe(4);
    expect(await ask(4)).toMatchObject({ ok: true, level: "light" });
    expect(await ask(5)).toEqual({ ok: false, reason: "slow" });
    expect(await bus.invoke("okfilow:tts:status", panel)).toMatchObject({ mode: "system", reason: "slow" });
  });

  it("reports a voice that fails instead of staying silent", async () => {
    const { bus, userData } = wire("fails", { worker: { failInit: "model file is damaged" } });
    install(userData);
    expect(await bus.invoke("okfilow:tts:speak", sender(), { id: 1, text: THREE, lang: "en" })).toEqual({ ok: false, reason: "failed", error: "model file is damaged" });
  });

  it("removes the model and the half-downloaded archive", async () => {
    const { bus, userData, model, workers } = wire("remove");
    install(userData);
    fs.writeFileSync(partFile(userData, model), "partial");
    const panel = sender();
    await bus.invoke("okfilow:tts:speak", panel, { id: 1, text: "Short answer here.", lang: "en" });
    expect(await bus.invoke("okfilow:tts:remove", panel)).toMatchObject({ installed: false, state: "idle", pct: 0 });
    expect(fs.existsSync(path.join(userData, "models", "fixture-voice"))).toBe(false);
    expect(fs.existsSync(partFile(userData, model))).toBe(false);
    expect(workers[0].terminated).toBe(true);
  });

  it("tells the rest of the app when the voice arrives and when it goes, so the default can follow", async () => {
    const seen: Status[] = [];
    const { bus, api } = wire("on-change", { onChange: (s: Status) => seen.push(s) });
    expect(api.usable()).toBe(false);
    const panel = sender();
    await bus.invoke("okfilow:tts:download", panel);
    await until(() => seen.some((s) => s.installed));
    expect(api.installed()).toBe(true);
    expect(api.usable()).toBe(true);
    await bus.invoke("okfilow:tts:remove", panel);
    expect(seen[seen.length - 1]).toMatchObject({ installed: false, state: "idle" });
    expect(api.usable()).toBe(false);
  });

  it("is not offered as the default on a PC that cannot carry it, even with the model on disk", () => {
    const { userData, api } = wire("usable-low", { hardware: { cores: 8, memBytes: 2 * GIB } });
    install(userData);
    expect(api.installed()).toBe(true);
    expect(api.usable()).toBe(false);
    expect(api.status()).toMatchObject({ mode: "system", reason: "lowMemory" });
  });

  it("writes what was spoken to the test folder in a test build only", async () => {
    const qaDir = path.join(root, "qa-out");
    const { bus, userData } = wire("qa", { qaDir });
    install(userData);
    const panel = sender();
    await bus.invoke("okfilow:tts:speak", panel, { id: 3, text: "Open the File menu first. Then choose Export.", lang: "en" });
    const wav = fs.readFileSync(path.join(qaDir, "tts-001.wav"));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(1000);
    // Two pieces of 580 samples and the 220 ms pause between them, 16-bit.
    expect(wav.readUInt32LE(40)).toBe((580 + 220 + 580) * 2);
    expect(JSON.parse(fs.readFileSync(path.join(qaDir, "tts-001.json"), "utf8"))).toMatchObject({ id: 3, lang: "en", chunks: 2, sent: 2, cancelled: false, steps: 5 });
    bus.emit("okfilow:tts:played", panel, { id: 3, seconds: 1.38, interrupted: true, state: "running" });
    expect(fs.readFileSync(path.join(qaDir, "played.log"), "utf8")).toBe("tts: played 1.4 s of id 3 (interrupted), audio running\n");

    const plain = wire("no-qa");
    install(plain.userData);
    fs.rmSync(qaDir, { recursive: true, force: true });
    await plain.bus.invoke("okfilow:tts:speak", sender(), { id: 1, text: "Short answer here.", lang: "en" });
    expect(fs.existsSync(qaDir)).toBe(false);
  });
});

describe("the worker that runs the model", () => {
  // Stands in for sherpa-onnx inside Electron, which refuses audio handed over as an external buffer.
  function electronLikeSherpa() {
    const requests: Record<string, unknown>[] = [];
    class OfflineTts {
      config: unknown;
      constructor(config: unknown) { this.config = config; }
      generate(request: Record<string, unknown>) {
        requests.push(request);
        if (request.enableExternalBuffer !== false) throw new Error("External buffers are not allowed");
        return { samples: new Float32Array([0.1, -0.2, 0.3]), sampleRate: 44100 };
      }
    }
    class GenerationConfig {
      constructor(fields: Record<string, unknown>) { Object.assign(this, fields); }
    }
    return { requests, module: { OfflineTts, GenerationConfig } };
  }
  type Posted = { message: { type: string; rid?: number; message?: string; samples?: Float32Array; sampleRate?: number }; transfer?: ArrayBuffer[] };

  it("gets the audio out of the native module inside Electron", () => {
    const { createHandler } = require("./tts-worker.js");
    const fake = electronLikeSherpa();
    const posted: Posted[] = [];
    const handle = createHandler((message: Posted["message"], transfer?: ArrayBuffer[]) => posted.push({ message, transfer }), () => fake.module);
    handle({ type: "init", dir: "models", threads: 2 });
    expect(posted[0].message.type).toBe("ready");
    handle({ type: "say", rid: 7, text: "Ciao.", lang: "it", sid: 6, speed: 1.05, steps: 5 });
    expect(posted[1].message).toMatchObject({ type: "audio", rid: 7, sampleRate: 44100 });
    expect(Array.from(posted[1].message.samples as Float32Array)).toEqual(Array.from(new Float32Array([0.1, -0.2, 0.3])));
    // The audio travels to the main thread in memory the worker owns.
    expect(posted[1].transfer).toEqual([(posted[1].message.samples as Float32Array).buffer]);
    expect(fake.requests[0]).toMatchObject({ text: "Ciao.", generationConfig: { sid: 6, speed: 1.05, numSteps: 5, extra: { lang: "it" } } });
  });

  it("reports a piece asked for before the model is loaded, and a model that does not load", () => {
    const { createHandler } = require("./tts-worker.js");
    const posted: Posted[] = [];
    const handle = createHandler((message: Posted["message"]) => posted.push({ message }), () => { throw new Error("no native module"); });
    handle({ type: "say", rid: 1, text: "Hi.", lang: "en", sid: 0, speed: 1, steps: 5 });
    expect(posted[0].message).toEqual({ type: "error", rid: 1, message: "voice model not loaded" });
    handle({ type: "init", dir: "models", threads: 2 });
    expect(posted[1].message).toEqual({ type: "error", message: "no native module" });
  });
});

describe("wav bytes", () => {
  it("writes a mono 16-bit file and clips out-of-range samples", () => {
    const wav: Buffer = tts.wavBytes(new Float32Array([0, 1, -1, 2, -2, 0.5]), 44100);
    expect(wav.length).toBe(44 + 12);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect([0, 1, 2, 3, 4, 5].map((i) => wav.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32767, 32767, -32767, 16384]);
  });
});
