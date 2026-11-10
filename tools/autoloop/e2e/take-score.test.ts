import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { takeChecks } from "./take-score.mjs";

type Check = { id: string; weight: number; credit: number; detail: string };
const NOW = Date.parse("2026-11-10T12:00:00Z");
const at = (hoursAgo = 1) => new Date(NOW - hoursAgo * 3.6e6).toISOString();
const points = (done: number) => ["a", "b", "c"].map((text, i) => ({ text, doneAtMs: i < done ? 20_000 * (i + 1) : null }));
// The voice: point 1's paraphrase, the off-topic sentence, points 2 and 3, looped every 51 s.
const LOOP = 51_000;
const edges = (loops = 1) => Array.from({ length: loops }, (_, k) => [10_000, 25_000, 35_000, 55_000].map((t, line) => ({ line, atMs: t + k * LOOP }))).flat();
const run = (over: Record<string, unknown> = {}) => ({
  at: at(), offline: false, points: points(3), timeToAllDoneMs: 60_000, stillRecording: true, recordingAtMs: 4000, errors: [], pageErrors: [],
  audio: { seconds: 51, lineOfPoint: [0, 2, 3], offTopicLine: 1 }, heard: { edges: edges() },
  offlineSeen: { preload: false, server: false, chip: false }, takeMs: 70_000,
  stt: { backend: "sherpa", firstTranscriptMs: 6000 }, decide: { ok: 6, allLocal: true, models: { "clef-flash (local)": 6 }, lastAtMs: 62_000 }, appExit: null, devtoolsClosed: false,
  network: { samples: 118, loopbackSeen: 25, selfLan: 4, outbound: 0, outboundSeen: [], peers: ["ollama.exe#1 :11434"], peerOutbound: 0, peerOutboundSeen: [],
    netLog: { events: 4500, externalUrls: [], externalTcp: [], udpRouteProbes: ["[2001:4860:4860::8888]:443"] },
    serverSockets: { lines: 40, local: 40, pipes: 0, unreadable: 0, external: [] } },
  ...over,
});
const offline = (over: Record<string, unknown> = {}) => run({ offline: true, offlineSeen: { preload: true, server: true, chip: true }, ...over });
const net = (over: Record<string, unknown>) => ({ ...run().network, ...over });
const memory = (over: Record<string, unknown> = {}) => ({
  minutes: 20, samples: 120, cycles: 22, startMB: 900, endMB: 950, maxMB: 980, privateStartMB: 500, privateEndMB: 1260, warmupMin: 10, growthAfterWarmupPct: 3, ...over,
});
// 20-minute rehearsal: after each Reset every point ticks again from its paraphrase said again.
const passes = (n: number) => Array.from({ length: n }, (_, k) => ({ startMs: k ? 60_500 + (k - 1) * LOOP : 0, done: [20_000, 40_000, 60_000].map((t) => t + k * LOOP) }));
const longTake = (over: Record<string, unknown> = {}) =>
  run({ takeMs: 1_200_000, decide: { ok: 600, allLocal: true, models: { "clef-flash (local)": 600 }, lastAtMs: 1_195_000 }, heard: { edges: edges(24) }, cycles: passes(22), memory: memory(), ...over });
const credit = (all: unknown, prefix: string) => (takeChecks(all, NOW) as Check[]).find((c) => c.id.startsWith(prefix))!;

