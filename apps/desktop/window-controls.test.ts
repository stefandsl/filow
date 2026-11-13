// The full-screen bar's buttons (window-controls.js): on Windows full screen hides the frame and the menu,
// so the page asks main to leave it, minimise or close. Only the main window's own trusted page may.
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { ACTIONS, STATE_CHANNEL, wireWindowControls, forwardFullScreen } = createRequire(import.meta.url)("./window-controls.js");

function setup({ trusted = true } = {}) {
  const on: Record<string, (event: unknown) => void> = {}, handle: Record<string, (event: unknown) => unknown> = {};
  const win = Object.assign(new EventEmitter(), {
    webContents: { send: vi.fn() }, destroyed: false, fullScreen: true,
    isDestroyed() { return this.destroyed; }, isFullScreen() { return this.fullScreen; },
    setFullScreen: vi.fn(), minimize: vi.fn(), close: vi.fn(),
  });
  let current: typeof win | null = win;
  const trust = vi.fn(() => trusted);
  wireWindowControls({
    ipcMain: { on: (c: string, fn: (event: unknown) => void) => { on[c] = fn; }, handle: (c: string, fn: (event: unknown) => unknown) => { handle[c] = fn; } },
    mainWindow: () => current, trusted: trust,
  });
  return { on, handle, win, trust, gone: () => { current = null; } };
}

describe("the window buttons", () => {
  it("are exactly: leave full screen, minimise, close", () => {
    expect(Object.keys(ACTIONS)).toEqual(["window:exitFullScreen", "window:minimize", "window:close"]);
  });
  it("act on the main window when its own trusted page asks", () => {
    const { on, win, trust } = setup();
    const event = { sender: win.webContents };
    on["window:exitFullScreen"](event);
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    on["window:minimize"](event);
    expect(win.minimize).toHaveBeenCalledOnce();
    on["window:close"](event);
    expect(win.close).toHaveBeenCalledOnce();
    expect(trust).toHaveBeenCalledWith(event);
    // each button does its one thing only
    expect(win.setFullScreen).toHaveBeenCalledOnce();
  });
  it("ignore another window's page, even a trusted one (the overlay, the points window)", () => {
    const { on, win } = setup();
    for (const channel of Object.keys(ACTIONS)) on[channel]({ sender: { send: vi.fn() } });
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });
  it("ignore the main window when its page is not trusted (navigated elsewhere, a subframe)", () => {
    const { on, win } = setup({ trusted: false });
    for (const channel of Object.keys(ACTIONS)) on[channel]({ sender: win.webContents });
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });
  it("do nothing once the main window is gone or destroyed", () => {
    const a = setup();
    a.win.destroyed = true;
    a.on["window:close"]({ sender: a.win.webContents });
    expect(a.win.close).not.toHaveBeenCalled();
    const b = setup();
    b.gone();
    expect(() => b.on["window:minimize"]({ sender: b.win.webContents })).not.toThrow();
    expect(b.win.minimize).not.toHaveBeenCalled();
  });
});

describe("whether the window is in full screen", () => {
  it("is answered to the main window's trusted page, and refused to anyone else", () => {
    const { handle, win } = setup();
    expect(handle["window:isFullScreen"]({ sender: win.webContents })).toBe(true);
    win.fullScreen = false;
    expect(handle["window:isFullScreen"]({ sender: win.webContents })).toBe(false);
    expect(() => handle["window:isFullScreen"]({ sender: { send() {} } })).toThrow("Denied");
    const untrusted = setup({ trusted: false });
    expect(() => untrusted.handle["window:isFullScreen"]({ sender: untrusted.win.webContents })).toThrow("Denied");
  });
  it("reaches the page when the window enters or leaves full screen", () => {
    const { win } = setup();
    forwardFullScreen(win);
    win.emit("enter-full-screen");
    win.emit("leave-full-screen");
    expect(win.webContents.send.mock.calls).toEqual([[STATE_CHANNEL, true], [STATE_CHANNEL, false]]);
    win.destroyed = true;
    win.emit("enter-full-screen");
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });
});

describe("the page side", () => {
  const preload = readFileSync(new URL("./preload.js", import.meta.url), "utf8");
  it("the preload offers fixed channels only, never a channel the page names", () => {
    expect(preload).toContain('isFullScreen: () => ipcRenderer.invoke("window:isFullScreen")');
    expect(preload).toContain('exitFullScreen: () => ipcRenderer.send("window:exitFullScreen")');
    expect(preload).toContain('minimize: () => ipcRenderer.send("window:minimize")');
    expect(preload).toContain('close: () => ipcRenderer.send("window:close")');
    expect(preload).toContain(`ipcRenderer.on("${STATE_CHANNEL}", h)`);
  });
  it("main.js wires the buttons with its own sender rule and tells the main window's page", () => {
    const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    expect(main).toContain("wireWindowControls({ ipcMain, mainWindow: () => mainWin, trusted: (event) => uiSender(event) });");
    expect(main).toContain("forwardFullScreen(win);");
  });
});
