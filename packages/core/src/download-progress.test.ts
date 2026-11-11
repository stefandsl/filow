import { describe, expect, it } from "vitest";
import { createDownloadProgress } from "./download-progress";

describe("one progress per model (issue #4)", () => {
  it("interleaved file events give one number that never goes down", () => {
    const p = createDownloadProgress();
    const MB = 1024 * 1024;
    // Two files downloading in parallel, events alternating like the screen recording on the laptop.
    const events = [
      { status: "initiate", file: "config.json" },
      { status: "progress", file: "decoder_model_merged.onnx", loaded: 15 * MB, total: 100 * MB },
      { status: "progress", file: "encoder_model.onnx", loaded: 27 * MB, total: 100 * MB },
      { status: "progress", file: "decoder_model_merged.onnx", loaded: 16 * MB, total: 100 * MB },
      { status: "progress", file: "encoder_model.onnx", loaded: 28 * MB, total: 100 * MB },
      // A small file whose size becomes known late: it would pull the share down, the number must not.
      { status: "progress", file: "tokenizer.json", loaded: 0, total: 2 * MB },
      { status: "progress", file: "decoder_model_merged.onnx", loaded: 60 * MB, total: 100 * MB },
      { status: "done", file: "tokenizer.json" },
      { status: "progress", file: "encoder_model.onnx", loaded: 100 * MB, total: 100 * MB },
      { status: "progress", file: "decoder_model_merged.onnx", loaded: 100 * MB, total: 100 * MB },
    ];
    const seen = events.map((e) => p.update(e));
    expect(seen[0]).toBeNull();
    const nums = seen.filter((n): n is number => n !== null);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]);
    // bytes over bytes: (16 + 28) / 200 = 22%, not the last file's 28% or 16%
    expect(seen[4]).toBe(22);
    expect(nums.at(-1)).toBe(100);
  });

  it("Ollama pull layers (digests) add up the same way, and a restarted layer does not move it back", () => {
    const p = createDownloadProgress();
    expect(p.update({ status: "pulling manifest" })).toBeNull();
    expect(p.update({ status: "pulling aaa", file: "aaa", loaded: 50, total: 100 })).toBe(50);
    expect(p.update({ status: "pulling bbb", file: "bbb", loaded: 0, total: 100 })).toBe(50);
    expect(p.update({ status: "pulling aaa", file: "aaa", loaded: 10, total: 100 })).toBe(50);
    expect(p.update({ status: "pulling bbb", file: "bbb", loaded: 100, total: 100 })).toBe(75);
    expect(p.value()).toBe(75);
  });

  it("follows transformers.js's own total when it sends one: a small file finished first is not 100%", () => {
    const p = createDownloadProgress();
    const all = 200;
    // the library knows every size up front: config.json (1) is done, the two models are just starting
    expect(p.update({ status: "progress", file: "config.json", loaded: 1, total: 1 })).toBe(100);
    const q = createDownloadProgress();
    expect(q.update({ status: "progress_total", loaded: 1, total: all })).toBe(0);
    expect(q.update({ status: "progress", file: "config.json", loaded: 1, total: 1 })).toBe(0);
    expect(q.update({ status: "progress_total", loaded: 45, total: all })).toBe(22);
    expect(q.update({ status: "progress", file: "encoder_model.onnx", loaded: 44, total: 100 })).toBe(22);
    expect(q.update({ status: "progress_total", loaded: all, total: all })).toBe(100);
  });

  it("ignores junk sizes", () => {
    const p = createDownloadProgress();
    expect(p.update({ file: "x", loaded: 5, total: 0 })).toBeNull();
    expect(p.update({ file: "x", loaded: Number.NaN, total: Number.NaN })).toBeNull();
    expect(p.update({ file: "x", loaded: 500, total: 100 })).toBe(100);
  });
});
