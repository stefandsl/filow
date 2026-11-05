import { describe, expect, it } from "vitest";
import { detectSilence, type SilenceState } from "./silence";

function sequence(samples: [number, number][], start = 0) {
  let state: SilenceState = { lastAudioAt: start, silent: false };
  return samples.map(([peak, at]) => { state = detectSilence(state, peak, at); return state.silent; });
}
describe("capture silence detector", () => {
  it("requires four continuous seconds at or below the inclusive threshold", () => {
    expect(sequence([[0, 0], [1e-4, 2000], [0, 3999], [1e-4, 4000], [0, 6000]])).toEqual([false, false, false, true, true]);
  });
  it("clears immediately on audio and restarts the full grace period", () => {
    expect(sequence([[0, 4000], [0.057, 4100], [0, 8000], [0, 8099], [0, 8100]])).toEqual([true, false, false, false, true]);
  });
  it("does not accumulate separate silence intervals or depend on wall-clock origin", () => {
    expect(sequence([[0, 13000], [0.000101, 13999], [0, 17000], [0.057, 17500]], 10000)).toEqual([false, false, false, false]);
  });
  it("detects a graph that never emits any chunks using timer samples", () => {
    expect(sequence([[0, 4000]])).toEqual([true]);
  });
});
