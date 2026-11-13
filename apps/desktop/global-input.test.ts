// Test isolation (global-input.js): with FILOW_QA_NO_GLOBAL_INPUT=1 a Filow instance starts no keyboard
// or mouse hook, registers no global shortcut, opens no real microphone, and never types, pastes or
// copies anything. Each check has a control without the switch, so it cannot pass by doing nothing.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const gi = require("./global-input.js") as {
  SWITCH: string;
  OFF_LINE: string;
  REFUSED_LINE: string;
  globalInputOff(env?: Record<string, string | undefined>, qaBuild?: boolean): boolean;
  refusedInRelease(env?: Record<string, string | undefined>, qaBuild?: boolean): boolean;
  shortcutsFor<T>(s: T, off?: boolean): T;
  clipboardFor<T>(c: T, off?: boolean): T;
  inertUiohook(): { uIOhook: Record<string, (...a: unknown[]) => unknown> & { inert: boolean }; UiohookKey: Record<string, number> };
  permissionAllowed(p: string, o?: { off?: boolean; fakeMic?: boolean }): boolean;
  REFUSED_INSERT: { ok: boolean; action: string; reason: string; chars: number };
};
const { loadUiohook, forgetUiohook } = require("./uiohook.js") as {
  loadUiohook(o?: { env?: Record<string, string>; load?: () => unknown }): { uIOhook: Record<string, (...a: unknown[]) => unknown>; UiohookKey: Record<string, number> };
  forgetUiohook(): void;
};
const { createDictation } = require("./dictation.js") as {
  createDictation(deps: Record<string, unknown>): {
    insert(raw: string, o: { hook?: unknown; keysUp?: () => Promise<boolean> }): Promise<{ ok: boolean; action: string; reason: string; chars: number }>;
    activeChord(talk: string): string | null;
  };
};

const ON = { FILOW_QA_NO_GLOBAL_INPUT: "1" };
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("the switch", () => {
  it("is on only for exactly FILOW_QA_NO_GLOBAL_INPUT=1", () => {
    expect(gi.SWITCH).toBe("FILOW_QA_NO_GLOBAL_INPUT");
    expect(gi.globalInputOff(ON)).toBe(true);
    expect(gi.globalInputOff({})).toBe(false);
    expect(gi.globalInputOff({ FILOW_QA_NO_GLOBAL_INPUT: "0" })).toBe(false);
    expect(gi.globalInputOff({ FILOW_QA_NO_GLOBAL_INPUT: "true" })).toBe(false);
    expect(gi.OFF_LINE).toContain("global input is off");
  });
  // STANDARDS SEC-13: a test switch like the others, so development and QA packages only.
  it("works in development and in a QA package only; a released build asked for it refuses to run", () => {
    expect(gi.globalInputOff(ON, true)).toBe(true);
    expect(gi.globalInputOff(ON, false)).toBe(false);
    expect(gi.refusedInRelease(ON, false)).toBe(true);
    expect(gi.refusedInRelease(ON, true)).toBe(false);
    expect(gi.refusedInRelease({}, false)).toBe(false);
    expect(gi.refusedInRelease({ FILOW_QA_NO_GLOBAL_INPUT: "0" }, false)).toBe(false);
    expect(gi.REFUSED_LINE).toContain("FILOW_QA_NO_GLOBAL_INPUT=1");
    // the build is asked through qa.js, the one place that knows a QA package
    expect(source("global-input.js")).toContain('require("./qa.js").isQaBuild()');
  });
  it("every test switch the desktop shell reads from the environment sits behind the QA build gate", () => {
    const loose: string[] = [];
    for (const name of readdirSync(new URL(".", import.meta.url)).filter((n) => n.endsWith(".js"))) {
      const lines = source(name).split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l) || !/process\.env\.FILOW_(QA_|OKF_QA|OKF_FAKE)/.test(l)) return;
        const near = lines.slice(Math.max(0, i - 2), i + 2).join("\n");
        if (!/isQaBuild\(|QA_ALLOWED/.test(near)) loose.push(`${name}:${i + 1}`);
      });
    }
    expect(loose).toEqual([]);
  });
});