describe("take checks", () => {
  it("fail when there is no take.json or it is older than 48 hours", () => {
    for (const c of takeChecks(null, NOW) as Check[]) expect(c.credit).toBe(0);
    const old = { local: run({ at: at(49) }), offline: offline({ at: at(49) }), memory: longTake({ at: at(49) }) };
    for (const c of takeChecks(old, NOW) as Check[]) { expect(c.credit).toBe(0); expect(c.detail).toMatch(/older than 48 h/); }
  });

  it("TST-02: full credit only for a local take (sherpa + local decisions) that ticked every point after speech", () => {
    expect(credit({ local: run() }, "TST-02").credit).toBe(1);
    expect(credit({ local: run() }, "TST-02").detail).toContain("the off-topic sentence ticked nothing");
    expect(credit({ local: run({ points: points(2) }) }, "TST-02").credit).toBeCloseTo(2 / 3);
    expect(credit({ local: run({ stt: { backend: "whisper", firstTranscriptMs: 6000 } }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ decide: { ok: 6, allLocal: false, models: { openrouter: 6 } } }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ appExit: { code: 3221225477 } }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ recordingAtMs: null }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ errors: ["points not all waiting before Start"] }) }, "TST-02").credit).toBe(0);
    // ticked before a single word was heard: not ticked by speech
    expect(credit({ local: run({ stt: { backend: "sherpa", firstTranscriptMs: 30_000 } }) }, "TST-02").credit).toBeCloseTo(2 / 3);
    expect(credit({ local: run({ stt: { backend: "sherpa", firstTranscriptMs: null } }) }, "TST-02").credit).toBe(0);
  });

  it("TST-02: a point counts only after its own paraphrase; the off-topic sentence must tick nothing (negative control)", () => {
    // review mutant: every point done 1 ms after the first word, with only the off-topic sentence on screen
    const early = run({ points: ["a", "b", "c"].map((text) => ({ text, doneAtMs: 6001 })), heard: { edges: [{ line: 1, atMs: 6000 }] } });
    expect(credit({ local: early }, "TST-02").credit).toBe(0);
    // points 2 and 3 ticked while the off-topic sentence was on screen, before their own lines
    const offTopic = run({ points: [20_000, 26_000, 27_000].map((doneAtMs, i) => ({ text: "abc"[i], doneAtMs })) });
    const c = credit({ local: offTopic }, "TST-02");
    expect(c.credit).toBeCloseTo(1 / 3);
    expect(c.detail).toMatch(/before their own paraphrase/);
    // the off-topic sentence never showed: the control did not run, so nothing can be judged
    expect(credit({ local: run({ heard: { edges: edges().filter((e) => e.line !== 1) } }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ heard: undefined }) }, "TST-02").credit).toBe(0);
    expect(credit({ local: run({ audio: { seconds: 51 } }) }, "TST-02").detail).toMatch(/which line speaks which point/);
  });

  it("errors on the page fail a take", () => {
    const c = credit({ local: run({ pageErrors: ["slow model: 1100 ms per call"] }) }, "TST-02");
    expect(c.credit).toBe(0);
    expect(c.detail).toContain("slow model");
    expect(credit({ local: run({ pageErrors: undefined }) }, "TST-02").credit).toBe(0);
    expect(credit({ offline: offline({ pageErrors: ["boom"] }) }, "PR-01").credit).toBe(0.5);
    expect(credit({ memory: longTake({ pageErrors: ["boom"] }) }, "PERF-02").credit).toBe(0);
  });

  it("PR-01: offline, a take that ran, a probe that saw connections, and nothing leaving by netstat or net log", () => {
    expect(credit({ offline: offline() }, "PR-01").credit).toBe(1);
    expect(credit({ offline: run() }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ recordingAtMs: null }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ loopbackSeen: 0 }) }) }, "PR-01").credit).toBe(0);
    const leak = credit({ offline: offline({ network: net({ outbound: 1, outboundSeen: ["TCP 10.0.0.2:5 1.2.3.4:443 ESTABLISHED Filow.exe#1"] }) }) }, "PR-01");
    expect(leak.credit).toBe(0);
    expect(leak.detail).toContain("1.2.3.4:443");
    const viaPeer = credit({ offline: offline({ network: net({ peerOutbound: 1, peerOutboundSeen: ["TCP x 5.6.7.8:443 ESTABLISHED proxy.exe#9"] }) }) }, "PR-01");
    expect(viaPeer.credit).toBe(0);
    expect(viaPeer.detail).toContain("proxy.exe");
    expect(credit({ offline: offline({ network: net({ netLog: { events: 10, externalUrls: ["https://example.com"], externalTcp: [] } }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ netLog: { events: 10, externalUrls: [], externalTcp: ["9.9.9.9:443"] } }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ netLog: { error: "ENOENT" } }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ points: points(0) }) }, "PR-01").credit).toBe(0.5);
  });

  it("PR-01: needs 5 netstat samples or more", () => {
    expect(credit({ offline: offline({ network: net({ samples: 4 }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ samples: 5 }) }) }, "PR-01").credit).toBe(1);
  });

  it("PR-01: offline mode must show in the app itself, not only in how the probe was launched", () => {
    // review mutant: the online run relabelled offline:true
    expect(credit({ offline: run({ offline: true }) }, "PR-01").credit).toBe(0);
    for (const k of ["preload", "server", "chip"]) {
      const c = credit({ offline: offline({ offlineSeen: { preload: true, server: true, chip: true, [k]: false } }) }, "PR-01");
      expect(c.credit).toBe(0);
      expect(c.detail).toMatch(/did not show offline mode/);
    }
  });

  it("PR-01: every connection the server side opened is audited, however short", () => {
    const leak = credit({ offline: offline({ network: net({ serverSockets: { lines: 41, local: 40, external: ["api.openai.com:443"] } }) }) }, "PR-01");
    expect(leak.credit).toBe(0);
    expect(leak.detail).toContain("server socket to api.openai.com:443");
    expect(credit({ offline: offline({ network: net({ serverSockets: { file: "x", error: "ENOENT" } }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ serverSockets: { lines: 0, local: 0, external: [] } }) }) }, "PR-01").credit).toBe(0);
    expect(credit({ offline: offline({ network: net({ serverSockets: undefined }) }) }, "PR-01").credit).toBe(0);
  });

  it("PERF-02: growth after the warm-up within 10% during a live take, credit scaled to the 45-minute standard", () => {
    expect(credit({ memory: longTake() }, "PERF-02").credit).toBeCloseTo(20 / 45);
    expect(credit({ memory: longTake({ memory: memory({ minutes: 45, samples: 270 }) }) }, "PERF-02").credit).toBe(1);
    expect(credit({ memory: longTake({ memory: memory({ growthAfterWarmupPct: 15 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ memory: memory({ minutes: 10, samples: 60 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ memory: memory({ samples: 40 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ appExit: { code: 1 } }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ stillRecording: false }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ devtoolsClosed: true }) }, "PERF-02").credit).toBe(0);
  });

  it("PERF-02: only a live local take counts (review mutants: a dead take, a cloud take)", () => {
    const dead = longTake({ stt: { backend: null, firstTranscriptMs: null }, decide: { ok: 0, allLocal: false, models: {}, lastAtMs: null }, points: points(0), recordingAtMs: null, cycles: [] });
    expect(credit({ memory: dead }, "PERF-02").credit).toBe(0);
    const cloud = longTake({ stt: { backend: "other", firstTranscriptMs: 6000 }, decide: { ok: 600, allLocal: false, models: { "openrouter/x": 600 }, lastAtMs: 1_195_000 } });
    expect(credit({ memory: cloud }, "PERF-02").detail).toMatch(/not a live local take/);
    expect(credit({ memory: cloud }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ points: points(0) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ recordingAtMs: null }) }, "PERF-02").credit).toBe(0);
  });

  it("PERF-02: the take keeps deciding to the end, and each Reset pass ticks from speech said again", () => {
    const idle = credit({ memory: longTake({ decide: { ok: 20, allLocal: true, models: { "clef-flash (local)": 20 }, lastAtMs: 60_000 } }) }, "PERF-02");
    expect(idle.credit).toBe(0);
    expect(idle.detail).toMatch(/went idle/);
    // the review's finding 1: after every Reset all points ticked again within 2 s from the old words
    const bug = passes(22).map((p, k) => (k ? { startMs: p.startMs, done: [1000, 1500, 1900].map((d) => p.startMs + d) } : p));
    const stale = credit({ memory: longTake({ cycles: bug }) }, "PERF-02");
    expect(stale.credit).toBe(0);
    expect(stale.detail).toMatch(/1\/22 passes ticked from speech said again/);
    // one odd pass in 22 is tolerated, three are not
    const oneOff = passes(22).map((p, k) => (k === 5 ? { ...p, done: [p.startMs + 100, ...p.done.slice(1)] } : p));
    expect(credit({ memory: longTake({ cycles: oneOff }) }, "PERF-02").credit).toBeCloseTo(20 / 45);
    const threeOff = passes(22).map((p, k) => (k % 7 === 6 ? { ...p, done: [p.startMs + 100, ...p.done.slice(1)] } : p));
    expect(credit({ memory: longTake({ cycles: threeOff }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: longTake({ cycles: passes(1) }) }, "PERF-02").credit).toBe(0);
  });
});
