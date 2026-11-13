import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Payload = { run?: unknown; kind?: unknown; end?: unknown; marks?: Record<string, unknown> };
const { timingsLine, timingsT0, MARKS } = require("./okfilow-timings.js") as {
  timingsLine: (p: Payload, own?: { releaseAt?: number | null; stopAt?: number | null }) => string;
  timingsT0: (p: Payload, own?: { releaseAt?: number | null; stopAt?: number | null }) => number | null;
  MARKS: string[];
};

describe("okfilow timings line (the speed baseline's panel marks in startup.log)", () => {
  it("measures a spoken question from main's own key release, in whole milliseconds and in a fixed order", () => {
    const line = timingsLine(
      { run: 7, kind: "voice", end: "done", marks: { voice: 5790.4, micOpen: -1410, release: 999, heard: 1300, mark: 4990 } },
      { releaseAt: 1000 },
    );
    expect(line).toBe("okfilow: timings run 7 voice done t0 1000: micOpen -2410, release 0, heard 300, voice 4790, mark 3990 ms");
  });

  it("measures a typed question from `asked`, the warm-up from `warmStart` and a stopped answer from main's Stop", () => {
    expect(timingsT0({ kind: "typed", marks: { asked: 50 } })).toBe(50);
    expect(timingsT0({ kind: "warm", marks: { warmStart: 70 } })).toBe(70);
    expect(timingsT0({ kind: "typed", end: "stopped", marks: { asked: 50 } }, { stopAt: 900 })).toBe(900);
    expect(timingsLine({ run: 3, kind: "typed", end: "stopped", marks: { asked: 100, stopHeard: 905, silent: 930, afterStop: 0 } }, { stopAt: 900 }))
      .toBe("okfilow: timings run 3 typed stopped t0 900: asked -800, stopAt 0, stopHeard 5, silent 30 ms; afterStop 0");
    expect(timingsLine({ run: "-", kind: "warm", end: "done", marks: { warmStart: 10, warmEnd: 2510 } })).toBe("okfilow: timings run - warm done t0 10: warmStart 0, warmEnd 2500 ms");
  });

  it("writes nothing without a time to measure from", () => {
    expect(timingsLine({ run: 1, kind: "typed", end: "done", marks: { fetchStart: 5 } })).toBe("");
    expect(timingsLine(null as unknown as Payload)).toBe("");
  });

  it("never lets a word through: strings, unknown names, non-finite values, odd runs, kinds and ends are dropped", () => {
    const line = timingsLine({
      run: "7; QUOKKA",
      kind: "QUOKKA",
      end: "Where is QUOKKA-4417?",
      marks: { asked: 0, text: "QUOKKA-4417" as unknown as number, question: 12, fetchStart: Number.NaN, firstToken: Number.POSITIVE_INFINITY, captured: { valueOf: () => 3 } as unknown as number, heard: 40, afterStop: "2" as unknown as number },
    });
    expect(line).toBe("okfilow: timings run - typed error t0 0: heard 40, asked 0 ms");
    expect(line).not.toMatch(/QUOKKA|question|NaN|Infinity/);
  });

  it("keeps the grounding run id and lists every mark the panel takes", () => {
    expect(timingsLine({ run: "12g", kind: "typed", end: "done", marks: { asked: 1 } })).toMatch(/^okfilow: timings run 12g typed done /);
    for (const m of ["micOpen", "release", "sttStop", "sttLast", "heard", "asked", "agentChecked", "captured", "recipients", "fetchStart", "firstToken", "text", "sentence", "synth", "voice", "mark", "stopAt", "stopHeard", "silent", "warmStart", "warmEnd"]) expect(MARKS).toContain(m);
  });
});
