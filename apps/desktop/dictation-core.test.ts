import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Snap = { text: string; html: string; rtf: string; image: unknown; restorable: boolean; empty: boolean };
type Inserter = { insert(text: string): Promise<{ pasted: boolean; reason: string; restored: Promise<boolean> }>; pending: boolean };
const core = require("./dictation-core.js") as {
  CHORDS: string[];
  parseChord(s: unknown): string | null;
  chordLabel(c: string, p?: string): string;
  checkChord(c: string, o: { talk?: string; platform?: string }): { ok: boolean; conflict: string | null; warnings: string[] };
  sanitizeConfig(raw: unknown, legacy?: boolean): Record<string, unknown>;
  pasteDecision(o: Record<string, unknown>): { action: string; reason: string };
  snapshotClipboard(cb: unknown): Snap;
  createClipboardInserter(o: Record<string, unknown>): Inserter;
  postProcess(t: string, o?: { language?: string; removeFillers?: boolean }): string;
  setFillerHook(fn: ((lang: string) => RegExp[]) | null): void;
};

describe("dictation shortcut", () => {
  it("parses the names people write on each platform into one canonical chord", () => {
    expect(core.parseChord("Ctrl + Win")).toBe("ctrl+meta");
    expect(core.parseChord("win+ctrl")).toBe("ctrl+meta");
    expect(core.parseChord("Cmd+Option")).toBe("alt+meta");
    expect(core.parseChord("control+shift+super")).toBe("ctrl+shift+meta");
    expect(core.parseChord("Ctrl+Alt")).toBe("ctrl+alt");
  });

  it("refuses one key, four keys, repeats, letters and junk", () => {
    for (const bad of ["ctrl", "ctrl+alt+shift+meta", "ctrl+ctrl", "ctrl+cmd+win", "ctrl+v", "", "+", 42, null]) expect(core.parseChord(bad)).toBeNull();
  });

  it("offers the ten two- and three-key chords", () => {
    expect(core.CHORDS).toHaveLength(10);
    expect(new Set(core.CHORDS).size).toBe(10);
    for (const c of core.CHORDS) expect(core.parseChord(c)).toBe(c);
  });

  it("labels keys with each platform's own names", () => {
    expect(core.chordLabel("ctrl+meta", "win32")).toBe("Ctrl + Win");
    expect(core.chordLabel("ctrl+meta", "darwin")).toBe("Control + Command");
    expect(core.chordLabel("alt+meta", "linux")).toBe("Alt + Super");
  });

  it("finds the conflicts with OK Filow's talk keys: the same keys, or one chord inside the other", () => {
    expect(core.checkChord("ctrl+meta", { talk: "ctrl+alt" })).toEqual({ ok: true, conflict: null, warnings: [] });
    expect(core.checkChord("ctrl+meta", { talk: "ctrl+meta" }).conflict).toBe("same");
    expect(core.checkChord("ctrl+alt+shift", { talk: "ctrl+alt" }).conflict).toBe("overlap");
    expect(core.checkChord("ctrl+alt", { talk: "ctrl+alt+meta" }).conflict).toBe("overlap");
    expect(core.checkChord("ctrl+shift", { talk: "ctrl+alt" }).ok).toBe(true);
    expect(core.checkChord("nonsense", { talk: "ctrl+alt" }).conflict).toBe("invalid");
  });

  it("warns about AltGr and the keyboard-language switch on Windows only", () => {
    expect(core.checkChord("ctrl+alt+meta", { talk: "alt+shift", platform: "win32" }).warnings).toEqual(["altgr"]);
    expect(core.checkChord("alt+shift", { talk: "ctrl+meta", platform: "win32" }).warnings).toEqual(["layout"]);
    expect(core.checkChord("alt+shift", { talk: "ctrl+meta", platform: "darwin" }).warnings).toEqual([]);
  });
});

