import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Facts = { ms: number; state: "live" | "late" | "waiting"; fallback: boolean };
const { qaMicDelay, QA_MIC_DELAY_MAX_MS, MIC_SLOW_LOG_MS, micOpenFacts, micOpenLine, createMicOpens } = require("./okfilow-mic.js") as {
  qaMicDelay(v: unknown): number;
  QA_MIC_DELAY_MAX_MS: number;
  MIC_SLOW_LOG_MS: number;
  micOpenFacts(payload: unknown): Facts | null;
  micOpenLine(facts: Facts | null): string;
  createMicOpens(): { note(payload: unknown): string; report(): string };
};
const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("the QA switch that makes the microphone late", () => {
  it("whole milliseconds, nothing for anything else, a minute at most", () => {
    expect(qaMicDelay("15000")).toBe(15000);
    expect(qaMicDelay("3000.4")).toBe(3000);
    expect(qaMicDelay("")).toBe(0);
    expect(qaMicDelay(undefined)).toBe(0);
    expect(qaMicDelay("abc")).toBe(0);
    expect(qaMicDelay("-5")).toBe(0);
    expect(qaMicDelay("999999999")).toBe(QA_MIC_DELAY_MAX_MS);
  });
  it("is read behind the QA build gate only, and reaches the panel only when set", () => {
    const main = source("okfilow.js");
    expect(main).toContain('const QA_MIC_DELAY = qaMicDelay(QA_ALLOWED ? process.env.FILOW_OKF_QA_MIC_DELAY : "");');
    expect(main).toContain("...(QA_MIC_DELAY ? { qaMicDelayMs: QA_MIC_DELAY } : {})");
    expect(main.match(/FILOW_OKF_QA_MIC_DELAY/g)?.length).toBe(2); // its comment and the one read
  });
});

