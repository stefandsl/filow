import { describe, expect, it } from "vitest";
import { welcomeSteps, micErrorKind, levelFromRms, micTick, MIC_HEARD_MS, MIC_SILENT_MS, startMic, type MicState } from "./welcome-flow";

describe("welcome steps", () => {
  it("guides a first run through language, microphone and setup", () => {
    expect(welcomeSteps({ firstRun: true, askSetup: true })).toEqual(["language", "mic", "setup"]);
  });
  it("leaves the setup step out when the installer already chose the models", () => {
    expect(welcomeSteps({ firstRun: true, askSetup: false })).toEqual(["language", "mic"]);
  });
  it("reopened from the menu, it is the preferences page only", () => {
    expect(welcomeSteps({ firstRun: false, askSetup: true })).toEqual(["preferences"]);
  });
});

describe("microphone errors", () => {
  it.each([
    ["NotFoundError", "none"], ["OverconstrainedError", "none"], ["DevicesNotFoundError", "none"],
    ["NotAllowedError", "blocked"], ["SecurityError", "blocked"], ["PermissionDeniedError", "blocked"],
    ["NotReadableError", "busy"], ["AbortError", "busy"], ["TrackStartError", "busy"], ["", "busy"],
  ])("%s means %s", (name, kind) => expect(micErrorKind(name)).toBe(kind));
});

describe("level meter", () => {
  it("maps silence to 0 and a normal voice to the upper half", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.0005)).toBe(0); // -66 dBFS, below the floor
    expect(levelFromRms(0.05)).toBeGreaterThan(0.5); // -26 dBFS, a voice at arm's length
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(Number.NaN)).toBe(0);
  });
  it("is monotonic", () => {
    const xs = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3];
    const ys = xs.map(levelFromRms);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});

describe("microphone check", () => {
  const listening: MicState = startMic();
  const run = (levels: number[], dt = 50, from = listening) => levels.reduce((s, l) => micTick(s, l, dt), from);

  it("says heard only after a short stretch of sound, not one click", () => {
    expect(run([0.9]).status).toBe("listening");
    const ticks = Math.ceil(MIC_HEARD_MS / 50);
    expect(run(Array(ticks).fill(0.6)).status).toBe("heard");
  });
  it("adds up sound across short pauses (normal speech)", () => {
    const ticks = Math.ceil(MIC_HEARD_MS / 50);
    const speech = Array.from({ length: ticks * 2 }, (_, i) => (i % 2 ? 0.6 : 0.02));
    expect(run(speech).status).toBe("heard");
  });
  it("turns to silent when nothing is heard for a while, and recovers when sound comes", () => {
    const quiet = run(Array(Math.ceil(MIC_SILENT_MS / 50)).fill(0.01));
    expect(quiet.status).toBe("silent");
    expect(run(Array(Math.ceil(MIC_HEARD_MS / 50)).fill(0.6), 50, quiet).status).toBe("heard");
  });
  it("stays heard once heard (the check passed)", () => {
    const heard = run(Array(Math.ceil(MIC_HEARD_MS / 50)).fill(0.6));
    expect(run(Array(400).fill(0), 50, heard).status).toBe("heard");
  });
  it("does not change an error state", () => {
    const err: MicState = { ...listening, status: "blocked" };
    expect(micTick(err, 0.9, 5000)).toEqual(err);
  });
});
