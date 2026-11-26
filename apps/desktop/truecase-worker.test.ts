import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("opens one sequential punctuation session regardless of host thread count", async () => {
  const create = vi.fn().mockResolvedValue({});
  const modules: Record<string, unknown> = {
    "onnxruntime-node": { InferenceSession: { create } },
    "@huggingface/tokenizers": { Tokenizer: class {} },
    "node:fs": { readFileSync: () => "{}" },
    "node:path": path,
  };
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const source = readFileSync(new URL("./truecase-worker.js", import.meta.url), "utf8");
  runInNewContext(source, { process: { parentPort: port }, require: (name: string) => modules[name] });
  port.emit("message", { data: { type: "init", dir: "fixture", threads: 4 } });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ready" })));
  expect(create).toHaveBeenCalledWith(path.join("fixture", "model_quantized.onnx"), {
    executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential",
  });
});
