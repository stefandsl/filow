import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { hotkeyHeld, HOTKEYS, okfilowSender } = require("./okfilow.js") as {
  hotkeyHeld: (h: string, d: Record<string, boolean>) => boolean;
  HOTKEYS: string[];
  okfilowSender: (event: unknown, contents: unknown[], appUrl: string) => boolean;
};

it("triggers only on exactly the hotkey's modifiers", () => {
  expect(hotkeyHeld("ctrl+alt", { ctrl: true, alt: true })).toBe(true);
  expect(hotkeyHeld("ctrl+alt", { ctrl: true })).toBe(false);
  expect(hotkeyHeld("ctrl+alt", { ctrl: true, alt: true, shift: true })).toBe(false);
  expect(hotkeyHeld("alt+shift", { alt: true, shift: true })).toBe(true);
  expect(HOTKEYS).toContain("ctrl+alt");
});

describe("OK Filow IPC sender check (same rule as the main window's)", () => {
  const appUrl = "http://127.0.0.1:4795";
  const page = (url: string) => {
    const mainFrame = { url };
    return { mainFrame, getURL: () => url, isDestroyed: () => false };
  };

  it("accepts the main frame of an OK Filow window on an OK Filow page", () => {
    const panel = page(`${appUrl}/okfilow/panel`);
    expect(okfilowSender({ sender: panel, senderFrame: panel.mainFrame }, [panel], appUrl)).toBe(true);
  });

  it("refuses a subframe inside an OK Filow page", () => {
    const panel = page(`${appUrl}/okfilow/panel`);
    const iframe = { url: `${appUrl}/okfilow/panel` };
    expect(okfilowSender({ sender: panel, senderFrame: iframe }, [panel], appUrl)).toBe(false);
    expect(okfilowSender({ sender: panel }, [panel], appUrl)).toBe(false);
  });

  it("refuses other windows, other pages of the app, other origins and closed windows", () => {
    const panel = page(`${appUrl}/okfilow/panel`);
    const stranger = page(`${appUrl}/okfilow/panel`);
    expect(okfilowSender({ sender: stranger, senderFrame: stranger.mainFrame }, [panel], appUrl)).toBe(false);
    const home = page(`${appUrl}/`);
    expect(okfilowSender({ sender: home, senderFrame: home.mainFrame }, [home], appUrl)).toBe(false);
    const evil = page("http://evil.test/okfilow/panel");
    expect(okfilowSender({ sender: evil, senderFrame: evil.mainFrame }, [evil], appUrl)).toBe(false);
    const closed = { ...page(`${appUrl}/okfilow/panel`), isDestroyed: () => true };
    expect(okfilowSender({ sender: closed, senderFrame: closed.mainFrame }, [closed], appUrl)).toBe(false);
  });

  // ourSender takes the IPC event (it needs senderFrame). A handler that passes e.sender gets false for
  // every call and its channel goes dead without an error: the dictation QA key channel did, after merge.
  it("every handler in okfilow.js hands ourSender the event, not event.sender", () => {
    const source = readFileSync(new URL("./okfilow.js", import.meta.url), "utf8");
    const calls = [...source.matchAll(/ourSender\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.filter((arg) => /\.sender$/.test(arg))).toEqual([]);
  });
});
