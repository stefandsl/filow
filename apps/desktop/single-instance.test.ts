import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { claimSingleInstance, windowToFront, bringToFront } = require("./single-instance.js");

const win = (s: { visible?: boolean; minimized?: boolean; destroyed?: boolean; focused?: boolean; topmost?: boolean } = {}) => ({
  isDestroyed: () => s.destroyed ?? false, isVisible: () => s.visible ?? true, isMinimized: () => s.minimized ?? false,
  isFocused: () => s.focused ?? true, isAlwaysOnTop: () => s.topmost ?? false, setAlwaysOnTop: vi.fn(),
  restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
});

describe("windowToFront", () => {
  it("prefers the welcome, then a shown main window, then the splash", () => {
    const welcome = win(), main = win(), splash = win();
    expect(windowToFront({ welcome, main, splash })).toBe(welcome);
    expect(windowToFront({ welcome: null, main, splash })).toBe(main);
    expect(windowToFront({ welcome: win({ destroyed: true }), main, splash })).toBe(main);
  });
  it("does not show a main window that is still loading behind the splash", () => {
    const main = win({ visible: false }), splash = win();
    expect(windowToFront({ welcome: null, main, splash })).toBe(splash);
    expect(windowToFront({ welcome: null, main, splash: null })).toBeNull();
  });
  it("brings back a minimized main window (Windows reports it as not visible)", () => {
    const main = win({ visible: false, minimized: true });
    expect(windowToFront({ welcome: null, main, splash: null })).toBe(main);
  });
  it("reopens a hidden main window after its first show", () => {
    const main = win({ visible: false });
    expect(windowToFront({ main, mainWasShown: true })).toBe(main);
    expect(windowToFront({ main: win({ destroyed: true }), mainWasShown: true })).toBeNull();
  });
});

describe("bringToFront", () => {
  it("retries refused Windows activation with a temporary raise of the target window", () => {
    const main = win({ minimized: true, focused: false });
    const calls: string[] = [];
    main.restore.mockImplementation(() => calls.push("restore"));
    main.show.mockImplementation(() => calls.push("show"));
    main.focus.mockImplementation(() => calls.push("focus"));
    main.setAlwaysOnTop.mockImplementation(on => calls.push(on ? "raise" : "unpin"));
    bringToFront(main, "win32");
    expect(calls).toEqual(["restore", "show", "focus", "raise", "focus", "unpin"]);
  });
  it("preserves an existing topmost level and leaves ordinary activation alone", () => {
    for (const [platform, window] of [
      ["win32", win({ topmost: true, focused: false })],
      ["win32", win({ focused: true })],
      ["darwin", win({ focused: false })],
      ["linux", win({ focused: false })],
    ] as const) {
      bringToFront(window, platform);
      expect(window.setAlwaysOnTop).not.toHaveBeenCalled();
    }
  });
  it("restores only a minimized window, then shows and focuses it", () => {
    const a = win({ minimized: true }), b = win();
    expect(bringToFront(a)).toBe(true);
    expect(a.restore).toHaveBeenCalledOnce();
    bringToFront(b);
    expect(b.restore).not.toHaveBeenCalled();
    expect(b.show).toHaveBeenCalledOnce();
    expect(b.focus).toHaveBeenCalledOnce();
    expect(bringToFront(null)).toBe(false);
  });
});

describe("claimSingleInstance", () => {
  it("listens for later launches only when it holds the lock", () => {
    const on = vi.fn();
    expect(claimSingleInstance({ requestSingleInstanceLock: () => false, on }, vi.fn())).toBe(false);
    expect(on).not.toHaveBeenCalled();
    const onSecond = vi.fn();
    expect(claimSingleInstance({ requestSingleInstanceLock: () => true, on }, onSecond)).toBe(true);
    on.mock.calls[0][1]({}, ["Filow.exe", "x.md"], "G:/");
    expect(onSecond).toHaveBeenCalledWith({ argv: ["Filow.exe", "x.md"], workingDirectory: "G:/" });
  });
});
