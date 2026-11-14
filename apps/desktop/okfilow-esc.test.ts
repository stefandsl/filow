// "Even if I press Esc it does not work" (owner, 14/11): the 3D window and the overlays never have the
// keyboard, so their own Escape handlers never ran. Escape is now a global shortcut held only while
// something of OK Filow is on screen.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { escTarget, createEscKey, KEY, TWICE_MS } = require("./okfilow-esc.js") as {
  escTarget: (o: { model?: boolean; items?: boolean; bubble?: boolean; lastAt?: number; now?: number }) => string | null;
  createEscKey: (o: { shortcuts: unknown; onEsc: () => void }) => { sync(shown: boolean): boolean; held(): boolean };
  KEY: string;
  TWICE_MS: number;
};
const { shortcutsFor } = require("./global-input.js") as { shortcutsFor: (real: unknown, off: boolean) => { register(k: string, f: () => void): boolean; unregister(k: string): void; isRegistered(k: string): boolean } };

function fakeShortcuts() {
  const keys = new Map<string, () => void>();
  return {
    keys,
    register: vi.fn((k: string, f: () => void) => { keys.set(k, f); return true; }),
    unregister: vi.fn((k: string) => { keys.delete(k); }),
    isRegistered: (k: string) => keys.has(k),
  };
}

describe("Escape is held only while OK Filow shows something", () => {
  it("registers Escape when something is shown, releases it when nothing is: other apps keep their Escape", () => {
    const s = fakeShortcuts();
    const onEsc = vi.fn();
    const esc = createEscKey({ shortcuts: s, onEsc });
    expect(esc.sync(false)).toBe(false);
    expect(s.register).not.toHaveBeenCalled();
    expect(esc.sync(true)).toBe(true);
    expect(s.keys.has(KEY)).toBe(true);
    esc.sync(true);
    expect(s.register).toHaveBeenCalledTimes(1);
    s.keys.get(KEY)!();
    expect(onEsc).toHaveBeenCalledTimes(1);
    expect(esc.sync(false)).toBe(false);
    expect(s.keys.has(KEY)).toBe(false);
    expect(s.unregister).toHaveBeenCalledWith(KEY);
  });
  it("another app holding Escape: OK Filow does not claim it held", () => {
    const s = { register: () => false, unregister: vi.fn(), isRegistered: () => false };
    const esc = createEscKey({ shortcuts: s, onEsc: () => {} });
    expect(esc.sync(true)).toBe(false);
    esc.sync(false);
    expect(s.unregister).not.toHaveBeenCalled();
  });
  it("a test run (FILOW_QA_NO_GLOBAL_INPUT) registers nothing", () => {
    const real = fakeShortcuts();
    const esc = createEscKey({ shortcuts: shortcutsFor(real, true), onEsc: () => {} });
    esc.sync(true);
    expect(real.register).not.toHaveBeenCalled();
  });
});

describe("what one press closes", () => {
  it("the topmost thing: the 3D window, then the pictures and cards, then the bubble; nothing when nothing is shown", () => {
    expect(escTarget({ model: true, items: true, bubble: true, now: 10_000 })).toBe("model");
    expect(escTarget({ items: true, bubble: true, now: 10_000 })).toBe("items");
    expect(escTarget({ bubble: true, now: 10_000 })).toBe("bubble");
    expect(escTarget({ now: 10_000 })).toBeNull();
  });
  it("a second press soon after closes everything", () => {
    expect(escTarget({ items: true, bubble: true, lastAt: 10_000, now: 10_000 + TWICE_MS - 1 })).toBe("all");
    expect(escTarget({ items: true, bubble: true, lastAt: 10_000, now: 10_000 + TWICE_MS + 1 })).toBe("items");
  });
});

describe("wiring", () => {
  const main = fs.readFileSync(path.join(__dirname, "okfilow.js"), "utf8");
  it("held while the 3D window, pictures, cards, marks, bubble or an answer are shown; released on quit; no double Escape from the hook", () => {
    expect(main).toContain("escKey.sync(modelShown() || pinned() || bubble.open() || answering(mode))");
    expect(main).toMatch(/clearInterval\(escTimer\);\s*escKey\.sync\(false\);/);
    expect(main).toContain("if (e.keycode === K.Escape && !escKey.held()) onEscape();");
    expect(main).toMatch(/if \(\(what === "model" \|\| what === "all"\) && modelShown\(\)\) modelWin\.close\(\);/);
    expect(main).toContain("const escKey = createEscKey({ shortcuts: globalShortcut, onEsc: pressEsc });");
  });
});
