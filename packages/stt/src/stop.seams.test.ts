import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserStt } from "./browser";
import { ElevenLabsStt } from "./elevenlabs";
import { OpenAiStt } from "./openai";
import { LocalWhisperStt } from "./whisper";
import { SherpaStt } from "./sherpa";

const fakes = vi.hoisted(() => ({ pcm: null as any, worker: null as any }));
vi.mock("./mic", () => ({ startMic: async (_rate: number, fn: unknown) => { fakes.pcm = fn; return { stop: vi.fn() }; }, toBase64: () => "fake-pcm" }));
vi.mock("./whisperModels", () => ({ selectedWhisperModel: () => "fake", createWhisperWorker: () => fakes.worker }));
class Socket {
  static OPEN = 1;
  static last: Socket;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  sent: any[] = [];
  constructor() { Socket.last = this; queueMicrotask(() => this.onopen?.()); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  deliver(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval });
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "fake", value: "fake" })));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Step 4 stop seams", () => {
  // Contract: apps/desktop/stt-worker.js stop branch: "flush what is still in the stream"; Q3.
  it.fails("Sherpa stop must deliver the worker's final committed utterance", async () => {
    const listeners = new Set<(r: any) => void>();
    let receive!: (m: unknown) => void;
    const posted: any[] = [];
    // Execute the real worker's protocol against a fake recognizer, including inputFinished.
    const inputFinished = vi.fn();
    const recognizer = { createStream: () => ({ inputFinished, setOption() {} }), isReady: () => false,
      getResult: () => ({ text: "last utterance" }) };
    runInNewContext(readFileSync(new URL("../../../apps/desktop/stt-worker.js", import.meta.url), "utf8"), {
      require: (id: string) => id === "node:path" ? path : id === "node:worker_threads" ? { parentPort: {
        on: (_event: string, fn: typeof receive) => { receive = fn; },
        postMessage: (m: any) => { posted.push(m); if (m.type === "result") for (const fn of listeners) fn(m); },
      } } : { OnlineRecognizer: function () { return recognizer; } },
    });
    vi.stubGlobal("filow", { stt: {
      status: async () => ({ model: "ready" }), start: async () => { receive({ type: "init", dir: "fake" }); },
      onResult: (fn: (r: any) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
      stop: () => receive({ type: "stop" }), feed() {},
    } });
    const transcript = vi.fn(); const backend = new SherpaStt();
    await backend.start({ onTranscript: transcript, onError: vi.fn() }); backend.stop();
    expect(inputFinished).toHaveBeenCalledOnce();
    expect(posted).toContainEqual({ type: "result", partial: "", committed: "last utterance" });
    expect(transcript, "worker flush must reach the take before the result subscription is removed")
      .toHaveBeenCalledWith({ committed: "last utterance ", partial: "" });
  });
  it("characterizes Whisper stop: buffered PCM and in-flight recognition are discarded", async () => {
    const posted: any[] = []; const terminate = vi.fn();
    fakes.worker = { onmessage: null, terminate, postMessage(m: any) {
      posted.push(m); if (m.type === "load") this.onmessage({ data: { type: "ready" } });
    } };
    const transcript = vi.fn(); const backend = new LocalWhisperStt("fake");
    await backend.start({ onTranscript: transcript, onError: vi.fn() });
    fakes.pcm(new Int16Array(16000).fill(1000).buffer);
    await vi.advanceTimersByTimeAsync(4000);
    fakes.pcm(new Int16Array(16000).fill(1000).buffer);
    backend.stop();
    expect(posted.filter(m => m.type === "transcribe")).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();
    expect(transcript.mock.calls.filter(c => c[0].committed)).toHaveLength(0);
  });
  it("characterizes Browser stop: abort is used, and an already queued result still delivers", async () => {
    const rec = { start() {}, stop: vi.fn(), abort: vi.fn(), onresult: null as any };
    vi.stubGlobal("window", { SpeechRecognition: function () { return rec; } });
    vi.stubGlobal("navigator", { language: "en-US" });
    const transcript = vi.fn(); const backend = new BrowserStt();
    await backend.start({ onTranscript: transcript, onError: vi.fn() }); backend.stop();
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "queued" } }] });
    expect(rec.abort).toHaveBeenCalledOnce(); expect(rec.stop).not.toHaveBeenCalled();
    expect(transcript).toHaveBeenCalledWith({ committed: "queued ", partial: "" });
  });
  for (const kind of ["openai", "elevenlabs"] as const) {
    it(`characterizes ${kind} stop: no final commit and queued text still delivers`, async () => {
      const transcript = vi.fn(); const backend = kind === "openai" ? new OpenAiStt() : new ElevenLabsStt();
      await backend.start({ onTranscript: transcript, onError: vi.fn() });
      fakes.pcm(new Int16Array(24000).fill(1000).buffer);
      const socket = Socket.last; backend.stop();
      expect(socket.sent.some(m => m.type === "input_audio_buffer.commit" || m.commit === true)).toBe(false);
      socket.deliver(kind === "openai" ? { type: "conversation.item.input_audio_transcription.completed", transcript: "queued" }
        : { message_type: "committed_transcript", text: "queued" });
      expect(transcript).toHaveBeenCalledWith({ committed: "queued ", partial: "" });
    });
  }
});