describe("global shortcuts", () => {
  it("none is registered with the switch on; without it Electron's own are used", () => {
    const real = { register: vi.fn(() => true), registerAll: vi.fn(), isRegistered: vi.fn(() => true), unregister: vi.fn(), unregisterAll: vi.fn() };
    const off = gi.shortcutsFor(real, true);
    expect(off.register("Control+Alt+Shift+H", () => {})).toBe(false);
    off.registerAll(["A"], () => {});
    expect(off.isRegistered("Control+Alt+Shift+H")).toBe(false);
    off.unregister("A");
    off.unregisterAll();
    expect(real.register).not.toHaveBeenCalled();
    expect(real.registerAll).not.toHaveBeenCalled();
    // control
    expect(gi.shortcutsFor(real, false)).toBe(real);
  });
});

describe("the clipboard", () => {
  it("is never written or cleared with the switch on; reads still work", async () => {
    const real = { writeText: vi.fn(), write: vi.fn(), writeHTML: vi.fn(), writeBuffer: vi.fn(), writeImage: vi.fn(), clear: vi.fn(), readText: vi.fn(() => "theirs") };
    const off = gi.clipboardFor(real, true);
    off.writeText("mine");
    await off.write([]);
    off.writeHTML("<b>mine</b>");
    off.writeBuffer("x", Buffer.from("mine"));
    off.writeImage({});
    off.clear();
    for (const fn of [real.writeText, real.write, real.writeHTML, real.writeBuffer, real.writeImage, real.clear]) expect(fn).not.toHaveBeenCalled();
    expect(off.readText()).toBe("theirs");
    // control
    gi.clipboardFor(real, false).writeText("mine");
    expect(real.writeText).toHaveBeenCalledWith("mine");
  });
});

describe("the keyboard and mouse hook", () => {
  it("the library is not loaded with the switch on: start, keyTap and listeners do nothing", () => {
    forgetUiohook();
    const load = vi.fn(() => ({ uIOhook: { start: vi.fn() }, UiohookKey: {} }));
    const lib = loadUiohook({ env: ON, load });
    expect(load).not.toHaveBeenCalled();
    expect((lib.uIOhook as { inert?: boolean }).inert).toBe(true);
    const heard = vi.fn();
    lib.uIOhook.on("keydown", heard);
    lib.uIOhook.start();
    lib.uIOhook.keyTap(lib.UiohookKey.V, [lib.UiohookKey.Ctrl]);
    lib.uIOhook.stop();
    expect(heard).not.toHaveBeenCalled();
    // The key codes the callers build their tables from are all different and belong to no real key.
    const codes = ["Ctrl", "CtrlRight", "Alt", "AltRight", "Shift", "ShiftRight", "Meta", "MetaRight", "Escape", "Enter", "NumpadEnter", "Tab", "V", "F24"].map((k) => lib.UiohookKey[k]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c < 0)).toBe(true);
    expect(lib.UiohookKey.Ctrl).toBe(lib.UiohookKey.Ctrl);
    forgetUiohook();
  });

  it("control: without the switch the real library is loaded", () => {
    forgetUiohook();
    const real = { uIOhook: { start: vi.fn() }, UiohookKey: {} };
    const load = vi.fn(() => real);
    expect(loadUiohook({ env: {}, load })).toBe(real);
    expect(load).toHaveBeenCalledOnce();
    forgetUiohook();
  });

  it("uiohook-napi is required in one place only, behind the switch", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".js"));
    const users = files.filter((f) => /require\(["']uiohook-napi["']\)/.test(source(f)));
    expect(users).toEqual(["uiohook.js"]);
    const src = source("uiohook.js");
    expect(src.indexOf("if (globalInputOff(env)) return (loaded = inertUiohook());")).toBeGreaterThan(0);
    expect(src.indexOf("if (globalInputOff(env))")).toBeLessThan(src.indexOf("loaded = load();"));
  });
});

describe("the microphone", () => {
  it("the permission is refused with the switch on, unless a test recording stands in for it", () => {
    expect(gi.permissionAllowed("media", { off: true })).toBe(false);
    expect(gi.permissionAllowed("media", { off: true, fakeMic: true })).toBe(true);
    expect(gi.permissionAllowed("media", { off: false })).toBe(true);
    expect(gi.permissionAllowed("display-capture", { off: true })).toBe(true);
    expect(gi.permissionAllowed("notifications", { off: true })).toBe(true);
    expect(gi.permissionAllowed("geolocation", { off: false })).toBe(false);
  });
});

