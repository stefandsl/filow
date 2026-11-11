// The pre-filter model downloads inside the app's own page: Stop must end the worker (and with it the
// transfers) and reject as "stopped", not as an error; the next Download starts a fresh worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  posted: unknown[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { FakeWorker.made.push(this); }
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  say(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

beforeEach(() => {
  FakeWorker.made = [];
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("the pre-filter model download", () => {
  it("Stop ends the worker, rejects with an AbortError, and a later Download starts over", async () => {
    const { loadGate, stopGate } = await import("./client");
    expect(stopGate()).toBe(false); // nothing to stop yet
    const seen: Array<number | null> = [];
    const run = loadGate((p) => seen.push(p.percent));
    const first = FakeWorker.made[0];
    first.say({ type: "progress", status: "progress", file: "model.onnx", loaded: 5, total: 100 });
    expect(seen).toEqual([5]);
    expect(stopGate()).toBe(true);
    const err = await run.then(() => null, (e: unknown) => e);
    expect((err as DOMException).name).toBe("AbortError");
    expect(first.terminated).toBe(true);
    expect(stopGate()).toBe(false);
    // a later Download: a new worker, and it can finish
    const again = loadGate();
    expect(FakeWorker.made).toHaveLength(2);
    FakeWorker.made[1].say({ type: "ready" });
    await expect(again).resolves.toBeUndefined();
    expect(FakeWorker.made[1].terminated).toBe(false);
    expect(stopGate()).toBe(false); // loaded: there is no download to stop
  });

  it("unloadGate lets go of a loaded model, so its files can be deleted and the next load starts over", async () => {
    const { loadGate, unloadGate } = await import("./client");
    const run = loadGate();
    FakeWorker.made[0].say({ type: "ready" });
    await run;
    unloadGate();
    expect(FakeWorker.made[0].terminated).toBe(true);
    void loadGate();
    expect(FakeWorker.made).toHaveLength(2);
  });
});
