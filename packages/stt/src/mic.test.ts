import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIC_WORKLET_URL, preopenMic, startMic } from "./mic";

function fixture(options: { contextMs?: number; workletError?: boolean } = {}) {
  let time = 0;
  if (options.contextMs) vi.stubGlobal("performance", { now: () => time });
  const track = Object.assign(new EventTarget(), { label: "C920", readyState: "live", stop: vi.fn() });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [{ kind: "audioinput", deviceId: "cam", label: "C920", groupId: "cam" }] } });
  vi.stubGlobal("localStorage", { getItem: () => "cam" });
  const graphNode = () => ({ disconnect: vi.fn(), connect: vi.fn(function(this: unknown) { return this; }) });
  const source = graphNode();
  const mute = { ...graphNode(), gain: { value: 1 } };
  const close = vi.fn(async () => {});
  const contextArgs = vi.fn();
  const addModule = vi.fn(async (_url: string) => { if (options.workletError) throw new Error("worklet failed"); });
  vi.stubGlobal("AudioContext", class {
    constructor(opts: unknown) { contextArgs(opts); time += options.contextMs || 0; }
    audioWorklet = { addModule };
    createMediaStreamSource = () => source;
    createGain = () => mute;
    destination = {};
    close = close;
  });
  const node = { ...graphNode(), port: { onmessage: null as ((e: { data: { pcm: ArrayBuffer; peak: number } }) => void) | null } };
  vi.stubGlobal("AudioWorkletNode", class { constructor() { return node; } });
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mic-test");
  return { track, getUserMedia, close, contextArgs, mute, node, addModule, createObjectURL };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("capture health wiring", () => {
  it("uses selected constraints for the open/stop probe without creating an AudioContext", async () => {
    const f = fixture();
    await preopenMic();
    expect(f.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "cam" } } });
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.contextArgs).not.toHaveBeenCalled();
  });
  it("warns on a stalled graph without stopping, clears on audio and preserves the PCM buffer", async () => {
    const f = fixture();
    const warn = vi.fn(), log = vi.fn(), chunk = vi.fn();
    const mic = await startMic(16000, chunk, warn, log);
    expect(f.contextArgs).toHaveBeenCalledWith({ sampleRate: 16000 });
    expect(f.mute.gain.value).toBe(0);
    expect(f.getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, deviceId: { exact: "cam" } } });
    await vi.advanceTimersByTimeAsync(3999);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenLastCalledWith({ kind: "silence", label: "C920" });
    expect(f.track.stop).not.toHaveBeenCalled();
    const pcm = new Int16Array([0, 1200, -900]).buffer;
    f.node.port.onmessage?.({ data: { pcm, peak: 0.057 } });
    expect(chunk).toHaveBeenCalledWith(pcm);
    expect(warn).toHaveBeenLastCalledWith(null);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("audio recovered"));
    mic.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("reports an ended track immediately, with no automatic stop or later callbacks after stop", async () => {
    const f = fixture();
    const warn = vi.fn(), log = vi.fn();
    const mic = await startMic(16000, vi.fn(), warn, log);
    f.track.dispatchEvent(new Event("ended"));
    expect(warn).toHaveBeenCalledWith({ kind: "ended", label: "C920" });
    expect(log).toHaveBeenCalledWith("microphone ended: C920");
    expect(f.track.stop).not.toHaveBeenCalled();
    mic.stop();
    warn.mockClear();
    f.track.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(warn).not.toHaveBeenCalled();
  });
  it("measures a blocking context constructor and reports its actual duration", async () => {
    fixture({ contextMs: 6001 });
    const warn = vi.fn(), log = vi.fn();
    const mic = await startMic(16000, vi.fn(), warn, log);
    expect(warn).toHaveBeenCalledWith({ kind: "slow-context", label: "C920", elapsedMs: 6001 });
    expect(log).toHaveBeenCalledWith("microphone AudioContext opened in 6001 ms");
    mic.stop();
  });
  it("loads the worklet from the app's own static file, never from a blob: URL (the desktop CSP has no blob: in script-src)", async () => {
    const f = fixture();
    const mic = await startMic(16000, vi.fn());
    expect(f.addModule).toHaveBeenCalledWith(MIC_WORKLET_URL);
    expect(MIC_WORKLET_URL).toBe("/mic-worklet.js");
    expect(f.createObjectURL).not.toHaveBeenCalled();
    mic.stop();
  });
  it("closes the track/context and clears the health timer if graph setup fails", async () => {
    const f = fixture({ workletError: true });
    await expect(startMic(16000, vi.fn())).rejects.toThrow("worklet failed");
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the static worklet file (apps/web/public/mic-worklet.js)", () => {
  it("registers pcm-chunker and posts 100 ms chunks of 16-bit PCM with their peak", () => {
    const file = path.join(__dirname, "../../../apps/web/public", MIC_WORKLET_URL);
    const posted: Array<{ pcm: ArrayBuffer; peak: number }> = [];
    const registered: Record<string, new () => { process: (inputs: Float32Array[][]) => boolean }> = {};
    class AudioWorkletProcessor { port = { postMessage: (m: { pcm: ArrayBuffer; peak: number }) => posted.push(m) }; }
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { AudioWorkletProcessor, registerProcessor: (n: string, c: never) => (registered[n] = c), sampleRate: 1000, Float32Array, Int16Array, Math });
    const proc = new registered["pcm-chunker"]();
    expect(proc.process([[new Float32Array(60).fill(0.5)]])).toBe(true);
    expect(posted).toHaveLength(0); // 60 of 100 samples
    proc.process([[new Float32Array(60).fill(-2)]]);
    expect(posted).toHaveLength(1);
    const pcm = new Int16Array(posted[0].pcm);
    expect(pcm.length).toBe(100);
    expect(pcm[0]).toBe(Math.trunc(0.5 * 0x7fff));
    expect(pcm[99]).toBe(-0x8000); // clipped to -1
    expect(posted[0].peak).toBe(1);
  });
});
