import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The whiteboard window (docs/whiteboard/SPEC.md) follows the rules of every OK Filow window. Read
// from the source, statement by statement: the repo-wide SEC-05 check looks at a handler and the
// three lines after it, so a handler that lost its own check could hide behind its neighbour's.
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const main = fs.readFileSync(path.join(dir, "okfilow.js"), "utf8");
const preload = fs.readFileSync(path.join(dir, "okfilow-preload.js"), "utf8");

/** Each `ipcMain.on("okfilow:whiteboard:...` statement, from its start to the `});` that ends it. */
function handlers(): Array<{ channel: string; body: string }> {
  const out: Array<{ channel: string; body: string }> = [];
  const re = /ipcMain\.(?:on|handle|once)\("(okfilow:whiteboard:[a-z]+)"/g;
  for (let m = re.exec(main); m; m = re.exec(main)) {
    const end = main.indexOf("});", m.index);
    out.push({ channel: m[1], body: main.slice(m.index, end + 3) });
  }
  return out;
}

describe("whiteboard window in the desktop app", () => {
  it("has three handlers and each one checks who is calling before it does anything", () => {
    const list = handlers();
    expect(list.map((h) => h.channel).sort()).toEqual(["okfilow:whiteboard:close", "okfilow:whiteboard:ready", "okfilow:whiteboard:show"]);
    // either "do it only for our sender" or "leave unless it is our sender": an inverted check matches neither
    for (const h of list) expect(h.body, h.channel).toMatch(/=> \{\s*if \((?:ourSender\(e\) &&|!ourSender\(e\) \|\|)/);
  });

  it("counts as one of OK Filow's own windows, so its page may call the bridge and nothing else may", () => {
    expect(main).toMatch(/const allWindows = \(\) => \[[^\]]*\bboardWin\b[^\]]*\]/);
  });

  it("opens sandboxed, isolated, without Node, and cannot navigate away", () => {
    const start = main.indexOf("boardWin = new BrowserWindow({");
    expect(start).toBeGreaterThan(0);
    const block = main.slice(start, main.indexOf("boardWin.loadURL(", start) + 80);
    expect(block).toContain("contextIsolation: true");
    expect(block).toContain("nodeIntegration: false");
    expect(block).toContain("sandbox: true");
    expect(block).toContain("lockDown(boardWin)");
    expect(block).toContain("boardWin.loadURL(`${appUrl}/okfilow/whiteboard`)");
  });

  it("keeps a topic that arrives while the page is still loading", () => {
    expect(main).toMatch(/if \(boardReady && boardTopic\) \{\s*boardWin\.webContents\.send\("okfilow:whiteboard", boardTopic\);/);
    expect(main).toMatch(/boardReady = true;\s*if \(boardTopic\) e\.sender\.send\("okfilow:whiteboard", boardTopic\);/);
  });

  it("takes only a short text as its topic", () => {
    expect(main).toMatch(/boardTopic = String\(topic \|\| ""\)\.slice\(0, 400\)/);
    expect(handlers().find((h) => h.channel.endsWith(":show"))!.body).toContain('typeof topic === "string"');
  });

  it("is reached from the page through fixed channels only", () => {
    expect(preload).toContain('showWhiteboard: (topic) => ipcRenderer.send("okfilow:whiteboard:show", String(topic || "")),');
    expect(preload).toContain('whiteboardReady: () => ipcRenderer.send("okfilow:whiteboard:ready"),');
    expect(preload).toContain('closeWhiteboard: () => ipcRenderer.send("okfilow:whiteboard:close"),');
    expect(preload).toContain('onWhiteboard: on("okfilow:whiteboard"),');
  });
});
