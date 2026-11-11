// The pill's controls in the desktop shell (docs/okfilow/PILL.md): the eye as a strict privacy
// switch, Pause/Resume, the two shortcuts, and when an overlay takes the mouse.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const stop = require("./okfilow-stop.js");
const { overlayMouse, pillState, pillLive, mayCapture, screenSources, pillAction, pauseKeyAction, EYE_KEYS, PAUSE_KEYS, keyChoice, accelerator, bindKey } = stop;
const { DEFAULTS, nextCfg, HOTKEYS } = require("./okfilow.js");
const { shortcutsFor } = require("./global-input.js");
const { createGestures } = require("./okfilow-gestures.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = (name: string) => fs.readFileSync(path.join(here, name), "utf8");

describe("the eye closed means no picture of the screen, whoever asks", () => {
  it("no picture may be taken when the setting is off, or when the panel asked for none", () => {
    expect(mayCapture({ images: true, seeScreen: "on" })).toBe(true);
    expect(mayCapture({ images: undefined, seeScreen: "auto" })).toBe(true);
    expect(mayCapture({ images: false, seeScreen: "on" })).toBe(false);
    expect(mayCapture({ images: true, seeScreen: "off" })).toBe(false);
    expect(mayCapture({ images: undefined, seeScreen: "off" })).toBe(false);
    expect(mayCapture()).toBe(true);
  });

  it("the screen capturer is not even called: counted", async () => {
    let calls = 0;
    const grab = async () => { calls++; return ["screen 1"]; };
    expect(await screenSources({ images: true, seeScreen: "off" }, grab)).toEqual([]);
    expect(await screenSources({ images: false, seeScreen: "on" }, grab)).toEqual([]);
    expect(await screenSources({ images: false, seeScreen: "off" }, grab)).toEqual([]);
    expect(calls).toBe(0);
    expect(await screenSources({ images: true, seeScreen: "on" }, grab)).toEqual(["screen 1"]);
    expect(await screenSources({ images: undefined, seeScreen: "auto" }, grab)).toEqual(["screen 1"]);
    expect(calls).toBe(2);
  });

  it("the shell takes pictures only through that gate, with the stored setting", () => {
    const main = source("okfilow.js");
    expect(main.match(/desktopCapturer\.getSources/g)).toHaveLength(1);
    expect(main).toContain("const want = { images: opts.images, seeScreen: cfg().seeScreen };");
    expect(main).toMatch(/await screenSources\(want, async \(\) => \{[^}]*desktopCapturer\.getSources/);
  });

  it("the choice is stored, survives every other settings change, and nothing but the user turns it back", () => {
    const closed = nextCfg(DEFAULTS, { seeScreen: "off" });
    expect(closed.seeScreen).toBe("off");
    // What is written to settings.json and read back at the next start.
    const restarted = { ...DEFAULTS, ...JSON.parse(JSON.stringify(closed)) };
    expect(restarted.seeScreen).toBe("off");
    for (const patch of [{ color: "#ffffff" }, { provider: "cloud" }, { voice: "natural" }, { enabled: false }, { askWordsOnly: ["x"] }, { eyeKey: "none" }, {}, undefined]) {
      expect(nextCfg(restarted, patch).seeScreen).toBe("off");
    }
    expect(nextCfg(restarted, { seeScreen: "on" }).seeScreen).toBe("on");
    // A value that is not a choice falls back to "auto", never to a guess.
    expect(nextCfg(restarted, { seeScreen: "yes" }).seeScreen).toBe("auto");
    // The only writers of the setting: the stored default and its check here; the panel sends the user's own on or off.
    const writes = source("okfilow.js").split(/\r?\n/).filter((l) => /seeScreen\s*[:=]/.test(l)).map((l) => l.trim());
    expect(writes).toEqual(['seeScreen: "auto",', "next.seeScreen = seeChoice(next.seeScreen);", "const want = { images: opts.images, seeScreen: cfg().seeScreen };"]);
  });
});

describe("the pill's state and the mouse", () => {
  it("what the panel says is taken strictly", () => {
    expect(pillState(null)).toEqual({ sees: true, paused: false, resumable: false });
    expect(pillState({ sees: false, paused: true, resumable: true })).toEqual({ sees: false, paused: true, resumable: true });
    expect(pillState({ sees: "no", paused: 1, resumable: "yes" })).toEqual({ sees: true, paused: false, resumable: false });
  });

  it("the pill has controls during an answer, while listening, and on a stopped answer that can be carried on", () => {
    const idle = pillState(null);
    expect(["idle", "listening", "thinking", "speaking", "error"].filter((m) => pillLive(m, idle))).toEqual(["listening", "thinking", "speaking"]);
    expect(pillLive("idle", pillState({ resumable: true }))).toBe(true);
    expect(pillLive("idle", pillState({ paused: true }))).toBe(false);
  });

  it("an overlay takes the mouse only while the pointer is on a control of a pill that has any", () => {
    const idle = pillState(null);
    for (const mode of ["idle", "listening", "thinking", "speaking", "error"]) expect(overlayMouse({ caught: false, hover: false, mode, pill: pillState({ resumable: true }) })).toEqual({ ignore: true });
    expect(overlayMouse({ caught: false, hover: true, mode: "thinking", pill: idle })).toEqual({ ignore: false });
    expect(overlayMouse({ caught: false, hover: true, mode: "speaking", pill: pillState({ paused: true }) })).toEqual({ ignore: false });
    // the eye while listening hands-free
    expect(overlayMouse({ caught: false, hover: true, mode: "listening", pill: idle })).toEqual({ ignore: false });
    // the stopped pill: Resume is clickable although nothing is in progress
    expect(overlayMouse({ caught: false, hover: true, mode: "idle", pill: pillState({ resumable: true }) })).toEqual({ ignore: false });
    // a hover left over once the pill is gone must not swallow the user's clicks
    expect(overlayMouse({ caught: false, hover: true, mode: "idle", pill: idle })).toEqual({ ignore: true });
    expect(overlayMouse({ caught: false, hover: true, mode: "error", pill: idle })).toEqual({ ignore: true });
  });

  it("only the four actions pass, and the Pause/Resume key acts only when there is something to pause or carry on", () => {
    expect(["eye", "pause", "resume", "stop"].map(pillAction)).toEqual(["eye", "pause", "resume", "stop"]);
    expect(["quit", "", null, undefined, 3, { action: "eye" }].map(pillAction)).toEqual([null, null, null, null, null, null]);
    const idle = pillState(null);
    expect(pauseKeyAction("thinking", idle)).toBe("pause");
    expect(pauseKeyAction("speaking", idle)).toBe("pause");
    expect(pauseKeyAction("thinking", pillState({ paused: true }))).toBe("resume");
    expect(pauseKeyAction("idle", pillState({ resumable: true }))).toBe("resume");
    expect(pauseKeyAction("idle", idle)).toBe(null);
    expect(pauseKeyAction("listening", idle)).toBe(null);
    expect(pauseKeyAction("error", idle)).toBe(null);
  });
});

describe("the two shortcuts", () => {
  type Registered = Map<string, () => void>;
  const fakeShortcuts = (taken: string[] = []) => {
    const map: Registered = new Map();
    const log: string[] = [];
    return {
      map, log,
      register(acc: string, fn: () => void) { log.push(`register ${acc}`); if (taken.includes(acc)) return false; map.set(acc, fn); return true; },
      unregister(acc: string) { log.push(`unregister ${acc}`); map.delete(acc); },
    };
  };

  it("are Ctrl+Alt+Shift+H and Ctrl+Alt+Shift+G by default, with one other choice each and none", () => {
    expect(EYE_KEYS).toEqual(["ctrl+alt+shift+h", "ctrl+alt+shift+f7", "none"]);
    expect(PAUSE_KEYS).toEqual(["ctrl+alt+shift+g", "ctrl+alt+shift+f8", "none"]);
    expect(DEFAULTS.eyeKey).toBe("ctrl+alt+shift+h");
    expect(DEFAULTS.pauseKey).toBe("ctrl+alt+shift+g");
    expect(accelerator("ctrl+alt+shift+h")).toBe("Control+Alt+Shift+H");
    expect(accelerator("ctrl+alt+shift+f8")).toBe("Control+Alt+Shift+F8");
    expect(accelerator("none")).toBe(null);
    expect(accelerator(undefined)).toBe(null);
    // Three modifiers: never one of the two-modifier talk and dictation chords.
    for (const k of [...EYE_KEYS, ...PAUSE_KEYS].filter((x) => x !== "none")) {
      expect(k.split("+").slice(0, 3)).toEqual(["ctrl", "alt", "shift"]);
      expect(HOTKEYS).not.toContain(k);
    }
  });

  it("a stored choice that is not on the list becomes the default; none stays none", () => {
    expect(keyChoice("ctrl+alt+shift+f7", EYE_KEYS)).toBe("ctrl+alt+shift+f7");
    expect(keyChoice("none", EYE_KEYS)).toBe("none");
    expect(keyChoice("ctrl+q", EYE_KEYS)).toBe("ctrl+alt+shift+h");
    expect(nextCfg(DEFAULTS, { eyeKey: "ctrl+c", pauseKey: 7 })).toMatchObject({ eyeKey: "ctrl+alt+shift+h", pauseKey: "ctrl+alt+shift+g" });
    expect(nextCfg(DEFAULTS, { eyeKey: "none", pauseKey: "ctrl+alt+shift+f8" })).toMatchObject({ eyeKey: "none", pauseKey: "ctrl+alt+shift+f8" });
  });

  it("registering: the handler runs on the key, a changed choice lets go of the old key, none registers nothing", () => {
    const s = fakeShortcuts();
    let pressed = 0;
    const first = bindKey(s, null, "ctrl+alt+shift+h", () => { pressed++; });
    expect(first).toEqual({ choice: "ctrl+alt+shift+h", accelerator: "Control+Alt+Shift+H", state: "ok" });
    s.map.get("Control+Alt+Shift+H")!();
    expect(pressed).toBe(1);
    const second = bindKey(s, first, "ctrl+alt+shift+f7", () => { pressed++; });
    expect(second.state).toBe("ok");
    expect([...s.map.keys()]).toEqual(["Control+Alt+Shift+F7"]);
    const none = bindKey(s, second, "none", () => {});
    expect(none).toEqual({ choice: "none", accelerator: null, state: "none" });
    expect(s.map.size).toBe(0);
    expect(s.log).toEqual(["register Control+Alt+Shift+H", "unregister Control+Alt+Shift+H", "register Control+Alt+Shift+F7", "unregister Control+Alt+Shift+F7"]);
  });

  it("a key Windows refuses is reported as taken, and a refusal that throws too", () => {
    const s = fakeShortcuts(["Control+Alt+Shift+G"]);
    expect(bindKey(s, null, "ctrl+alt+shift+g", () => {})).toEqual({ choice: "ctrl+alt+shift+g", accelerator: null, state: "taken" });
    const throwing = { register() { throw new Error("no"); }, unregister() {} };
    expect(bindKey(throwing, null, "ctrl+alt+shift+g", () => {}).state).toBe("taken");
    // The next choice is tried without touching a key that was never ours.
    expect(bindKey(s, { accelerator: null }, "ctrl+alt+shift+f8", () => {}).state).toBe("ok");
    expect(s.log).toEqual(["register Control+Alt+Shift+G", "register Control+Alt+Shift+F8"]);
  });

  it("under test isolation nothing is registered, and that is not called taken", () => {
    const s = fakeShortcuts();
    expect(bindKey(s, null, "ctrl+alt+shift+h", () => {}, { inputOff: true })).toEqual({ choice: "ctrl+alt+shift+h", accelerator: null, state: "off" });
    expect(s.log).toEqual([]);
    // And the shell's shortcuts are the stand-in then: even a direct register does nothing.
    const real = fakeShortcuts();
    expect(shortcutsFor(real, true).register("Control+Alt+Shift+H", () => {})).toBe(false);
    expect(real.log).toEqual([]);
  });

  it("the shell registers them through the isolation switch, re-registers on a change, and the QA keys do the same as the shortcuts", () => {
    const main = source("okfilow.js");
    expect(main).toContain("const globalShortcut = shortcutsFor(electronShortcuts, INPUT_OFF);");
    expect(main).toMatch(/eyeBound = bindKey\(globalShortcut, eyeBound, want\(c\.eyeKey\), \(\) => control\("eye", "key"\), \{ inputOff: INPUT_OFF \}\);/);
    expect(main).toMatch(/pauseBound = bindKey\(globalShortcut, pauseBound, want\(c\.pauseKey\), \(\) => control\(pauseKeyAction\(mode, pill\), "key"\), \{ inputOff: INPUT_OFF \}\);/);
    // at start, and on every settings change
    expect(main).toMatch(/startHook\(\);\s*bindPillKeys\(\);/);
    expect(main).toMatch(/refreshTray\(\);\s*bindPillKeys\(\);/);
    expect(main).toContain('if (type === "down" && key === "eye") return void control("eye", "key");');
    expect(main).toContain('if (type === "down" && key === "pause") return void control(pauseKeyAction(mode, pill), "key");');
    // the panel is told when Windows refused a key
    expect(main).toContain("eyeKeyState: eyeBound.state, pauseKeyState: pauseBound.state");
    // electron's own globalShortcut is used nowhere else in the shell
    expect(main.match(/electronShortcuts/g)).toHaveLength(2);
  });

  it("the control channel: overlays and the panel reach main, main tells the panel and every overlay, also one that loads later", () => {
    const main = source("okfilow.js");
    expect(main).toContain('ipcMain.on("okfilow:control", (e, action) => { if (ourSender(e)) control(pillAction(action), "button"); });');
    expect(main).toContain('sendPanel("okfilow:control", { action, source });');
    expect(main).toContain('if (action === "stop") return stopAnswer(source === "key" ? "escape" : "button");');
    expect(main).toContain('sendOverlays("okfilow:pill", pill);');
    expect(main.match(/send\("okfilow:pill", pill\);/g)).toHaveLength(2);
    // only the panel may say what the pill shows
    expect(main).toContain("e.sender !== panel.webContents) return;");
    const preload = source("okfilow-preload.js");
    expect(preload).toContain('control: (action) => ipcRenderer.send("okfilow:control", action)');
    expect(preload).toContain('onControl: on("okfilow:control")');
    expect(preload).toContain('pill: (state) => ipcRenderer.send("okfilow:pill", state)');
    expect(preload).toContain('onPill: on("okfilow:pill")');
  });
});

describe("the shortcuts and the talk keys", () => {
  let events: string[];
  let g: { keydown(m: string | null): void; keyup(m: string | null): void };
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    g = createGestures({ talk: () => "ctrl+alt", dictate: () => "ctrl+meta", emit: (e: string) => events.push(e) });
  });
  afterEach(() => vi.useRealTimers());

  it("Ctrl, Alt, Shift, H pressed in quick succession is not a talk chord: nothing happens", () => {
    g.keydown("ctrl"); vi.advanceTimersByTime(30);
    g.keydown("alt"); vi.advanceTimersByTime(30);
    g.keydown("shift"); vi.advanceTimersByTime(30);
    g.keydown(null); vi.advanceTimersByTime(60);
    g.keyup(null); g.keyup("shift"); g.keyup("alt"); g.keyup("ctrl");
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([]);
  });

  it("the same with every talk chord a user can choose", () => {
    for (const chord of ["ctrl+alt", "ctrl+shift", "alt+shift", "ctrl+meta"]) {
      events = [];
      g = createGestures({ talk: () => chord, dictate: () => null, emit: (e: string) => events.push(e) });
      for (const m of ["ctrl", "alt", "shift"]) { g.keydown(m); vi.advanceTimersByTime(40); }
      g.keydown(null); vi.advanceTimersByTime(50);
      g.keyup(null); g.keyup("shift"); g.keyup("alt"); g.keyup("ctrl");
      vi.advanceTimersByTime(1000);
      expect(events, chord).toEqual([]);
    }
  });

  it("Ctrl+Alt held longer than a quarter of a second before Shift: talk starts, and adding Shift ends it at once", () => {
    g.keydown("ctrl"); g.keydown("alt");
    vi.advanceTimersByTime(300);
    expect(events).toEqual(["talk:start"]);
    g.keydown("shift");
    const afterShift = [...events];
    g.keydown(null);
    g.keyup(null); g.keyup("shift"); g.keyup("alt"); g.keyup("ctrl");
    vi.advanceTimersByTime(1000);
    // The question ends there, as if the keys had been let go; the shortcut's own key adds nothing.
    expect(afterShift).toEqual(["talk:start", "talk:end"]);
    expect(events).toEqual(afterShift);
  });
});
