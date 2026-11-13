// A paired phone's question in the desktop app (okfilow-phone.js): the inbox in front of OK Filow's panel.
// Nothing of a question reaches the screen by itself: it waits as a count, and the presenter opens it.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDeviceName as coreDevice, cleanPhoneQuestion as coreClean } from "@filow/core";
import { pairingFingerprint } from "../web/lib/buddy/phoneAsk";

const require = createRequire(import.meta.url);
const { createPhoneInbox, cleanPhoneQuestion, cleanDeviceName, PHONE_QUESTION_MAX, PHONE_INBOX_MAX, PHONE_COOLDOWN_MS, IGNORES_BEFORE_OFF } = require("./okfilow-phone.js");
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
const on = { enabled: true };
/** Pairing ids as the session server makes them. */
const A = "AbCdEfGh12345678";
const B = "ZyXwVuTs87654321";
const q = (id: string, text = "hi", extra: Record<string, unknown> = {}) => ({ text, device: "Pixel", id, peer: "lan", ...extra });
/** The body of a function or handler in okfilow.js, from its first line to its closing line. */
function block(source: string, firstLine: string, end = "\n  }\n") {
  const start = source.indexOf(firstLine);
  expect(start, firstLine).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf(end, start) + end.length);
}

describe("a phone's question in the desktop app", () => {
  it("is cleaned exactly as in packages/core", () => {
    const inputs: unknown[] = ["  a\n b ", "é", "x‮y​z", "\u{1F600}".repeat(PHONE_QUESTION_MAX + 1), "", 1, null, "q".repeat(5000)];
    for (const v of inputs) {
      expect(cleanPhoneQuestion(v)).toBe(coreClean(v));
      expect(cleanPhoneQuestion(v, true)).toBe(coreClean(v, true));
      expect(cleanDeviceName(v)).toBe(coreDevice(v));
    }
  });

  it("waits in the inbox as a count, cleaned, from a pairing the session server named; the text comes out only when opened", () => {
    const inbox = createPhoneInbox({ now: () => 0 });
    expect(inbox.add({ enabled: false }, q(A))).toEqual({ answer: "off" });
    for (const bad of [{ text: "", id: A }, { text: 42, id: A }, { text: "x".repeat(PHONE_QUESTION_MAX + 1), id: A }, null, "hi", { text: "hi" }, { text: "hi", id: "short" }, { text: "hi", id: "has space in it!" }])
      expect(inbox.add(on, bad)).toEqual({ answer: "bad" });
    expect(inbox.count()).toBe(0);
    const added = inbox.add(on, q(A, " What\n now?‮ ", { device: "Pixel​ 8" }));
    expect(added).toEqual({ answer: "asked", key: "q1" });
    // the answer for the phone carries nothing of the question back, and nothing is open yet
    expect(inbox.count()).toBe(1);
    expect(inbox.open()).toEqual({ key: "q1", text: "What now?", device: "Pixel 8", peer: "lan", fp: pairingFingerprint(A) });
    expect(inbox.count()).toBe(0);
    // one open at a time
    expect(inbox.add(on, q(B, "second", { peer: "remote" })).answer).toBe("asked");
    expect(inbox.open()).toBeNull();
    inbox.done("q1", "yes");
    expect(inbox.open()).toMatchObject({ key: "q2", peer: "remote", fp: pairingFingerprint(B) });
    // a connection type the server never names counts as the internet link, never as the Wi-Fi
    inbox.done("q2", "yes");
    inbox.add(on, q(A, "third", { peer: "app" }));
    expect(inbox.open()).toMatchObject({ peer: "remote" });
  });

  it("is fair to every phone: one waiting question per device, a full inbox says busy, an unopened question runs out", () => {
    let now = 0;
    const inbox = createPhoneInbox({ now: () => now, max: 2, ttlMs: 1000 });
    expect(inbox.add(on, q(A, "one")).answer).toBe("asked");
    expect(inbox.add(on, q(A, "two")).answer).toBe("busy"); // the same device already waits
    expect(inbox.add(on, q(B, "three")).answer).toBe("asked"); // another device is not held back by it
    expect(inbox.add(on, q("CcCcCcCc33333333", "four")).answer).toBe("busy"); // full
    expect(inbox.count()).toBe(2);
    // the open one still counts as that device's
    inbox.open();
    expect(inbox.add(on, q(A, "again")).answer).toBe("busy");
    now = 1001;
    expect(inbox.count()).toBe(0);
    expect(PHONE_INBOX_MAX).toBeLessThanOrEqual(10);
  });

  it("an ignored device waits longer each time, and after three ignores in a row loses the right to ask; a yes starts it afresh", () => {
    let now = 0;
    const inbox = createPhoneInbox({ now: () => now });
    const round = (outcome: string) => {
      const r = inbox.add(on, q(A));
      expect(r.answer).toBe("asked");
      const o = inbox.open();
      return inbox.done(o.key, outcome);
    };
    expect(round("no")).toEqual({});
    // the Ignore button and a notice that timed out are the same "no": both counted
    expect(inbox.add(on, q(A)).answer).toBe("busy");
    expect(inbox.add(on, q(B)).answer).toBe("asked"); // another phone is not starved by it
    inbox.done(inbox.open().key, "yes");
    now += PHONE_COOLDOWN_MS - 1;
    expect(inbox.add(on, q(A)).answer).toBe("busy");
    now += 1;
    expect(round("no")).toEqual({});
    now += PHONE_COOLDOWN_MS * 2 - 1;
    expect(inbox.add(on, q(A)).answer).toBe("busy"); // doubled
    now += 1;
    expect(round("no")).toEqual({ askOff: A });
    expect(IGNORES_BEFORE_OFF).toBe(3);
    now += PHONE_COOLDOWN_MS * 100;
    expect(inbox.add(on, q(A)).answer).toBe("blocked");
    // the presenter gives the right again (the devices list names it again): afresh
    inbox.keep([B]);
    inbox.keep([A, B]);
    expect(round("yes")).toEqual({});
    expect(round("no")).toEqual({});
    now += PHONE_COOLDOWN_MS;
    // a yes clears the ignores in a row
    expect(round("yes")).toEqual({});
    expect(inbox.add(on, q(A)).answer).toBe("asked");
    // closed unseen (the presenter asked something of their own): not counted against the phone
    const o = inbox.open();
    expect(inbox.done(o.key, "dropped")).toEqual({});
    expect(inbox.add(on, q(A)).answer).toBe("asked");
    // an answer for a question that is not the open one changes nothing
    expect(inbox.done("q999", "no")).toEqual({});
  });

  it("m5: a device revoked, or with its right to ask switched off, has its questions taken out; the one on screen is withdrawn", () => {
    const inbox = createPhoneInbox({ now: () => 0 });
    inbox.add(on, q(A, "from a"));
    inbox.add(on, q(B, "from b"));
    expect(inbox.keep([A])).toEqual({});
    expect(inbox.count()).toBe(1);
    const open = inbox.open();
    expect(open).toMatchObject({ text: "from a" });
    expect(inbox.keep(new Set([A]))).toEqual({});
    expect(inbox.keep([])).toEqual({ withdrawn: open.key });
    // gone for good: answering it afterwards does nothing, and the next one can open
    expect(inbox.done(open.key, "no")).toEqual({});
    inbox.keep([B]);
    inbox.add(on, q(B, "later"));
    expect(inbox.open()).toMatchObject({ text: "later" });
  });

  it("M4: nothing shows by itself: no window is opened and no text is sent for a waiting question, only a count, held at zero during a slide show", () => {
    const okf = read("okfilow.js");
    const add = block(okf, "  function askFromPhone(payload) {");
    expect(add).toContain("phoneInbox.add({ enabled: cfg().enabled }, payload)");
    expect(add).toContain("publishPhoneCount();");
    expect(add).not.toMatch(/showWindow|showPanelAtCursor|\.show\(|\.focus\(|sendPanel\(|okfilow:askText|r\.question|r\.text/);
    // the count is all the panel and the tray are sent
    const publish = block(okf, "  function publishPhoneCount() {");
    expect(publish).toContain('sendPanel("okfilow:phoneCount", n);');
    expect(publish).not.toMatch(/showWindow|\.show\(|question|text:/);
    expect(okf).toContain("const phoneCount = () => (slideShowRunning() ? 0 : phoneInbox.count());");
    // opened only by the panel itself, never during a slide show
    const open = block(okf, '  ipcMain.handle("okfilow:phoneOpen", (e) => {', "\n  });\n");
    expect(open).toContain("if (!fromPanel(e) || slideShowRunning()) return null;");
    expect(okf).toContain("const fromPanel = (e) => ourSender(e) && e.sender === panel?.webContents;");
    expect(okf).not.toContain("okfilow:phoneAsk\"");
    // three ignores: the main window is told to switch the right off; a revoked device's question is withdrawn
    const done = block(okf, '  ipcMain.on("okfilow:phoneAskDone", (e, p) => {', "\n  });\n");
    expect(done).toContain("if (r.askOff) {");
    expect(done).toContain("deps.phoneAskOff?.(r.askOff);");
    const askers = block(okf, "  function phoneAskers(ids) {");
    expect(askers).toContain('if (r.withdrawn) sendPanel("okfilow:phoneWithdraw", r.withdrawn);');
    const main = read("main.js");
    const h = main.slice(main.indexOf('ipcMain.handle("okfilow:settings:askFromPhone"'));
    expect(h.split("\n")[1].trim()).toBe('if (!uiSender(event)) throw new Error("Denied");');
    const a = main.slice(main.indexOf('ipcMain.on("okfilow:settings:phoneAskers"'));
    expect(a.split("\n")[1].trim()).toBe("if (!uiSender(event)) return;");
    expect(main).toContain("slideShowRunning: () => slideShow.running,");
    expect(main).toContain("if (slideShow.running !== wasRunning) okFilow?.publishPhoneCount?.();");
    const preload = read("okfilow-preload.js");
    expect(preload).toContain('onPhoneCount: on("okfilow:phoneCount"),');
    expect(preload).toContain('onPhoneWithdraw: on("okfilow:phoneWithdraw"),');
    expect(preload).not.toContain("onPhoneAsk:");
  });
});
