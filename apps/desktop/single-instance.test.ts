import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { claimSingleInstance, windowToFront, bringToFront } = require("./single-instance.js");

const win = (s: { visible?: boolean; minimized?: boolean; destroyed?: boolean } = {}) => ({
  isDestroyed: () => s.destroyed ?? false, isVisible: () => s.visible ?? true, isMinimized: () => s.minimized ?? false,
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
});

describe("bringToFront", () => {
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