describe("dictation: typing, pasting and copying", () => {
  function make(env: Record<string, string>) {
    const calls = { paste: 0, type: 0, write: 0, hookPaste: 0 };
    const item = { data: { "text/plain": "theirs" }, types: ["text/plain"], getType: async () => "theirs" };
    class Item { constructor(public data: Record<string, unknown>) {} get types() { return Object.keys(this.data); } async getType(t: string) { return this.data[t]; } }
    const log: string[] = [];
    const d = createDictation({
      getSettings: () => ({ dictation: { v: 2, enabled: true, removeFillers: false } }),
      saveSettings: () => {},
      logLine: (l: string) => log.push(l),
      clipboard: { read: async () => [item], readText: async () => "theirs", write: async () => { calls.write++; }, writeText: async () => { calls.write++; }, clear: async () => { calls.write++; } },
      ClipboardItem: Item,
      BrowserWindow: { getFocusedWindow: () => null },
      sendPaste: () => { calls.hookPaste++; },
      target: () => ({
        info: () => ({ hwnd: 100, pid: 5, exe: "Notepad.exe", cls: "Notepad", focusCls: "Edit", elevated: 0, selfElevated: 0, own: false, password: false, passwordChecked: true, remote: false }),
        sendPaste: () => { calls.paste++; return 4; },
        typeText: (t: string) => { calls.type++; return 2 * t.length; },
      }),
      platform: "win32",
      env,
    });
    return { d, calls, log };
  }

  it("with the switch on nothing is pasted, typed or put on the clipboard, and the keys are not watched", async () => {
    const { d, calls, log } = make(ON);
    const r = await d.insert("hello there", { hook: {}, keysUp: async () => true });
    expect(r).toEqual(gi.REFUSED_INSERT);
    expect(calls).toEqual({ paste: 0, type: 0, write: 0, hookPaste: 0 });
    expect(d.activeChord("ctrl+alt")).toBeNull();
    expect(log.join("\n")).toContain("global input is off");
  });

  it("control: without the switch the same dictation writes the clipboard and sends the paste keys", async () => {
    vi.useFakeTimers();
    try {
      const { d, calls } = make({});
      const done = d.insert("hello there", { hook: {}, keysUp: async () => true });
      await vi.advanceTimersByTimeAsync(5000);
      const r = await done;
      expect(r.action).not.toBe("none");
      expect(calls.write).toBeGreaterThan(0);
      expect(calls.paste).toBe(1);
      expect(d.activeChord("ctrl+alt")).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe("OK Filow's own wiring (okfilow.js)", () => {
  const src = source("okfilow.js");
  it("takes its global shortcuts through the switch", () => {
    expect(src).toContain("globalShortcut: electronShortcuts,");
    expect(src).toContain("const globalShortcut = shortcutsFor(electronShortcuts, INPUT_OFF);");
    expect(src).toContain("const INPUT_OFF = globalInputOff();");
    // Electron's own object is named once, in the import, and once where it is wrapped.
    expect(src.match(/electronShortcuts/g)?.length).toBe(2);
  });
  it("does not start the hook's retry loop, type text, start a dictation, read another window's selection or take the focus", () => {
    expect(src).toMatch(/function startHook\(\) \{\s*if \(!INPUT_OFF\) return hookRetry\.attempt\(\);/);
    expect(src).toMatch(/async function typeText\(text, spokenLanguage, phrase = false\) \{\s*if \(INPUT_OFF\) return \{ \.\.\.REFUSED_INSERT \};/);
    // A dictation starts under the switch only when a test asks for it through the QA key path
    // (FILOW_OKF_QA_KEYS=1): the hook is the stand-in, so the keys of the person at the PC never get
    // there, the microphone is the test recording or nothing, and typeText above still types nothing.
    expect(src).toContain('if (held || (kind === "dictate" && INPUT_OFF && !QA_KEYS) || !(');
    expect(src).toContain('const QA_KEYS = QA_ALLOWED && process.env.FILOW_OKF_QA_KEYS === "1";');
    expect(src).toContain('selection = INPUT_OFF ? Promise.resolve("") : readSelection();');
    expect(src).toMatch(/if \(INPUT_OFF\) \{ if \(showWindow\(p, "panel", true\)\) p\.moveTop\(\); return; \}\s*try \{ if \(hook\) hook\.keyTap/);
    // The only raw hook start is inside registerHook, which the switch reaches with the stand-in library.
    expect(src.match(/uIOhook\.start\(\)/g)?.length).toBe(1);
  });
});
