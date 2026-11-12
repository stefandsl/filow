// The answer bubble's life in the desktop shell (okfilow-stop.js, docs/okfilow/BUBBLE.md): the text is
// never cut, and no state leaves a bubble on screen for ever.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { keepsOverlays, pointsShowMs, BUBBLE, BUBBLE_TEXT_MAX, bubbleText, readingMs, bubbleHold, createBubble, escapePlan, overlayLive, overlayMouse } = require("./okfilow-stop.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const main = fs.readFileSync(path.join(here, "okfilow.js"), "utf8").replace(/\r\n/g, "\n");
const preload = fs.readFileSync(path.join(here, "okfilow-preload.js"), "utf8").replace(/\r\n/g, "\n");

/** A long answer, as a small local model writes one: about 4,000 letters, thirty sentences. */
const LONG = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the long answer explains one more step of keeping the files of a Windows PC tidy with folders and names.`).join(" ");

/** A bubble with a clock and timers the test moves by hand. */
function harness() {
  let now = 1000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const closed: string[] = [];
  const plans: Array<number | null> = [];
  const bubble = createBubble({
    dismiss: (why: string) => closed.push(why),
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { timers.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimer: (id: number) => { timers.delete(id); },
    onPlan: (ms: number | null) => plans.push(ms),
  });
  /** Moves the clock, running the timers that come due, in order. */
  const pass = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { bubble, closed, plans, pass, pending: () => timers.size, due: () => Math.min(...[...timers.values()].map((t) => t.at)) - now };
}
/** An answer shown and spoken: thinking, the text, speaking for `spokenMs`, then idle. */
function answered(h: ReturnType<typeof harness>, text: string, spokenMs: number, end: "idle" | "error" = "idle", extra: Record<string, unknown> = {}) {
  h.bubble.setMode("thinking");
  h.bubble.setText(text);
  h.bubble.setMode("speaking");
  h.pass(spokenMs);
  h.bubble.setMode(end, extra);
}

describe("the bubble's text in the desktop shell", () => {
  it("a long answer reaches the overlays whole: nothing is cut at 2,000 letters", () => {
    expect(LONG.length).toBeGreaterThan(3500);
    expect(bubbleText(LONG)).toBe(LONG);
    expect(bubbleText(LONG).endsWith("Sentence 30 of the long answer explains one more step of keeping the files of a Windows PC tidy with folders and names.")).toBe(true);
    // a runaway text is still bounded, far above any answer
    expect(BUBBLE_TEXT_MAX).toBeGreaterThanOrEqual(20000);
    expect(bubbleText("x".repeat(BUBBLE_TEXT_MAX + 50)).length).toBe(BUBBLE_TEXT_MAX);
    expect(bubbleText(null)).toBe("");
  });
  it("main sends the overlays the text through that rule, not a shorter cut of its own", () => {
    const at = main.indexOf('ipcMain.on("okfilow:text"');
    const handler = main.slice(at, main.indexOf("});", at));
    expect(handler).toContain("const t = bubbleText(text);");
    expect(handler).toContain('sendOverlays("okfilow:text", t);');
    expect(handler).not.toMatch(/slice\(0, 2000\)/);
  });
});

describe("reading time", () => {
  it("grows with the length, between five seconds and a minute and a half", () => {
    expect(readingMs("Yes.")).toBe(BUBBLE.readMinMs);
    expect(readingMs("a".repeat(200))).toBe(200 * BUBBLE.msPerChar);
    expect(readingMs("a ".repeat(200))).toBe(200 * BUBBLE.msPerChar); // spaces are not read
    expect(readingMs(LONG)).toBe(BUBBLE.readMaxMs);
    expect(BUBBLE.readMinMs).toBe(5000);
    expect(BUBBLE.readMaxMs).toBe(90000);
  });
  it("a Japanese letter takes twice the time of a Latin or Cyrillic one", () => {
    const ja = "ファイルを整理するにはフォルダーを作ります。".repeat(6);
    const ru = "Чтобы навести порядок, создайте папки.".repeat(6);
    expect(readingMs(ja)).toBe([...ja].length * 2 * BUBBLE.msPerChar);
    expect(readingMs(ru)).toBe([...ru.replace(/\s/g, "")].length * BUBBLE.msPerChar);
  });
});

describe("when the bubble goes away by itself (the rule)", () => {
  it("stays while an answer runs, while it is paused, while somebody talks, and while the pointer is on it", () => {
    for (const mode of ["listening", "thinking", "speaking"]) expect(bubbleHold({ mode, text: "Some text." })).toBeNull();
    expect(bubbleHold({ mode: "idle", text: "Some text.", paused: true })).toBeNull();
    expect(bubbleHold({ mode: "idle", text: "Some text.", hover: true })).toBeNull();
    expect(bubbleHold({ mode: "idle", text: "", stopped: true, hover: true })).toBeNull();
  });
  it("every state in which nothing runs gets a time", () => {
    // finished and spoken: the reading time has passed while the voice read
    expect(bubbleHold({ mode: "idle", text: LONG, shownMs: 200000 })).toBe(BUBBLE.lingerMs);
    // voice off, or a voice that failed or does not exist: nothing was heard, so the reading time counts from when it was shown
    expect(bubbleHold({ mode: "idle", text: "a".repeat(400), shownMs: 50 })).toBe(400 * BUBBLE.msPerChar - 50);
    expect(bubbleHold({ mode: "idle", text: LONG, shownMs: 0 })).toBe(BUBBLE.readMaxMs);
    // an error
    expect(bubbleHold({ mode: "error", text: "The model did not answer.", shownMs: 0 })).toBe(BUBBLE.readMinMs);
    // stopped, with or without words on screen
    expect(bubbleHold({ mode: "idle", text: LONG, stopped: true, shownMs: 0 })).toBe(BUBBLE.stoppedMs);
    expect(bubbleHold({ mode: "idle", text: "", stopped: true })).toBe(BUBBLE.stoppedMs);
    // a note with its own time (a dictation's result), kept within bounds
    expect(bubbleHold({ mode: "idle", text: "Copied.", holdMs: 2500 })).toBe(2500);
    expect(bubbleHold({ mode: "idle", text: "Copied.", holdMs: 60000 })).toBe(BUBBLE.noteMaxMs);
    expect(bubbleHold({ mode: "idle", text: "Copied.", holdMs: 10 })).toBe(BUBBLE.noteMinMs);
    // nothing to show: gone at once
    expect(bubbleHold({ mode: "idle", text: "" })).toBe(0);
    // the pointer has just left it
    expect(bubbleHold({ mode: "idle", text: LONG, afterHover: true, shownMs: 0 })).toBe(BUBBLE.afterHoverMs);
    expect(bubbleHold({ mode: "idle", text: LONG, stopped: true, afterHover: true })).toBe(BUBBLE.afterHoverMs);
  });
  it("the times themselves", () => {
    expect(BUBBLE.lingerMs).toBe(4000);
    expect(BUBBLE.stoppedMs).toBe(8000);
    expect(BUBBLE.afterHoverMs).toBe(2500);
  });
});

describe("the bubble's life: every end state schedules the dismissal", () => {
  it("finished and spoken: gone four seconds after the voice ends", () => {
    const h = harness();
    answered(h, LONG, 240000);
    expect(h.bubble.open()).toBe(true);
    expect(h.pending()).toBe(1);
    expect(h.due()).toBe(BUBBLE.lingerMs);
    h.pass(BUBBLE.lingerMs - 1);
    expect(h.closed).toEqual([]);
    h.pass(1);
    expect(h.closed).toEqual(["timer"]);
    expect(h.bubble.open()).toBe(false);
    expect(h.pending()).toBe(0);
  });
  it("voice off: the answer goes idle at once and stays for its reading time", () => {
    const h = harness();
    const text = "a".repeat(300);
    answered(h, text, 0);
    expect(h.due()).toBe(300 * BUBBLE.msPerChar);
    h.pass(300 * BUBBLE.msPerChar);
    expect(h.closed).toEqual(["timer"]);
  });
  it("the voice failed after a moment: the rest of the reading time, never less than four seconds", () => {
    const h = harness();
    answered(h, "a".repeat(300), 2000);
    expect(h.due()).toBe(300 * BUBBLE.msPerChar - 2000);
    const g = harness();
    answered(g, "a".repeat(300), 17000);
    expect(g.due()).toBe(BUBBLE.lingerMs);
  });
  it("the reading time starts when the whole text is there, not when its first words appeared", () => {
    const h = harness();
    h.bubble.setMode("thinking");
    h.bubble.setText("a".repeat(100));
    h.pass(30000); // the model writes for half a minute
    h.bubble.setText("a".repeat(300));
    h.bubble.setMode("speaking");
    h.bubble.setMode("idle"); // voice off
    expect(h.due()).toBe(300 * BUBBLE.msPerChar);
  });
  it("a pause is told to the bubble whatever the mode says: it stays", () => {
    const h = harness();
    answered(h, "a".repeat(300), 0);
    expect(h.pending()).toBe(1);
    h.bubble.setPaused(true);
    expect(h.pending()).toBe(0);
    h.bubble.setPaused(false);
    expect(h.pending()).toBe(1);
  });
  it("an error: its message stays for its reading time, then goes", () => {
    const h = harness();
    h.bubble.setMode("thinking");
    h.bubble.setText("The model did not answer.");
    h.bubble.setMode("error", { error: "The model did not answer." });
    expect(h.due()).toBe(BUBBLE.readMinMs);
    h.pass(BUBBLE.readMinMs);
    expect(h.closed).toEqual(["timer"]);
  });
  it("stopped: the bubble and its pill stay eight seconds, whatever time the panel asked for", () => {
    const h = harness();
    h.bubble.setMode("thinking");
    h.bubble.setText("Half an answer.");
    h.bubble.setMode("idle", { stopped: true, holdMs: 4000 });
    expect(h.due()).toBe(BUBBLE.stoppedMs);
    h.pass(BUBBLE.stoppedMs);
    expect(h.closed).toEqual(["timer"]);
    // stopped before any text: the "Stopped" mark alone is a bubble too, and goes the same way
    const g = harness();
    g.bubble.setMode("thinking");
    g.bubble.setMode("idle", { stopped: true });
    expect(g.bubble.open()).toBe(true);
    g.pass(BUBBLE.stoppedMs);
    expect(g.closed).toEqual(["timer"]);
  });
  it("the text may come after the mode (a note shown once idle): the dismissal is planned then", () => {
    const h = harness();
    h.bubble.setMode("idle");
    expect(h.pending()).toBe(0);
    h.bubble.setText("Kept on this PC.");
    expect(h.due()).toBe(BUBBLE.readMinMs);
  });
  it("a dictation's note keeps the time the panel gave it", () => {
    const h = harness();
    h.bubble.setMode("listening", { purpose: "dictate" });
    h.bubble.setText("Copied: paste it with Ctrl + V.");
    expect(h.pending()).toBe(0);
    h.bubble.setMode("idle", { holdMs: 5000 });
    expect(h.due()).toBe(5000);
  });
  it("stays while paused and while the pointer is on it; leaves two and a half seconds after the pointer does", () => {
    const h = harness();
    h.bubble.setMode("thinking");
    h.bubble.setText(LONG);
    h.bubble.setMode("speaking");
    h.bubble.setPaused(true);
    h.pass(600000);
    expect(h.closed).toEqual([]);
    expect(h.pending()).toBe(0);
    h.bubble.setPaused(false);
    h.bubble.setMode("idle");
    expect(h.due()).toBe(BUBBLE.lingerMs);
    h.pass(1000);
    h.bubble.setHover(true);
    expect(h.pending()).toBe(0);
    h.pass(600000);
    expect(h.closed).toEqual([]);
    h.bubble.setHover(false);
    expect(h.due()).toBe(BUBBLE.afterHoverMs);
    h.pass(BUBBLE.afterHoverMs);
    expect(h.closed).toEqual(["timer"]);
  });
  it("a new question or a dictation takes the timer away, and its own end plans a new one", () => {
    const h = harness();
    answered(h, LONG, 240000);
    expect(h.pending()).toBe(1);
    h.bubble.setMode("listening", { purpose: "talk" });
    expect(h.pending()).toBe(0);
    h.bubble.setText("");
    expect(h.bubble.open()).toBe(false);
    h.pass(600000);
    expect(h.closed).toEqual([]);
    h.bubble.setText("I did not catch that.");
    h.bubble.setMode("error", { error: "I did not catch that." });
    expect(h.due()).toBe(BUBBLE.readMinMs);
  });
  it("Escape or the close button closes it at once, once; with no bubble there is nothing to close", () => {
    const h = harness();
    answered(h, LONG, 0);
    expect(h.bubble.close("escape")).toBe(true);
    expect(h.closed).toEqual(["escape"]);
    expect(h.bubble.open()).toBe(false);
    expect(h.pending()).toBe(0);
    expect(h.bubble.close("button")).toBe(false);
    h.pass(600000);
    expect(h.closed).toEqual(["escape"]);
  });
});

describe("Escape", () => {
  it("stops an answer in progress; with none it closes the bubble and wipes the marks", () => {
    expect(escapePlan("thinking")).toEqual(["stop"]);
    expect(escapePlan("speaking")).toEqual(["stop"]);
    for (const mode of ["idle", "error", "listening"]) expect(escapePlan(mode)).toEqual(["bubble", "marks"]);
  });
  it("main's Escape follows that plan, and the keyboard hook and the test key path both end in it", () => {
    const at = main.indexOf("function onEscape()");
    const fn = main.slice(at, main.indexOf("\n  }\n", at));
    expect(fn).toContain("for (const step of escapePlan(mode))");
    expect(fn).toContain('if (step === "stop") stopAnswer("escape");');
    expect(fn).toContain('else if (step === "bubble") bubble.close("escape");');
    expect(fn).toContain("else clearDrawings();");
    // the hardware hook (off under test isolation) and the QA key path call the same function
    expect(main).toContain("if (e.keycode === K.Escape) onEscape();");
    expect(main).toMatch(/gestures\.keydown\(mod\); if \(key === "escape"\) onEscape\(\);/);
  });
});

describe("main and the bubble", () => {
  it("is told every text, mode, pause and pointer, and closes on the button", () => {
    expect(main).toContain("bubble.setText(t);");
    const setMode = main.slice(main.indexOf("function setMode(next, extra = {})"), main.indexOf("// ---- panel (also the brain) ----"));
    expect(setMode).toContain("bubble.setMode(mode, extra);");
    expect(main).toContain("bubble.setPaused(pill.paused);");
    expect(main).toContain("bubble.setHover(bubbleHover.size > 0);");
    expect(main).toMatch(/ipcMain\.on\("okfilow:bubble:close", \(e\) => \{ if \(ourSender\(e\)\) bubble\.close\("button"\); \}\);/);
    expect(preload).toContain('closeBubble: () => ipcRenderer.send("okfilow:bubble:close")');
    expect(preload).toContain('onBubbleClose: on("okfilow:bubble:close")');
  });
  it("a dismissal tells every overlay, lets go of the mouse, and lets the overlays fade unless marks are kept", () => {
    const at = main.indexOf("const bubble = createBubble({");
    const made = main.slice(at, main.indexOf("\n  });\n", at));
    expect(made).toContain('sendOverlays("okfilow:bubble:close", why);');
    expect(made).toContain("bubbleHover.clear();");
    expect(made).toContain("scheduleFade();");
  });
  it("kept marks and the always-on pointer keep the overlays, never the bubble: the fade waits for the bubble, the bubble waits for nobody", () => {
    const at = main.indexOf("function scheduleFade(");
    const fade = main.slice(at, main.indexOf("\n  }\n", at));
    expect(fade).toContain("if (cfg().showAlways || pinned || outbound.active() || bubble.open()) return;");
    // the bubble's own rule never hears of them
    const rule = fs.readFileSync(path.join(here, "okfilow-stop.js"), "utf8");
    const hold = rule.slice(rule.indexOf("function bubbleHold("), rule.indexOf("function createBubble("));
    expect(hold).not.toMatch(/pinned|showAlways/);
  });
  it("the overlay takes the mouse on the open bubble as on the pill's controls, and gives it back when the bubble goes", () => {
    expect(overlayLive("idle", { resumable: false }, true)).toBe(true);
    expect(overlayLive("idle", { resumable: false }, false)).toBe(false);
    expect(overlayLive("speaking", { resumable: false }, false)).toBe(true);
    expect(overlayMouse({ caught: false, hover: true, mode: "idle", pill: null, bubble: true })).toEqual({ ignore: false });
    expect(overlayMouse({ caught: false, hover: true, mode: "idle", pill: null, bubble: false })).toEqual({ ignore: true });
    expect(overlayMouse({ caught: false, hover: false, mode: "idle", pill: null, bubble: true })).toEqual({ ignore: true });
    expect(main).toContain("overlayMouse({ caught: mouseCaught, hover: stopHover.has(id), mode, pill, bubble: bubble.open() })");
  });
  it("calling the pointer back (an empty list of points) keeps nothing on screen", () => {
    expect(keepsOverlays([])).toBe(false);
    expect(keepsOverlays(null)).toBe(false);
    expect(keepsOverlays([{ x: 1, y: 2, label: "here" }])).toBe(true);
    const at = main.indexOf('ipcMain.on("okfilow:point"');
    const handler = main.slice(at, main.indexOf("\n  });\n", at));
    expect(handler.indexOf('if (!keepsOverlays(points)) return sendOverlays("okfilow:point", []);')).toBeGreaterThan(0);
    expect(handler).not.toContain("pinned = true;");
  });
  it("the pointer's visits keep the overlays for as long as they take, not until Escape", () => {
    expect(pointsShowMs(0)).toBe(0);
    expect(pointsShowMs(1)).toBe(650 + 5500);
    expect(pointsShowMs(3)).toBe(2 * (650 + 1800) + 650 + 5500);
    const at = main.indexOf('ipcMain.on("okfilow:point"');
    const handler = main.slice(at, main.indexOf("\n  });\n", at));
    expect(handler).toContain("pointUntil = Date.now() + pointsShowMs(points.length);");
    const fade = main.slice(main.indexOf("function scheduleFade("), main.indexOf("let lastCursor"));
    expect(fade).toContain("}, Math.max(FADE_AFTER_MS, pointUntil - Date.now()));");
    // the overlay page's own timing, which this mirrors
    const page = fs.readFileSync(path.join(here, "../web/app/okfilow/overlay/page.tsx"), "utf8");
    expect(page).toContain("const FLY_MS = 650;");
    expect(page).toContain("const HOLD_MS = 5500;");
    expect(page).toContain("now > g.start + FLY_MS + 1800");
    // Escape and Clear still call the pointer back at once
    const clear = main.slice(main.indexOf("function clearDrawings()"), main.indexOf("// ---- keyboard gestures"));
    expect(clear).toContain("if (!pinned && pointUntil <= Date.now()) return;");
    expect(clear).toContain("pointUntil = 0;");
  });
  it("the overlay window still never takes the keyboard", () => {
    const at = main.indexOf("function buildOverlays()");
    expect(main.slice(at, main.indexOf("function showOverlays()", at))).toContain("focusable: false,");
  });
});
