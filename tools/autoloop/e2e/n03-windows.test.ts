import assert from "node:assert/strict";
// The operator can check the scorer beside a packaged build with Node alone.
const { describe, it } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { cases, recovered, score } from "./n03-windows.mjs";

const sha = "c".repeat(40);
function trial(kind: string) {
  const before = { main: 10, worker: 20, renderer: 30, relay: "listening" };
  const down = { ...before, [kind]: kind === "relay" ? "closed" : null };
  const after = { ...before, [kind]: kind === "relay" ? "listening" : 40 };
  const place = { current: "s1b1", done: ["s1b0"], reopened: ["s0b1"], openTracks: 0, pendingExecuted: 0 };
  return { kind, before, down, after, faultAt: 100, desktopAt: 110, phoneAt: 120, continuedAt: 140,
    desktop: place, phone: place, continuation: { desktop: "s1b2", phone: "s1b2", executions: 1 } };
}
function fixture() {
  const clips = ["noise", "point", "digress", "correction", "near", "alias", "resume"].map((label, i) => {
    const points = ["s0b0", "s0b1", "s0b2"].map((id, j) => [id, i >= [1, 5, 6][j] ? "done" : "waiting"]);
    return { label, points, phonePoints: structuredClone(points), words: [{ committed: label === "noise" ? "" : "final words" }],
      paced: { chunks: 80, ms: 8000 }, sha256: cases.journeys.en.clips[label].sha256 };
  });
  return { lang: "en", manifest: { sha, sha512: "f".repeat(128) }, clips, faults: ["worker", "relay", "renderer", "main"].map(trial) };
}
describe("N-03 Windows capture scoring", () => {
  it("accepts the labelled trace with all four observed recoveries", () => assert.deepEqual(score(fixture(), sha).issues, []));
  it("rejects an extra tick even when the intended point was covered", () => {
    const r = fixture();
    r.clips[1].points[2][1] = "done";
    assert.ok(score(r, sha).issues.includes("points/point/state"));
  });
  it("rejects a hint left on either surface after the corrected final", () => {
    const r = fixture();
    const correction = r.clips.find(c => c.label === "correction")!;
    correction.points[2][1] = "active";
    correction.phonePoints[2][1] = "active";
    const result = score(r, sha);
    assert.ok(result.issues.includes("points/correction/hint"));
    assert.ok(result.issues.includes("phonePoints/correction/hint"));
  });
  it("compares tentative states on paired rows as well as done states", () => {
    const r = fixture();
    r.clips[2].phonePoints[1][1] = "active";
    assert.ok(score(r, sha).issues.includes("digress/s0b1/surfaces"));
  });
  it("rejects a missing phone surface and zero noise opportunities", () => {
    const r = fixture();
    r.clips[0].phonePoints = [];
    r.clips[0].paced.chunks = 0;
    const result = score(r, sha);
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.metrics.phonePoints.noise.opportunities, 0);
    assert.equal(result.metrics.points.noise.opportunities, 0);
  });
  it("rejects a peer disconnect when the relay listener was still up", () => {
    const t = trial("relay");
    t.down.relay = "listening";
    assert.equal(recovered(t), false);
    assert.equal(recovered(trial("relay")), true);
  });
});
