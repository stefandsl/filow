import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Snap = { items: unknown[]; restorable: boolean; empty: boolean };
type Inserter = { insert(text: string): Promise<{ pasted: boolean; reason: string; restored: Promise<boolean> }>; pending: boolean };
const core = require("./dictation-core.js") as {
  CHORDS: string[];
  parseChord(s: unknown): string | null;
  chordLabel(c: string, p?: string): string;
  checkChord(c: string, o: { talk?: string; platform?: string }): { ok: boolean; conflict: string | null; warnings: string[] };
  sanitizeConfig(raw: unknown, legacy?: boolean): Record<string, unknown>;
  pasteDecision(o: Record<string, unknown>): { action: string; reason: string };
  snapshotClipboard(cb: unknown): Promise<Snap>;
  createClipboardInserter(o: Record<string, unknown>): Inserter;
  postProcess(t: string, o?: { language?: string; removeFillers?: boolean }): string;
  setFillerHook(fn: ((lang: string) => RegExp[]) | null): void;
  joinAfter(before: string, text: string): string;
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

/** Electron 45's W3C-style clipboard (read/write items, all async), recording every call. */
class FakeItem {
  constructor(public data: Record<string, unknown>) {}
  get types() { return Object.keys(this.data); }
  async getType(t: string) { return this.data[t]; }
}
function fakeClipboard(initial: Record<string, unknown> | null, opts: { unreadable?: boolean } = {}) {
  const log: string[] = [];
  const st = { items: initial ? [new FakeItem(initial)] : ([] as FakeItem[]) };
  const text = () => String(st.items[0]?.data["text/plain"] ?? "");
  const cb = {
    read: async () => { if (opts.unreadable) throw new Error("locked"); return st.items; },
    readText: async () => text(),
    write: async (items: FakeItem[]) => { log.push(`write:${items.map((i) => i.types.join("+")).join(",")}:${String(items[0]?.data["text/plain"] ?? "")}`); st.items = items; },
    writeText: async (t: string) => { log.push(`writeText:${t}`); st.items = [new FakeItem({ "text/plain": t })]; },
    clear: async () => { log.push("clear"); st.items = []; },
  };
  return { cb, log, st, text };
}
const HIST = 'electron application/osclipboard;format="CanIncludeInClipboardHistory"';

describe("clipboard save, paste, restore", () => {
  it("saves first, writes the text (kept out of Windows clipboard history), pastes, then puts every format back", async () => {
    vi.useFakeTimers();
    const { cb, log, text, st } = fakeClipboard({ "text/plain": "theirs", "text/html": "<b>theirs</b>" });
    const ins = core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, platform: "win32", sendPaste: () => log.push("paste"), restoreMs: 1500 });
    const r = await ins.insert("hello world");
    expect(r.pasted).toBe(true);
    expect(log[0]).toMatch(/^write:text\/plain\+.*CanIncludeInClipboardHistory.*CanUploadToCloudClipboard.*:hello world$/);
    expect(log[1]).toBe("paste");
    expect(await text()).toBe("hello world");
    await vi.advanceTimersByTimeAsync(1500);
    expect(await r.restored).toBe(true);
    expect(log.at(-1)).toBe("write:text/plain+text/html:theirs");
    expect(st.items[0].data["text/html"]).toBe("<b>theirs</b>");
    vi.useRealTimers();
  });

  it("adds the history markers on Windows only", async () => {
    const { cb, st } = fakeClipboard(null);
    await core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, platform: "darwin", sendPaste: () => {} }).insert("x");
    expect(st.items[0].types).toEqual(["text/plain"]);
    const w = fakeClipboard(null);
    await core.createClipboardInserter({ clipboard: w.cb, ClipboardItem: FakeItem, platform: "win32", sendPaste: () => {} }).insert("x");
    expect(w.st.items[0].types).toContain(HIST);
  });

  it("waits for the keys to be up before writing; if they never are, nothing is written", async () => {
    const { cb, log } = fakeClipboard({ "text/plain": "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, sendPaste: () => log.push("paste"), keysUp: async () => false });
    const r = await ins.insert("x");
    expect(r).toMatchObject({ pasted: false, reason: "keys" });
    expect(log).toEqual([]);
  });

  it("keeps what the user copied meanwhile, and never overwrites a clipboard it could not read", async () => {
    vi.useFakeTimers();
    const a = fakeClipboard({ "text/plain": "theirs" });
    const ins = core.createClipboardInserter({ clipboard: a.cb, ClipboardItem: FakeItem, sendPaste: () => {}, restoreMs: 1000 });
    const r = await ins.insert("dictated");
    await a.cb.writeText("copied later");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await r.restored).toBe(false);
    expect(await a.text()).toBe("copied later");

    const b = fakeClipboard({ "text/plain": "theirs" }, { unreadable: true });
    const ins2 = core.createClipboardInserter({ clipboard: b.cb, ClipboardItem: FakeItem, sendPaste: () => {}, restoreMs: 1000 });
    const r2 = await ins2.insert("dictated");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await r2.restored).toBe(false);
    expect(await b.text()).toBe("dictated");
    vi.useRealTimers();
  });

  it("an empty clipboard is emptied again afterwards", async () => {
    vi.useFakeTimers();
    const { cb, log } = fakeClipboard(null);
    const ins = core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, sendPaste: () => {}, restoreMs: 10 });
    await ins.insert("x");
    await vi.advanceTimersByTimeAsync(10);
    expect(log.at(-1)).toBe("clear");
    vi.useRealTimers();
  });

  it("two dictations in a row: the user's clipboard comes back, not the first dictation", async () => {
    vi.useFakeTimers();
    const { cb, text } = fakeClipboard({ "text/plain": "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, sendPaste: () => {}, restoreMs: 1500 });
    const first = await ins.insert("one");
    await vi.advanceTimersByTimeAsync(500);
    const second = await ins.insert("two");
    expect(await first.restored).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await second.restored).toBe(true);
    expect(await text()).toBe("theirs");
    vi.useRealTimers();
  });

  it("when the paste key cannot be sent, the words stay on the clipboard to paste by hand", async () => {
    vi.useFakeTimers();
    const { cb, text } = fakeClipboard({ "text/plain": "theirs" });
    const ins = core.createClipboardInserter({ clipboard: cb, ClipboardItem: FakeItem, sendPaste: () => { throw new Error("no hook"); } });
    const r = await ins.insert("x");
    expect(r.pasted).toBe(false);
    expect(ins.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await text()).toBe("x");
    vi.useRealTimers();
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
    expect(core.postProcess("ええと、今日は晴れです", { language: "ja", removeFillers: true })).toBe("今日は晴れです");
    expect(core.postProcess("ええ、そうです", { language: "ja", removeFillers: true })).toBe("ええ、そうです"); // "ええ" is yes
    // Review of this pass: units, letters and numbers are meant words.
    expect(core.postProcess("Толщина листа 5 мм, ширина 20 мм. Буква э, буква м.", { language: "ru", removeFillers: true })).toBe("Толщина листа 5 мм, ширина 20 мм. Буква э, буква м.");
    expect(core.postProcess("Clasa a III-a, grosime 5 mm.", { language: "ro", removeFillers: true })).toBe("Clasa a III-a, grosime 5 mm.");
    // Russian and Romanian: sounds only, never a word that can be meant.
    expect(core.postProcess("эээ вот это значит типа проект", { language: "ru", removeFillers: true })).toBe("вот это значит типа проект");
    expect(core.postProcess("ăăă păi adică proiectul", { language: "ro", removeFillers: true })).toBe("păi adică proiectul");
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

describe("joining a dictation to the text before the caret", () => {
  it("adds a space after a word or a full stop, and nowhere else", () => {
    expect(core.joinAfter("Friday.", "Please")).toBe(" Please");
    expect(core.joinAfter("word", "next")).toBe(" next");
    expect(core.joinAfter("", "Start")).toBe("Start");
    expect(core.joinAfter(" ", "after space")).toBe("after space");
    expect(core.joinAfter("(", "inside")).toBe("inside");
    expect(core.joinAfter("word", ", then")).toBe(", then");
    expect(core.joinAfter("です。", "今日は")).toBe("今日は");
  });
});
