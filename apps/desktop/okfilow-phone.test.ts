// A paired phone's question in the desktop app (okfilow-phone.js): the gate in front of OK Filow's panel.
// It lets a question through only when OK Filow is free, so a phone never interrupts the presenter.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDeviceName as coreDevice, cleanPhoneQuestion as coreClean } from "@filow/core";

const require = createRequire(import.meta.url);
const { createPhoneGate, cleanPhoneQuestion, cleanDeviceName, PHONE_QUESTION_MAX } = require("./okfilow-phone.js");
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
const free = { enabled: true, panelReady: true, mode: "idle" };

describe("a phone's question in the desktop app", () => {
  it("is cleaned exactly as in packages/core", () => {
    const inputs: unknown[] = ["  a\n b ", "é", "x‮y​z", "\u{1F600}".repeat(PHONE_QUESTION_MAX + 1), "", 1, null, "q".repeat(5000)];
    for (const v of inputs) {
      expect(cleanPhoneQuestion(v)).toBe(coreClean(v));
      expect(cleanPhoneQuestion(v, true)).toBe(coreClean(v, true));
      expect(cleanDeviceName(v)).toBe(coreDevice(v));
    }
  });

  it("passes only when OK Filow is on, loaded and idle, with the cleaned question and the device", () => {
    const gate = createPhoneGate({ now: () => 0 });
    expect(gate.decide({ ...free, enabled: false }, { text: "hi", device: "Pixel" })).toEqual({ answer: "off" });
    for (const mode of ["listening", "thinking", "speaking", "error"]) expect(gate.decide({ ...free, mode }, { text: "hi", device: "Pixel" })).toEqual({ answer: "busy" });
    expect(gate.decide({ ...free, panelReady: false }, { text: "hi", device: "Pixel" })).toEqual({ answer: "busy" });
    for (const bad of [{ text: "" }, { text: 42 }, { text: "x".repeat(PHONE_QUESTION_MAX + 1) }, null, "hi"]) expect(gate.decide(free, bad)).toEqual({ answer: "bad" });
    expect(gate.decide(free, { text: " What\n now?‮ ", device: "Pixel​ 8" })).toEqual({ answer: "asked", question: "What now?", device: "Pixel 8" });
  });

  it("holds the next question while one waits for the presenter, and keeps them apart in time", () => {
    let now = 0;
    const gate = createPhoneGate({ now: () => now, gapMs: 3000, pendingMs: 65_000 });
    expect(gate.decide(free, { text: "one" }).answer).toBe("asked");
    now = 10_000;
    expect(gate.decide(free, { text: "two" }).answer).toBe("busy"); // the first still waits for a yes
    gate.done();
    now = 11_000;
    expect(gate.decide(free, { text: "three" }).answer).toBe("asked");
    gate.done();
    now = 12_000;
    expect(gate.decide(free, { text: "four" }).answer).toBe("busy"); // 1 s after the last
    now = 14_500;
    expect(gate.decide(free, { text: "five" })).toMatchObject({ answer: "asked", device: "phone" });
    // a panel that never answered does not block for ever
    now = 14_500 + 65_000;
    expect(gate.decide(free, { text: "six" }).answer).toBe("asked");
  });

  it("is wired through its own channel, never the panel's plain-text one, and shows the panel without the keyboard", () => {
    const okf = read("okfilow.js");
    const start = okf.indexOf("  function askFromPhone(payload) {");
    expect(start).toBeGreaterThan(-1);
    const fn = okf.slice(start, okf.indexOf("\n  }\n", start));
    expect(fn).toContain("phoneGate.decide({ enabled: cfg().enabled, panelReady: panelReady && live, mode }, payload)");
    expect(fn).toContain('sendPanel("okfilow:phoneAsk", { text: r.question, device: r.device });');
    expect(fn).not.toContain("okfilow:askText");
    expect(fn).toContain('showWindow(panel, "panel", true)');
    expect(fn).not.toMatch(/\.focus\(|showPanelAtCursor/);
    const main = read("main.js");
    const h = main.slice(main.indexOf('ipcMain.handle("okfilow:settings:askFromPhone"'));
    expect(h.split("\n")[1].trim()).toBe('if (!uiSender(event)) throw new Error("Denied");');
    expect(read("okfilow-preload.js")).toContain('onPhoneAsk: on("okfilow:phoneAsk"),');
  });
});
