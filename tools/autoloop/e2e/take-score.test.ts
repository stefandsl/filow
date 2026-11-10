import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { takeChecks } from "./take-score.mjs";

type Check = { id: string; weight: number; credit: number; detail: string };
const NOW = Date.parse("2026-11-10T12:00:00Z");
const at = (hoursAgo = 1) => new Date(NOW - hoursAgo * 3.6e6).toISOString();
const points = (done: number) => ["a", "b", "c"].map((text, i) => ({ text, doneAtMs: i < done ? 20_000 * (i + 1) : null }));
const run = (over: Record<string, unknown> = {}) => ({
  at: at(), offline: false, points: points(3), timeToAllDoneMs: 60_000, stillRecording: true, recordingAtMs: 4000, errors: [],
  stt: { backend: "sherpa", firstTranscriptMs: 6000 }, decide: { ok: 6, allLocal: true, models: { "clef-flash (local)": 6 } }, appExit: null, devtoolsClosed: false,
  network: { samples: 118, loopbackSeen: 25, selfLan: 4, outbound: 0, outboundSeen: [], peers: ["ollama.exe#1 :11434"], peerOutbound: 0, peerOutboundSeen: [],
    netLog: { events: 4500, externalUrls: [], externalTcp: [], udpRouteProbes: ["[2001:4860:4860::8888]:443"] } },
  ...over,
});
const offline = (over: Record<string, unknown> = {}) => run({ offline: true, ...over });
const net = (over: Record<string, unknown>) => ({ ...run().network, ...over });
const memory = (over: Record<string, unknown> = {}) => ({
  minutes: 20, samples: 120, cycles: 22, startMB: 900, endMB: 950, maxMB: 980, privateStartMB: 500, privateEndMB: 1260, warmupMin: 10, growthAfterWarmupPct: 3, ...over,
});
const credit = (all: unknown, prefix: string) => (takeChecks(all, NOW) as Check[]).find((c) => c.id.startsWith(prefix))!;

describe("take checks", () => {
  it("fail when there is no take.json or it is older than 48 hours", () => {
    for (const c of takeChecks(null, NOW) as Check[]) expect(c.credit).toBe(0);
    const old = { local: run({ at: at(49) }), offline: offline({ at: at(49) }), memory: run({ at: at(49), memory: memory() }) };
    for (const c of takeChecks(old, NOW) as Check[]) { expect(c.credit).toBe(0); expect(c.detail).toMatch(/older than 48 h/); }
  });

  it("TST-02: full credit only for a local take (sherpa + local decisions) that ticked every point after speech", () => {
    expect(credit({ local: run() }, "TST-02").credit).toBe(1);
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

  it("PERF-02: growth after the warm-up within 10% during a live take, credit scaled to the 45-minute standard", () => {
    expect(credit({ memory: run({ memory: memory() }) }, "PERF-02").credit).toBeCloseTo(20 / 45);
    expect(credit({ memory: run({ memory: memory({ minutes: 45, samples: 270 }) }) }, "PERF-02").credit).toBe(1);
    expect(credit({ memory: run({ memory: memory({ growthAfterWarmupPct: 15 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: run({ memory: memory({ minutes: 10, samples: 60 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: run({ memory: memory({ samples: 40 }) }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: run({ appExit: { code: 1 }, memory: memory() }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: run({ stillRecording: false, memory: memory() }) }, "PERF-02").credit).toBe(0);
    expect(credit({ memory: run({ devtoolsClosed: true, memory: memory() }) }, "PERF-02").credit).toBe(0);
  });
});