describe("what the panel says about an open, as main keeps it", () => {
  it("numbers and fixed words only: anything else in the payload is dropped", () => {
    expect(micOpenFacts({ ms: 15100.4, state: "late", fallback: true, label: "Jabra of Marco", text: "hello" })).toEqual({ ms: 15100, state: "late", fallback: true });
    expect(micOpenFacts({ ms: 85 })).toEqual({ ms: 85, state: "live", fallback: false });
    expect(micOpenFacts({ ms: 85, state: "something else", fallback: "yes" })).toEqual({ ms: 85, state: "live", fallback: false });
    for (const bad of [null, undefined, "15100", {}, { ms: "15100" }, { ms: NaN }, { ms: -1 }, { ms: Infinity }]) expect(micOpenFacts(bad)).toBeNull();
    // a clock that jumped: never a number nobody can believe
    expect(micOpenFacts({ ms: 99 * 60 * 60 * 1000 })?.ms).toBe(10 * 60 * 1000);
  });

  it("one log line for every open over a second, with the time in ms; none for a quick one", () => {
    expect(micOpenLine(micOpenFacts({ ms: 15100, state: "live" }))).toBe("okfilow: microphone opened in 15100 ms");
    expect(micOpenLine(micOpenFacts({ ms: MIC_SLOW_LOG_MS + 1, state: "live" }))).toBe(`okfilow: microphone opened in ${MIC_SLOW_LOG_MS + 1} ms`);
    expect(micOpenLine(micOpenFacts({ ms: MIC_SLOW_LOG_MS, state: "live" }))).toBe("");
    expect(micOpenLine(micOpenFacts({ ms: 85, state: "live" }))).toBe("");
    expect(micOpenLine(null)).toBe("");
  });

  it("says when the open came too late to record anything, and when it had not come at all", () => {
    expect(micOpenLine(micOpenFacts({ ms: 15100, state: "late" }))).toBe("okfilow: microphone opened in 15100 ms, after the keys went up: nothing was recorded");
    expect(micOpenLine(micOpenFacts({ ms: 3004, state: "waiting" }))).toBe("okfilow: microphone still not open after 3004 ms: nothing was recorded");
    // Escape during a quick open is nobody's problem
    expect(micOpenLine(micOpenFacts({ ms: 300, state: "late" }))).toBe("");
    expect(micOpenLine(micOpenFacts({ ms: 300, state: "waiting" }))).toBe("");
  });

  it("a saved microphone that is gone is logged whatever the time", () => {
    expect(micOpenLine(micOpenFacts({ ms: 85, state: "live", fallback: true }))).toBe("okfilow: microphone opened in 85 ms (the saved microphone is not connected: the default one is used)");
    expect(micOpenLine(micOpenFacts({ ms: 2000, state: "live", fallback: true }))).toBe("okfilow: microphone opened in 2000 ms (the saved microphone is not connected: the default one is used)");
  });

  it("keeps the count, the last and the slowest open for Report a problem", () => {
    const m = createMicOpens();
    expect(m.report()).toBe("not opened since Filow started");
    expect(m.note({ ms: 85, state: "live" })).toBe("");
    expect(m.report()).toBe("opened 1 time since Filow started: last in 85 ms, slowest 85 ms");
    expect(m.note({ ms: 15100, state: "live" })).toBe("okfilow: microphone opened in 15100 ms");
    m.note({ ms: 120, state: "live" });
    expect(m.report()).toBe("opened 3 times since Filow started: last in 120 ms, slowest 15100 ms, 1 over 1 s");
    // an abandoned wait is not an open, but it is the story of the problem
    m.note({ ms: 3004, state: "waiting" });
    m.note({ ms: 15080, state: "late" });
    expect(m.report()).toBe("opened 4 times since Filow started: last in 15080 ms, slowest 15100 ms, 2 over 1 s, 1 too late to record anything");
    m.note({ ms: 90, state: "live", fallback: true });
    expect(m.report()).toBe("opened 5 times since Filow started: last in 90 ms, slowest 15100 ms, 2 over 1 s, 1 too late to record anything; the saved microphone is not connected, the default one is used");
    m.note({ ms: 90, state: "live" });
    expect(m.report()).not.toContain("saved microphone");
    // garbage changes nothing
    expect(m.note({ ms: "soon" })).toBe("");
    expect(m.report()).toContain("opened 6 times");
  });
});