describe("dictation settings", () => {
  it("fills defaults, keeps the old OK Filow switch, and refuses unknown values", () => {
    expect(core.sanitizeConfig(undefined)).toEqual({ enabled: true, chord: "ctrl+meta", mode: "hold", language: "auto", insert: "paste", removeFillers: false, sound: false });
    expect(core.sanitizeConfig(undefined, false).enabled).toBe(false);
    expect(core.sanitizeConfig({ enabled: true }, false).enabled).toBe(true);
    const c = core.sanitizeConfig({ chord: "Win + Alt", mode: "toggle", language: "ja", insert: "copy", removeFillers: true, sound: true });
    expect(c).toMatchObject({ chord: "alt+meta", mode: "toggle", language: "ja", insert: "copy", removeFillers: true, sound: true });
    expect(core.sanitizeConfig({ chord: "ctrl", mode: "x", language: "de", insert: "type", removeFillers: "yes" })).toMatchObject({ chord: "ctrl+meta", mode: "hold", language: "auto", insert: "paste", removeFillers: false });
  });
});

describe("paste or copy", () => {
  it("pastes on Windows, X11 and macOS with the permission", () => {
    expect(core.pasteDecision({ platform: "win32" })).toEqual({ action: "paste", reason: "" });
    expect(core.pasteDecision({ platform: "linux", env: { XDG_SESSION_TYPE: "x11" } }).action).toBe("paste");
    expect(core.pasteDecision({ platform: "darwin", macTrusted: true }).action).toBe("paste");
  });
  it("only copies, and says why, when it cannot press keys in another app", () => {
    expect(core.pasteDecision({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland" } })).toEqual({ action: "copy", reason: "wayland" });
    expect(core.pasteDecision({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }).reason).toBe("wayland");
    expect(core.pasteDecision({ platform: "darwin", macTrusted: false })).toEqual({ action: "copy", reason: "accessibility" });
    expect(core.pasteDecision({ platform: "win32", hook: false })).toEqual({ action: "copy", reason: "nohook" });
    expect(core.pasteDecision({ platform: "win32", insert: "copy" })).toEqual({ action: "copy", reason: "setting" });
  });
});

/** A clipboard that records every call, like Electron's. */
function fakeClipboard(initial: { text?: string; html?: string; files?: boolean }) {
  const log: string[] = [];
  const st = { text: initial.text ?? "", html: initial.html ?? "", files: initial.files ?? false };
  const cb = {
    readText: () => { log.push("readText"); return st.text; },
    readHTML: () => st.html,
    readRTF: () => "",
    readImage: () => ({ isEmpty: () => true }),
    read: (fmt: string) => (st.files && fmt === "FileNameW" ? "C:\\a.txt" : ""),
    writeText: (t: string) => { log.push(`writeText:${t}`); st.text = t; st.html = ""; st.files = false; },
    write: (d: { text: string; html?: string }) => { log.push(`write:${d.text}${d.html ? "+html" : ""}`); st.text = d.text; st.html = d.html ?? ""; },
    clear: () => { log.push("clear"); st.text = ""; st.html = ""; },
  };
  return { cb, log, st };
}

describe("clipboard save, paste, restore", () => {
  it("saves first, writes the text, pastes, then puts the user's clipboard back (text and html)", async () => {
    vi.useFakeTimers();
    const { cb, log, st } = fakeClipboard({ text: "theirs", html: "<b>theirs</b>" });
    const ins = core.createClipboardInserter({ clipboard: cb, sendPaste: () => log.push("paste"), restoreMs: 1500 });
    const r = await ins.insert("hello world");
    expect(r.pasted).toBe(true);
    expect(log.filter((x) => x !== "readText")).toEqual(["writeText:hello world", "paste"]);
    expect(st.text).toBe("hello world");
    await vi.advanceTimersByTimeAsync(1500);
    expect(await r.restored).toBe(true);
    expect(log.at(-1)).toBe("write:theirs+html");
    expect(st).toMatchObject({ text: "theirs", html: "<b>theirs</b>" });
    vi.useRealTimers();
  });

  it("waits for the keys to be up before writing; if they never are, nothing is written", async () => {
    const { cb, log } = fakeClipboard({ text: "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, sendPaste: () => log.push("paste"), keysUp: async () => false });
    const r = await ins.insert("x");
    expect(r).toMatchObject({ pasted: false, reason: "keys" });
    expect(log.some((l) => l.startsWith("writeText") || l === "paste")).toBe(false);
  });

  it("keeps what the user copied meanwhile, and keeps copied files rather than lose them", async () => {
    vi.useFakeTimers();
    const a = fakeClipboard({ text: "theirs" });
    const ins = core.createClipboardInserter({ clipboard: a.cb, sendPaste: () => {}, restoreMs: 1000 });
    const r = await ins.insert("dictated");
    a.st.text = "copied later";
    await vi.advanceTimersByTimeAsync(1000);
    expect(await r.restored).toBe(false);
    expect(a.st.text).toBe("copied later");

    const b = fakeClipboard({ text: "", files: true });
    const ins2 = core.createClipboardInserter({ clipboard: b.cb, sendPaste: () => {}, restoreMs: 1000 });
    const r2 = await ins2.insert("dictated");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await r2.restored).toBe(false);
    expect(b.st.text).toBe("dictated");
    vi.useRealTimers();
  });

  it("an empty clipboard is emptied again afterwards", async () => {
    vi.useFakeTimers();
    const { cb, log } = fakeClipboard({ text: "" });
    const ins = core.createClipboardInserter({ clipboard: cb, sendPaste: () => {}, restoreMs: 10 });
    await ins.insert("x");
    await vi.advanceTimersByTimeAsync(10);
    expect(log.at(-1)).toBe("clear");
    vi.useRealTimers();
  });

  it("two dictations in a row: the user's clipboard comes back, not the first dictation", async () => {
    vi.useFakeTimers();
    const { cb, st } = fakeClipboard({ text: "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, sendPaste: () => {}, restoreMs: 1500 });
    const first = await ins.insert("one");
    await vi.advanceTimersByTimeAsync(500);
    const second = await ins.insert("two");
    expect(await first.restored).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await second.restored).toBe(true);
    expect(st.text).toBe("theirs");
    vi.useRealTimers();
  });

  it("when the paste key cannot be sent, the clipboard is put back at once", async () => {
    const { cb, st } = fakeClipboard({ text: "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, sendPaste: () => { throw new Error("no hook"); } });
    const r = await ins.insert("x");
    expect(r.pasted).toBe(false);
    expect(st.text).toBe("theirs");
    expect(ins.pending).toBe(false);
  });
});

describe("text clean-up", () => {
  it("tidies spaces and leaves words alone by default", () => {
    expect(core.postProcess("  um  hello\n world ")).toBe("um hello world");
    expect(core.postProcess("   ")).toBe("");
  });

  it("takes out hesitation sounds and moves the capital to the next word", () => {
    const en = { language: "en", removeFillers: true };
    expect(core.postProcess("Um, so I think, uh, we should go.", en)).toBe("So I think, we should go.");
    expect(core.postProcess("I think so, um.", en)).toBe("I think so.");
    expect(core.postProcess("Hmm. Ok then", en)).toBe("Ok then");
    expect(core.postProcess("umbrella and hummus stay", en)).toBe("umbrella and hummus stay");
  });

  it("keeps words people use as fillers but often mean", () => {
    expect(core.postProcess("Basically, you know, it works", { language: "en", removeFillers: true })).toBe("Basically, you know, it works");
    expect(core.postProcess("Diciamo che ehm funziona", { language: "it", removeFillers: true })).toBe("Diciamo che funziona");
  });

  it("works in each of the five languages", () => {
    expect(core.postProcess("Ehm, allora andiamo", { language: "it", removeFillers: true })).toBe("Allora andiamo");
    expect(core.postProcess("Ээ, привет, ммм, друзья", { language: "ru", removeFillers: true })).toBe("Привет, друзья");
    expect(core.postProcess("Ăăă, bună ziua", { language: "ro", removeFillers: true })).toBe("Bună ziua");
    expect(core.postProcess("えーと、今日は晴れです", { language: "ja", removeFillers: true })).toBe("今日は晴れです");
    expect(core.postProcess("あの人です", { language: "ja", removeFillers: true })).toBe("あの人です");
  });

  it("with the language unknown, only the sounds no language uses as a word go", () => {
    expect(core.postProcess("Uhm, ciao er", { language: "auto", removeFillers: true })).toBe("Ciao er");
  });

  it("a supplied filler list replaces the built-in one", () => {
    core.setFillerHook(() => [/^ciao$/]);
    expect(core.postProcess("ciao um", { language: "it", removeFillers: true })).toBe("um");
    core.setFillerHook(null);
  });
});
