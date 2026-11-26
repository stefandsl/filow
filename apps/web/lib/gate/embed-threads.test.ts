import { afterEach, expect, it, vi } from "vitest";

const options = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" };

function mockTransformers() {
  const wasm: Record<string, unknown> = {};
  const pipeline = vi.fn().mockResolvedValue(vi.fn());
  vi.doMock("@huggingface/transformers", () => ({ env: { backends: { onnx: { wasm } } }, pipeline }));
  return { wasm, pipeline };
}

afterEach(() => {
  vi.doUnmock("@huggingface/transformers");
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads the browser gate with one WASM thread and a sequential session", async () => {
  const { wasm, pipeline } = mockTransformers();
  vi.stubGlobal("self", { postMessage: vi.fn() });
  await import("./embed.worker");
  await self.onmessage?.call(self, new MessageEvent("message", { data: { type: "load", model: "fixture" } }));
  expect(wasm.numThreads).toBe(1);
  expect(pipeline).toHaveBeenCalledWith("feature-extraction", "fixture", expect.objectContaining({ session_options: options }));
});

it("loads the Node gate with a single-threaded sequential session", async () => {
  const { pipeline } = mockTransformers();
  const { loadEmbedder } = await import("./embedder");
  await loadEmbedder();
  expect(pipeline).toHaveBeenCalledWith("feature-extraction", expect.any(String), expect.objectContaining({ session_options: options }));
});
