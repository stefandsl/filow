import { describe, expect, it } from "vitest";
import * as welcomeFlow from "./welcome-flow";
import { welcomeSteps, micErrorKind, levelFromRms, micTick, MIC_HEARD_MS, MIC_SILENT_MS, startMic, micActionsShown, micFocusMove, micDeviceChange, offersDownload, escapeAction, segmentJaPhrases, type MicState } from "./welcome-flow";

describe("welcome steps", () => {
  it("guides a first run through language, microphone and setup", () => {
    expect(welcomeSteps({ firstRun: true, askSetup: true })).toEqual(["language", "intro", "mic", "setup"]);
  });
  it("leaves the setup step out when the installer already chose the models", () => {
    expect(welcomeSteps({ firstRun: true, askSetup: false })).toEqual(["language", "intro", "mic"]);
  });
  it("reopened from the menu, it is the preferences page only", () => {
    expect(welcomeSteps({ firstRun: false, askSetup: true })).toEqual(["preferences"]);
  });
});

describe("setup step buttons", () => {
  it("asks to download whenever something has a size, even when a first take is ready (review T3 finding 4)", () => {
    expect(offersDownload({ online: true, downloadGb: 11.4 })).toBe(true);
    expect(offersDownload({ online: true, downloadGb: 0 })).toBe(false);
    expect(offersDownload({ online: false, downloadGb: 3 })).toBe(false);
    expect(offersDownload({ online: true, unknown: true, downloadGb: 3 })).toBe(false);
  });
});

describe("Escape (review T3 finding 9)", () => {
  const key = (over: Partial<Parameters<typeof escapeAction>[0]> = {}) => ({ key: "Escape", repeat: false, isComposing: false, defaultPrevented: false, inSelect: false, ...over });
  it("does what the visible secondary button does", () => {
    expect(escapeAction(key(), true)).toBe("secondary");
  });
  it("does nothing without a secondary button (closing would end the guide)", () => {
    expect(escapeAction(key(), false)).toBeNull();
  });
  it("ignores other keys, a held key, composition, a handled key and an open list", () => {
    for (const over of [{ key: "Enter" }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }, { inSelect: true }]) {
      expect(escapeAction(key(over), true)).toBeNull();
    }
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
  it("room noise (about -45 dBFS) never counts as speech, however long it lasts", () => {
    const noise = levelFromRms(10 ** (-45 / 20));
    expect(run(Array(400).fill(noise)).status).toBe("silent");
  });
  it("a voice near the microphone (about -26 dBFS) counts", () => {
    expect(run(Array(10).fill(levelFromRms(0.05))).status).toBe("heard");
  });
  it("shows the help after 6 s of quiet, not before 5 s", () => {
    expect(run(Array(100).fill(0), 50).status).toBe("listening"); // 5 s
    expect(run(Array(120).fill(0), 50).status).toBe("silent"); // 6 s
  });
  it("does not change an error state", () => {
    const err: MicState = { ...listening, status: "blocked" };
    expect(micTick(err, 0.9, 5000)).toEqual(err);
  });
});

describe("Try again keeps keyboard focus (review T3 finding 3)", () => {
  it("the row hides while listening and once heard, shows after a failure or silence", () => {
    expect(micActionsShown("listening")).toBe(false);
    expect(micActionsShown("heard")).toBe(false);
    for (const s of ["silent", "none", "blocked", "busy"] as const) expect(micActionsShown(s)).toBe(true);
  });
  it("focus on Try again moves to the status line when the row hides, and back when it shows", () => {
    expect(micFocusMove(false, "actions")).toBe("status");
    expect(micFocusMove(true, "status")).toBe("retry");
  });
  it("leaves focus alone anywhere else, and when nothing hides", () => {
    expect(micFocusMove(false, "other")).toBeNull();
    expect(micFocusMove(true, "other")).toBeNull();
    expect(micFocusMove(true, "actions")).toBeNull();
    expect(micFocusMove(false, "status")).toBeNull();
  });
});

describe("microphone plugged in or out mid-check (review T3 finding 5)", () => {
  it("no input left: says No microphone, whatever the check said before", () => {
    for (const s of ["listening", "heard", "silent", "busy"] as const) expect(micDeviceChange(s, false)).toBe("none");
    expect(micDeviceChange("none", false)).toBeNull();
  });
  it("a microphone appears after a failure or silence: checks again on its own", () => {
    for (const s of ["none", "busy", "silent"] as const) expect(micDeviceChange(s, true)).toBe("restart");
  });
  it("does not restart a running or passed check, nor a blocked one (a setting, not a device)", () => {
    for (const s of ["listening", "heard", "blocked"] as const) expect(micDeviceChange(s, true)).toBeNull();
  });
});

describe("Japanese phrase-aware segmentation", () => {
  it("keeps Japanese words, katakana compounds, inflections and shortcuts unbroken", () => {
    expect(segmentJaPhrases("自由に話す。要点は外さない。")).toEqual(["自由に", "話す。", "要点は", "外さない。"]);
    expect(segmentJaPhrases("「デバイスをペアリング」でQRコードを読み取るとスマホで追えます。")).toEqual([
      "「デバイスを",
      "ペアリング」で",
      "QRコードを",
      "読み取ると",
      "スマホで",
      "追えます。",
    ]);
    expect(segmentJaPhrases("サイドバーの「ホワイトボード」で概念を段階的に図解できます。")).toEqual([
      "サイドバーの",
      "「ホワイトボード」で",
      "概念を",
      "段階的に",
      "図解できます。",
    ]);
    expect(segmentJaPhrases("Control + Optionを長押し、または「話す・入力する」で画面についてOK Filowに質問します。")).toEqual([
      "Control + Optionを",
      "長押し、",
      "または",
      "「話す・",
      "入力する」で",
      "画面について",
      "OK Filowに",
      "質問します。",
    ]);
  });
});

describe("guide disclosure scroll reveal", () => {
  it("computes the scroll offset needed to keep an opened guide above the sticky action bar without clipping its top", () => {
    const revealScrollTop = (welcomeFlow as Record<string, unknown>).revealScrollTop as
      | ((panelScrollTop: number, panelTop: number, visibleBottom: number, targetTop: number, targetBottom: number, pad?: number) => number)
      | undefined;
    const scrollBehaviorForMotion = (welcomeFlow as Record<string, unknown>).scrollBehaviorForMotion as
      | ((reducedMotion: boolean) => ScrollBehavior)
      | undefined;

    expect(typeof revealScrollTop).toBe("function");
    expect(typeof scrollBehaviorForMotion).toBe("function");

    // Already completely visible above the action bar -> no scroll.
    expect(revealScrollTop!(0, 0, 640, 420, 600, 8)).toBe(0);
    // Partially hidden beneath the sticky action bar -> scroll down to reveal it with padding.
    expect(revealScrollTop!(0, 0, 518, 480, 700, 8)).toBe(190);
    // Opened disclosure taller than the viewport (e.g. 200% zoom) -> keep the summary/top visible.
    expect(revealScrollTop!(0, 0, 298, 260, 700, 8)).toBe(252);
    // Respects reduced motion preference.
    expect(scrollBehaviorForMotion!(false)).toBe("smooth");
    expect(scrollBehaviorForMotion!(true)).toBe("instant");
  });
});