describe("wiring (okfilow.js, the preload, main.js)", () => {
  it("only OK Filow's own windows can report an open, and the line goes to the log", () => {
    const main = source("okfilow.js");
    expect(main).toMatch(/ipcMain\.on\("okfilow:mic", \(e, payload\) => \{\s*if \(!ourSender\(e\)\) return;\s*const line = micOpens\.note\(payload\);\s*if \(line\) logLine\(line\);/);
    expect(source("okfilow-preload.js")).toContain('micOpened: (payload) => ipcRenderer.send("okfilow:mic", payload),');
  });
  it("Report a problem carries the microphone's open times", () => {
    const main = source("okfilow.js");
    expect(main).toMatch(/micReport: \(\) => micOpens\.report\(\)/);
    expect(source("main.js")).toMatch(/mic = `\$\{mic\}; \$\{okFilow\.micReport\(\)\}`/);
  });
  it("is in the package", () => {
    expect(JSON.parse(source("package.json")).build.files).toContain("okfilow-mic.js");
  });
});

// 13 Nov, installed 0.9.37: talk:end, talk:start 0.75 s later, then the first recording's "I didn't catch
// that" arrived with the keys down again and ended the new hold; its talk:end was dropped and the
// microphone stayed open for 14 s with the keys up.
describe("keys up always ends the capture", () => {
  const { errorEndsHold, createCaptureWatch, CAPTURE_GRACE_MS } = require("./okfilow-mic.js") as {
    errorEndsHold(o: { held: boolean; begun: boolean }): boolean;
    createCaptureWatch(o?: { graceMs?: number; now?: () => number }): { frame(allowed: boolean): boolean; reset(): void };
    CAPTURE_GRACE_MS: number;
  };
  const main = source("okfilow.js");

  it("an error left over from the recording before does not end the hold of the keys that are down now", () => {
    expect(errorEndsHold({ held: true, begun: false })).toBe(false);
    // the panel began to listen for this press and failed (no model, microphone refused): the hold ends
    expect(errorEndsHold({ held: true, begun: true })).toBe(true);
    expect(errorEndsHold({ held: false, begun: true })).toBe(false);
  });
  it("main applies it: a press starts unbegun, opening or listening begins it, and only then an error ends the hold", () => {
    const press = main.slice(main.indexOf("function press(kind"), main.indexOf("function release()"));
    expect(press).toMatch(/held = true;\s*listenBegun = false;/);
    const setMode = main.slice(main.indexOf("function setMode(next, extra = {})"), main.indexOf("// ---- panel (also the brain) ----"));
    expect(setMode).toMatch(/if \(next === "opening" \|\| next === "listening"\) listenBegun = true;\s*if \(next === "error" && errorEndsHold\(\{ held, begun: listenBegun \}\)\) \{\s*held = false;/);
    expect(setMode).not.toContain('if (next === "error" && held)');
  });
  it("the panel does not say the last recording's error over a press that is already waiting", () => {
    const panel = readFileSync(new URL("../web/app/okfilow/panel/page.tsx", import.meta.url), "utf8");
    const stop = panel.slice(panel.indexOf("const stopListening = useCallback("), panel.indexOf("const stopRef = useRef(stopListening);"));
    expect(stop.indexOf("if (queuedStart.current) return;")).toBeGreaterThan(-1);
    expect(stop.indexOf("if (queuedStart.current) return;")).toBeLessThan(stop.indexOf('t("notHeard")'));
  });

  it("the watchdog: sound with no key held and no hands-free mode is stopped after the grace, never before", () => {
    let t = 0;
    const w = createCaptureWatch({ now: () => t });
    for (; t < 60_000; t += 128) expect(w.frame(true)).toBe(false); // keys held, or hands-free: for as long as it lasts
    const from = t;
    for (; t < from + CAPTURE_GRACE_MS; t += 128) expect(w.frame(false)).toBe(false);
    expect(w.frame(false)).toBe(true);
    // it counts again: a capture that did not stop is stopped again
    expect(w.frame(false)).toBe(false);
    t += CAPTURE_GRACE_MS;
    expect(w.frame(false)).toBe(true);
  });
  it("the watchdog: a key held again, or a new press, starts the count over", () => {
    let t = 0;
    const w = createCaptureWatch({ graceMs: 1000, now: () => t });
    w.frame(false); t += 900;
    expect(w.frame(true)).toBe(false);
    t += 900;
    expect(w.frame(false)).toBe(false);
    t += 900; w.reset(); t += 900;
    expect(w.frame(false)).toBe(false);
    t += 1000;
    expect(w.frame(false)).toBe(true);
  });
  it("main runs it on every block of sound and tells the panel to stop", () => {
    expect(main).toMatch(/if \(captureWatch\.frame\(held \|\| handsFree \|\| releaseTail\.waiting\)\) \{\s*logLine\("okfilow: the microphone was still open with no key held: stopped"\);\s*sendPanel\("okfilow:cancel", \{ purpose: null, watchdog: true \}\);/);
  });
});

describe("the opening state in the main process", () => {
  const main = source("okfilow.js");
  it("a dictation's report tells when the microphone was asked for and when it was open", () => {
    expect(main).toContain('if (next === "opening" && extra.purpose === "dictate") dictation.diag.mark("listening", {}, { once: true });');
    expect(main).toContain('if (next === "listening" && extra.purpose === "dictate") dictation.diag.mark("open", {}, { once: true });');
  });
  it("OK Filow switched off while the microphone opens lets go of the keys like while listening", () => {
    expect(main).toContain('if (!c.enabled && (mode === "listening" || mode === "opening")) release();');
  });
});
