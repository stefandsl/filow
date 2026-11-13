// The "OK Filow" button in the main window's sidebar (apps/web/lib/buddy/openAsk.ts): the panel the
// type-to-ask key opens, next to the button, its question box focused; switched off, nothing opens.
// The main window is not one of OK Filow's windows, so it has a channel of its own that checks the
// main window's sender. createOkFilow needs Electron, so its wiring is read from the source; the
// behaviour is checked in a hidden instance (tmp/sidebar-okf-shots).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { pagePointOnScreen } = require("./okfilow.js");
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
const okf = read("okfilow.js");
/** The body of `function name(...) {` up to the closing brace at the same indent. */
const body = (name: string) => {
  const start = okf.indexOf(`  function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return okf.slice(start, okf.indexOf("\n  }\n", start) + 4);
};

describe("the main window's OK Filow button in the desktop app", () => {
  it("has its own channel, checked against the main window's sender, that says what happened", () => {
    expect(read("preload.js")).toContain('openAsk: (at) => ipcRenderer.invoke("okfilow:settings:openAsk", at),');
    const main = read("main.js");
    const start = main.indexOf('ipcMain.handle("okfilow:settings:openAsk"');
    expect(start).toBeGreaterThan(-1);
    const handler = main.slice(start, main.indexOf("\n  });", start));
    // the sender check comes first, before OK Filow is touched
    expect(handler.split("\n")[1].trim()).toBe('if (!uiSender(event)) throw new Error("Denied");');
    expect(handler).toContain('if (!okFilow) return "unavailable";');
    expect(handler).toContain("return okFilow.openAsk(window ? require(\"./okfilow\").pagePointOnScreen(window.getContentBounds(), event.sender.getZoomFactor(), at) : null);");
    expect(okf).toMatch(/return \{[^}]*\bopenAsk\b[^}]*\};/);
  });

  it("switched off, opens nothing and answers off; switched on, opens the same panel the type-to-ask key opens", () => {
    const openAsk = body("openAsk");
    expect(openAsk).toContain('if (!cfg().enabled) return "off";');
    expect(openAsk.indexOf('return "off"')).toBeLessThan(openAsk.indexOf("openQuickAsk(at)"));
    expect(openAsk).toContain('return "open";');
    // the key's path: "text:open" ends in the same function, so the button and the key cannot drift apart
    expect(okf).toMatch(/case "text:open":\n\s+if \(!cfg\(\)\.enabled\) return;\n\s+return openQuickAsk\(\);/);
  });

  it("the question box gets the keyboard even when the panel was still loading", () => {
    const quick = body("openQuickAsk");
    expect(quick).toContain("showPanelAtCursor(at);");
    expect(quick).toContain('if (panelReady) sendPanel("okfilow:quickAsk", null);');
    expect(quick).toContain("else quickAskWaiting = true;");
    const ready = okf.slice(okf.indexOf('ipcMain.on("okfilow:panel:ready"'), okf.indexOf("\n  });", okf.indexOf('ipcMain.on("okfilow:panel:ready"')));
    expect(ready).toContain('if (quickAskWaiting) { quickAskWaiting = false; e.sender.send("okfilow:quickAsk", null); }');
    // and the panel itself focuses its question box when told
    const panel = fs.readFileSync(path.join(dir, "..", "web", "app", "okfilow", "panel", "page.tsx"), "utf8");
    expect(panel).toContain("b.onQuickAsk(() => setTimeout(() => typeBox.current?.focus(), 30)),");
  });

  it("places the panel by the button the page names, or by the mouse when the point is not usable", () => {
    expect(body("showPanelAtCursor")).toContain("const c = at || screen.getCursorScreenPoint();");
    const content = { x: 100, y: 50, width: 1200, height: 800 };
    expect(pagePointOnScreen(content, 1, { x: 260, y: 700 })).toEqual({ x: 360, y: 750 });
    // a page zoomed to 125 %: its pixels are larger on the screen
    expect(pagePointOnScreen(content, 1.25, { x: 200, y: 400 })).toEqual({ x: 350, y: 550 });
    expect(pagePointOnScreen(content, Number.NaN, { x: 10, y: 10 })).toEqual({ x: 110, y: 60 });
    for (const bad of [null, undefined, "260,700", { x: "260", y: 700 }, { x: Number.NaN, y: 1 }, { x: Infinity, y: 1 }, { x: -1, y: 10 }, { x: 10, y: 801 }, { x: 1201, y: 10 }]) {
      expect(pagePointOnScreen(content, 1, bad)).toBeNull();
    }
    expect(pagePointOnScreen(null, 1, { x: 1, y: 1 })).toBeNull();
  });
});

// A question typed on a paired phone (apps/web/lib/buddy/phoneAsk.ts) reaches OK Filow through the main
// window, which holds the paired session: its own channel, checked against the main window's sender.
describe("a paired phone's question in the desktop app", () => {
  it("has its own checked channel from the main window", () => {
    expect(read("preload.js")).toContain('askFromPhone: (text) => ipcRenderer.invoke("okfilow:settings:askFromPhone", text),');
    const main = read("main.js");
    const start = main.indexOf('ipcMain.handle("okfilow:settings:askFromPhone"');
    expect(start).toBeGreaterThan(-1);
    const handler = main.slice(start, main.indexOf("\n  });", start));
    expect(handler.split("\n")[1].trim()).toBe('if (!uiSender(event)) throw new Error("Denied");');
    expect(handler).toContain('if (!okFilow) return "unavailable";');
    expect(handler).toContain("return okFilow.askFromPhone(text);");
    expect(okf).toMatch(/return \{[^}]*\baskFromPhone\b[^}]*\};/);
  });

  it("asks it through the panel like any handed-over question, only when OK Filow is on and ready, never twice in a moment", () => {
    const fn = body("askFromPhone");
    const order = ['if (!cfg().enabled) return "off";', 'if (!question) return "empty";', 'if (!panelReady || !panel || panel.isDestroyed() || panel.webContents.isLoading()) return "busy";',
      'if (now - phoneAskedAt < PHONE_ASK_GAP_MS) return "busy";', "phoneAskedAt = now;", 'sendPanel("okfilow:askText", question);', 'return "asked";'];
    let at = -1;
    for (const line of order) {
      const i = fn.indexOf(line);
      expect(i, line).toBeGreaterThan(at);
      at = i;
    }
    // text only, one line, capped like the panel's own handed-over questions
    expect(fn).toContain('const question = typeof text === "string" ? text.replace(/\\s+/g, " ").trim().slice(0, PHONE_QUESTION_MAX).trim() : "";');
    expect(okf).toContain("const PHONE_QUESTION_MAX = 300;");
    expect(okf).toContain("const PHONE_ASK_GAP_MS = 3000;");
    // shown without taking the keyboard from what the presenter has in front (a slideshow, say)
    expect(fn).toContain("if (!panel.isVisible()) showWindow(panel, \"panel\", true);");
    expect(fn).not.toMatch(/\.focus\(|\.show\(\)|showPanelAtCursor|keyTap/);
    // the panel asks a handed-over question through its one ask(): the same consent and provider as a typed one
    const panel = fs.readFileSync(path.join(dir, "..", "web", "app", "okfilow", "panel", "page.tsx"), "utf8");
    expect(panel).toContain('b.onAskText((text) => { if (typeof text === "string" && text.trim()) void ask(text.trim()); }),');
  });
});
