import { expect, it, vi } from "vitest";

it("shares one WASM thread across live Whisper sessions and selects sequential execution", async () => {
  const wasm: Record<string, unknown> = {};
  const pipeline = vi.fn(async () => vi.fn());
  vi.doMock("@huggingface/transformers", () => ({ env: { backends: { onnx: { wasm } } }, pipeline }));
  const worker = { onmessage: undefined as unknown as (event: unknown) => Promise<void>, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  try {
    await import("./whisper.worker");
    await worker.onmessage({ data: { type: "load", model: "test-whisper" } });
    expect(wasm.numThreads).toBe(1);
    expect(pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "test-whisper", expect.objectContaining({
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" },
    }));
  } finally {
    vi.doUnmock("@huggingface/transformers");
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
