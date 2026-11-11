// Models that run inside the app's own page (Whisper, the pre-filter): Stop ends the worker and its
// transfers, Delete removes the model's files from the browser cache and nothing else.
import { describe, expect, it, vi } from "vitest";
import { preloadWhisper, removeCachedModel } from "./whisperModels";

class FakeWorker {
  terminated = false;
  posted: unknown[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  say(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

describe("preloadWhisper with a signal", () => {
  it("Stop terminates the worker at once and rejects with an AbortError (not a failure)", async () => {
    const w = new FakeWorker();
    const ctl = new AbortController();
    const progress = vi.fn();
    const run = preloadWhisper("onnx-community/whisper-base", progress, ctl.signal, () => w as unknown as Worker);
    w.say({ type: "progress", status: "progress", file: "encoder.onnx", loaded: 4, total: 100 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(false);
    ctl.abort();
    const err = await run.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    expect(w.terminated).toBe(true);
  });

  it("a signal that is already aborted starts no worker", async () => {
    const make = vi.fn(() => new FakeWorker() as unknown as Worker);
    const ctl = new AbortController();
    ctl.abort();
    await expect(preloadWhisper("m", () => {}, ctl.signal, make)).rejects.toMatchObject({ name: "AbortError" });
    expect(make).not.toHaveBeenCalled();
  });

  it("without Stop it still resolves with the device", async () => {
    const w = new FakeWorker();
    const run = preloadWhisper("m", () => {}, undefined, () => w as unknown as Worker);
    w.say({ type: "ready", device: "webgpu" });
    await expect(run).resolves.toBe("webgpu");
    expect(w.terminated).toBe(true);
  });
});

/** A stand-in for the browser's Cache Storage: named caches of { url -> content-length }. */
function fakeCaches(content: Record<string, Record<string, number>>) {
  return {
    keys: async () => Object.keys(content),
    open: async (name: string) => ({
      keys: async () => Object.keys(content[name]).map((url) => ({ url })),
      match: async (r: { url: string }) => (r.url in content[name] ? { headers: { get: (h: string) => (h === "content-length" ? String(content[name][r.url]) : null) } } : undefined),
      delete: async (r: { url: string }) => { const had = r.url in content[name]; delete content[name][r.url]; return had; },
    }),
  } as unknown as CacheStorage;
}

describe("removeCachedModel", () => {
  it("deletes every file of that model, in every cache, and leaves other models alone", async () => {
    const hub = "https://huggingface.co";
    const content = {
      "transformers-cache": {
        [`${hub}/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx`]: 3000,
        [`${hub}/onnx-community/whisper-base/resolve/main/config.json`]: 200,
        [`${hub}/onnx-community/whisper-base.en/resolve/main/config.json`]: 50, // a longer name: another model
        [`${hub}/onnx-community/whisper-small/resolve/main/config.json`]: 70,
      },
      other: { [`${hub}/onnx-community/whisper-base/resolve/main/tokenizer.json`]: 800, "https://example.invalid/app.js": 5 },
    };
    expect(await removeCachedModel("onnx-community/whisper-base", fakeCaches(content))).toEqual({ files: 3, bytes: 4000 });
    expect(Object.keys(content["transformers-cache"])).toEqual([`${hub}/onnx-community/whisper-base.en/resolve/main/config.json`, `${hub}/onnx-community/whisper-small/resolve/main/config.json`]);
    expect(Object.keys(content.other)).toEqual(["https://example.invalid/app.js"]);
    // nothing left of it: a second delete finds nothing
    expect(await removeCachedModel("onnx-community/whisper-base", fakeCaches(content))).toEqual({ files: 0, bytes: 0 });
  });

  it("an empty name or no Cache API deletes nothing", async () => {
    const content = { c: { "https://huggingface.co/a/b/resolve/main/x": 1 } };
    expect(await removeCachedModel("", fakeCaches(content))).toEqual({ files: 0, bytes: 0 });
    expect(await removeCachedModel("a/b", undefined)).toEqual({ files: 0, bytes: 0 });
    expect(Object.keys(content.c)).toHaveLength(1);
  });
});
