import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pw = require("./points-window.js");

class FakeWindow extends EventEmitter {
  static made: FakeWindow[] = [];
  opts: Record<string, unknown>;
  url = "";
  protectedFromCapture: boolean | null = null;
  onTop: unknown[] = [];
  destroyed = false;
  webContents = new EventEmitter();
  constructor(opts: Record<string, unknown>) {
    super();
    this.opts = opts;
    FakeWindow.made.push(this);
  }
  setAlwaysOnTop(...a: unknown[]) { this.onTop = a; }
  setVisibleOnAllWorkspaces() {}
  setContentProtection(on: boolean) { this.protectedFromCapture = on; }
  loadURL(u: string) { this.url = u; }
  isDestroyed() { return this.destroyed; }
  show() {}
  getBounds() { return { x: 1, y: 2, width: 300, height: 200 }; }
  close() { this.destroyed = true; this.emit("closed"); }
}

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
function make(platform = "win32", saved: unknown = undefined, freshCode?: () => Promise<string>) {
  FakeWindow.made = [];
  const changes: boolean[] = [];
  const saveBounds = vi.fn();
  const w = pw.createPointsWindow({
    BrowserWindow: FakeWindow, preload: "preload.js", reloadOnCrash: vi.fn(), guardNavigation: vi.fn(), onFocus: vi.fn(),
    screen: { getAllDisplays: () => [{ workArea: AREA }], getPrimaryDisplay: () => ({ workArea: AREA }) },
    platform, appUrl: "http://127.0.0.1:4735", sessionCode: () => "123456", theme: () => "dark",
    bounds: () => saved, saveBounds, onChange: (open: boolean) => changes.push(open), freshCode,
  });
  return { w, changes, saveBounds };
}

describe("points window for calls", () => {
  it("opens the mirror's overlay view on top of everything, sandboxed, under the webcam, left out of screen sharing", async () => {
    const { w, changes } = make();
    await w.show();
    const win = FakeWindow.made[0];
    expect(win.url).toBe("http://127.0.0.1:4735/mirror?compact=1&overlay=1&points=1&private=1&code=123456");
    expect(win.protectedFromCapture).toBe(true);
    expect(win.onTop).toEqual([true, "screen-saver"]);
    expect(win.opts).toMatchObject({ frame: false, alwaysOnTop: true, skipTaskbar: true, width: 380, height: 340, x: 770, y: 8 });
    expect(win.opts.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "preload.js" });
    expect(changes).toEqual([true]);
    await w.show(); // a second switch-on reuses the window
    expect(FakeWindow.made).toHaveLength(1);
  });

  it("says screen sharing can show it where the system cannot hide windows (Linux)", async () => {
    const { w } = make("linux");
    await w.show();
    expect(FakeWindow.made[0].url).toContain("private=0");
    expect(FakeWindow.made[0].protectedFromCapture).toBe(false);
  });

  it("on macOS asks to be left out of capture but does not promise it (ScreenCaptureKit may ignore it)", async () => {
    const { w } = make("darwin");
    await w.show();
    expect(FakeWindow.made[0].protectedFromCapture).toBe(true);
    expect(FakeWindow.made[0].url).toContain("private=0");
  });

  it("closes from the menu, the Display panel or its own button, and reports it", async () => {
    const { w, changes } = make();
    await w.set(true);
    const win = FakeWindow.made[0];
    expect(w.owns(win.webContents)).toBe(true);
    expect(w.owns(new EventEmitter())).toBe(false);
    await w.set("yes"); // only a real true opens: anything else closes
    expect(w.isOpen()).toBe(false);
    expect(w.owns(win.webContents)).toBe(false);
    expect(w.webContents()).toBeNull();
    expect(changes).toEqual([true, false]);
  });

  it("keeps its place, but not one on a screen that is gone", async () => {
    const { w, saveBounds } = make("win32", { x: 100, y: 100, width: 400, height: 260 });
    await w.show();
    expect(FakeWindow.made[0].opts).toMatchObject({ x: 100, y: 100, width: 400 });
    FakeWindow.made[0].emit("moved");
    expect(saveBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 200 });
    const gone = make("win32", { x: 5000, y: 100, width: 400, height: 260 });
    await gone.w.show();
    expect(FakeWindow.made[0].opts).toMatchObject({ x: 770, y: 8 });
    expect(pw.usableBounds({ x: 0, y: 0, width: 50, height: 50 }, [AREA])).toBeNull();
    expect(pw.usableBounds({ x: "a" }, [AREA])).toBeNull();
  });

  it("reloads into a new session only while open", async () => {
    let n = 0;
    const { w } = make("win32", undefined, async () => `00000${++n}`);
    await w.reload();
    expect(FakeWindow.made).toHaveLength(0);
    await w.show();
    expect(FakeWindow.made[0].url).toContain("code=000001");
    await w.reload();
    expect(FakeWindow.made[0].url).toContain("code=000002"); // a code of its own, not the spent one
  });

  it("joins with a pairing code nobody has spent, and does not open when switched off meanwhile", async () => {
    let release: (code: string) => void = () => {};
    const { w, changes } = make("win32", undefined, () => new Promise<string>((r) => (release = r)));
    const first = w.show();
    const second = w.show(); // a double click on the switch opens one window
    release("654321");
    await Promise.all([first, second]);
    expect(FakeWindow.made).toHaveLength(1);
    expect(FakeWindow.made[0].url).toContain("code=654321");
    await w.hide();
    const late = w.show();
    await w.hide(); // switched off before the code came
    release("111111");
    await late;
    expect(FakeWindow.made).toHaveLength(1);
    expect(changes).toEqual([true, false]);
  });
});