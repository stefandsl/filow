import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createDictation } = require("./dictation.js") as {
  createDictation(deps: Record<string, unknown>): { cfg(): Record<string, unknown>; configure(p: Record<string, unknown>): Record<string, unknown> };
};

function make(initial: Record<string, unknown>) {
  let settings = initial;
  const d = createDictation({
    getSettings: () => settings,
    saveSettings: (s: Record<string, unknown>) => { settings = s; },
    logLine: () => {},
    clipboard: {},
    platform: "win32",
    env: {},
  });
  return { d, stored: () => settings.dictation as Record<string, unknown> };
}

describe("dictation settings on disk (issue #3)", () => {
  it("a new install removes fillers and plays the sound", () => {
    expect(make({}).d.cfg()).toMatchObject({ removeFillers: true, sound: true, mode: "hold", insert: "paste", chord: "ctrl+meta" });
  });

  it("changing one setting saves that one only; the others keep following the defaults", () => {
    const { d, stored } = make({});
    d.configure({ chord: "Alt + Win" });
    expect(stored()).toEqual({ v: 2, chord: "alt+meta" });
    expect(d.cfg()).toMatchObject({ chord: "alt+meta", removeFillers: true, sound: true });
  });

  it("a user who turns one off keeps it off", () => {
    const { d, stored } = make({});
    d.configure({ sound: false });
    d.configure({ mode: "toggle" });
    expect(stored()).toEqual({ v: 2, sound: false, mode: "toggle" });
    expect(d.cfg()).toMatchObject({ sound: false, removeFillers: true, mode: "toggle" });
  });

  it("junk from the renderer is cleaned before it is saved", () => {
    const { d, stored } = make({});
    d.configure({ mode: "sideways", sound: "loud" });
    expect(stored()).toEqual({ v: 2, mode: "hold", sound: true });
  });
});
