import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Win = { show: () => void; showInactive: () => void; isDestroyed?: () => boolean };
const h = require("./qa-headless.js") as {
  SWITCH: string;
  headless: (env: Record<string, string>, qaBuild: boolean) => boolean;
  refusedInRelease: (env: Record<string, string>, qaBuild: boolean) => boolean;
  setHeadless: (on: boolean | null, log?: (line: string) => void) => void;
  showWindow: (win: Win | null, name: string, inactive?: boolean) => boolean;
  trayFor: <T>(Tray: T) => T;
  dialogFor: <T>(dialog: T) => T;
};

const fakeWindow = (destroyed = false) => ({ show: vi.fn(), showInactive: vi.fn(), isDestroyed: () => destroyed });
afterEach(() => h.setHeadless(false, () => {}));

describe("FILOW_QA_HEADLESS: nothing of a measured run appears on screen", () => {
  it("is on only when asked for, and only in development or a QA package; a released build refuses it", () => {
    expect(h.headless({ FILOW_QA_HEADLESS: "1" }, true)).toBe(true);
    expect(h.headless({ FILOW_QA_HEADLESS: "1" }, false)).toBe(false);
    expect(h.headless({ FILOW_QA_HEADLESS: "true" }, true)).toBe(false);
    expect(h.headless({}, true)).toBe(false);
    expect(h.refusedInRelease({ FILOW_QA_HEADLESS: "1" }, false)).toBe(true);
    expect(h.refusedInRelease({ FILOW_QA_HEADLESS: "1" }, true)).toBe(false);
    expect(h.refusedInRelease({}, false)).toBe(false);
  });

  // One case per window the shell shows: the splash, the main window (start and watchdog), the panel and
  // the notice panel, the model and whiteboard windows, the overlays.
  for (const [name, inactive] of [["splash", true], ["main window", false], ["main window", true], ["panel", false], ["panel", true], ["model window", true], ["whiteboard", false], ["overlay", true]] as const) {
    it(`keeps the ${name} hidden${inactive ? " (shown without focus otherwise)" : ""} and says so`, () => {
      const lines: string[] = [];
      h.setHeadless(true, (l) => lines.push(l));
      const w = fakeWindow();
      expect(h.showWindow(w, name, inactive)).toBe(false);
      expect(w.show).not.toHaveBeenCalled();
      expect(w.showInactive).not.toHaveBeenCalled();
      expect(lines).toEqual([`qa headless: kept hidden ${name}`]);
    });
  }

  it("shows windows as before when it is off: show, or showInactive without taking the focus", () => {
    h.setHeadless(false);
    const a = fakeWindow();
    expect(h.showWindow(a, "main window")).toBe(true);
    expect(a.show).toHaveBeenCalledTimes(1);
    const b = fakeWindow();
    expect(h.showWindow(b, "overlay", true)).toBe(true);
    expect(b.showInactive).toHaveBeenCalledTimes(1);
    expect(b.show).not.toHaveBeenCalled();
    expect(h.showWindow(fakeWindow(true), "panel")).toBe(false);
    expect(h.showWindow(null, "panel")).toBe(false);
  });

  it("puts no tray icon in the taskbar, with a stand-in that has the tray's methods", () => {
    const lines: string[] = [];
    h.setHeadless(true, (l) => lines.push(l));
    const RealTray = vi.fn();
    const T = h.trayFor(RealTray as unknown as new (img: unknown) => Record<string, (...a: unknown[]) => unknown>);
    const tray = new T({});
    expect(RealTray).not.toHaveBeenCalled();
    for (const m of ["setToolTip", "setContextMenu", "on", "getBounds", "destroy", "isDestroyed"]) expect(typeof tray[m]).toBe("function");
    expect(tray.getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    tray.destroy();
    expect(tray.isDestroyed()).toBe(true);
    expect(lines).toEqual(["qa headless: kept hidden tray icon"]);
    h.setHeadless(false);
    expect(h.trayFor(RealTray)).toBe(RealTray);
  });

  it("answers every message box with its cancel button without opening it (API key, PowerPoint, firewall, local AI, updates, start failure)", async () => {
    const lines: string[] = [];
    h.setHeadless(true, (l) => lines.push(l));
    const real = { showMessageBox: vi.fn(), showMessageBoxSync: vi.fn(), showErrorBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), other: () => "kept" };
    const d = h.dialogFor(real);
    const win = {};
    expect(await d.showMessageBox(win as never, { title: "PowerPoint", message: "QUOKKA-4417", buttons: ["Yes", "No"] } as never)).toEqual({ response: 1, checkboxChecked: false });
    expect(await d.showMessageBox({ title: "Filow", buttons: ["Allow", "Later"], cancelId: 0 } as never)).toEqual({ response: 0, checkboxChecked: false });
    expect(d.showMessageBoxSync({ title: "Filow", cancelId: 0 } as never)).toBe(0);
    d.showErrorBox("Filow failed to start" as never, "stack" as never);
    expect(await d.showOpenDialog({} as never)).toEqual({ canceled: true, filePaths: [] });
    expect(await d.showSaveDialog({} as never)).toEqual({ canceled: true, filePath: "" });
    expect(d.other()).toBe("kept");
    for (const f of [real.showMessageBox, real.showMessageBoxSync, real.showErrorBox, real.showOpenDialog, real.showSaveDialog]) expect(f).not.toHaveBeenCalled();
    expect(lines.slice(0, 4)).toEqual(["qa headless: dialog suppressed PowerPoint", "qa headless: dialog suppressed Filow", "qa headless: dialog suppressed Filow", "qa headless: dialog suppressed Filow failed to start"]);
    expect(lines.join("\n")).not.toContain("QUOKKA");
    h.setHeadless(false);
    expect(h.dialogFor(real)).toBe(real);
  });
});
