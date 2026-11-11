// Dictation target (docs/dictation/SPEC.md): where the words go and how, decided from facts about the
// window that has the keyboard when the words are ready. Through dictation.js's real insert() with a
// recording clipboard and a stand-in for the Windows helper.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Info = Record<string, unknown>;
type Helper = { info(): Info; sendPaste(): number; typeText(t: string): number };
type Result = { ok: boolean; action: string; reason: string; chars: number };
type Run = { pasteText(t: string): string; typed(t: string): void; copyText(t: string): string; moved(): void };
const { createDictation } = require("./dictation.js") as {
  createDictation(deps: Record<string, unknown>): {
    insert(raw: string, o: { hook?: unknown; keysUp?: () => Promise<boolean>; run?: Run }): Promise<Result>;
    newPhraseRun(): Run;
    reportText(o?: Record<string, unknown>): string;
    diag: { begin(kind: string): void; mark(name: string, facts?: Record<string, unknown>): void };
  };
};
const target = require("./dictation-target.js") as {
  describeTarget(raw: Info | null): Record<string, unknown>;
  chooseMethod(t: Record<string, unknown>): { method: string; reason: string };
  targetLine(t: Record<string, unknown>): string;
  nativeFile(o?: Record<string, unknown>): string;
  loadTarget(): Helper | null;
};

class FakeItem {
  constructor(public data: Record<string, unknown>) {}
  get types() { return Object.keys(this.data); }
  async getType(t: string) { return this.data[t]; }
}

const NOTEPAD: Info = { hwnd: 100, pid: 5, exe: "Notepad.exe", cls: "Notepad", focusCls: "RichEditD2DPT", elevated: 0, selfElevated: 0, own: false, password: false, passwordChecked: true, remote: false };

function make(first: Info | null, settings: Record<string, unknown> = {}, ownWindow: unknown = null) {
  const st = { items: [new FakeItem({ "text/plain": "theirs" })] as FakeItem[], info: first };
  const text = () => String(st.items[0]?.data["text/plain"] ?? "");
  const pasted: string[] = [];
  const typed: string[] = [];
  const writes: string[] = [];
  const log: string[] = [];
  const accept = { paste: 4, type: -1 };
  const helper: Helper = {
    info: () => st.info as Info,
    sendPaste: () => { if (accept.paste === 4) pasted.push(text()); return accept.paste; },
    typeText: (t) => { if (accept.type < 0) { typed.push(t); return 2 * t.length; } return accept.type; },
  };
  const clipboard = {
    read: async () => st.items,
    readText: async () => text(),
    write: async (items: FakeItem[]) => { writes.push(String(items[0].data["text/plain"])); st.items = items; },
    writeText: async (t: string) => { writes.push(t); st.items = [new FakeItem({ "text/plain": t })]; },
    clear: async () => { st.items = []; },
  };
  const d = createDictation({
    getSettings: () => ({ dictation: { v: 2, removeFillers: false, ...settings } }),
    saveSettings: () => {},
    logLine: (l: string) => log.push(l),
    clipboard,
    ClipboardItem: FakeItem,
    BrowserWindow: { getFocusedWindow: () => ownWindow },
    sendPaste: () => { throw new Error("the hook path must not be used when the helper is there"); },
    target: () => (st.info === undefined ? null : helper),
    platform: "win32",
    env: {},
  });
  return { d, st, text, pasted, typed, writes, log, accept };
}

describe("dictation target: where the words go", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an ordinary window: pasted, Windows took the keys, the user's clipboard comes back", async () => {
    const m = make(NOTEPAD);
    const r = m.d.insert("hello there", { hook: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect(await r).toMatchObject({ action: "paste", chars: 11 });
    expect(m.pasted).toEqual(["hello there"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.text()).toBe("theirs");
    expect(m.log.join("\n")).toContain("target Notepad.exe [Notepad > RichEditD2DPT] -> paste");
  });

  it("a password box: nothing is typed, nothing touches the clipboard, the words are not logged", async () => {
    const m = make({ ...NOTEPAD, exe: "msedge.exe", cls: "Chrome_WidgetWin_1", focusCls: "Chrome_RenderWidgetHostHWND", password: true });
    const r = await m.d.insert("my secret words", { hook: {} });
    expect(r).toMatchObject({ ok: true, action: "refused", reason: "password", chars: 0 });
    expect(m.pasted).toEqual([]);
    expect(m.typed).toEqual([]);
    expect(m.writes).toEqual([]);
    expect(m.text()).toBe("theirs");
    expect(m.log.join("\n")).not.toContain("secret");
    expect(m.d.reportText()).not.toContain("secret");
  });

  it("a password box after an earlier dictation: that dictation's text is taken off the clipboard", async () => {
    const m = make(NOTEPAD);
    const first = m.d.insert("earlier words", { hook: {} });
    await vi.advanceTimersByTimeAsync(400);
    await first;
    expect(m.text()).toBe("earlier words"); // still there: the put-back comes 1.5 s after a paste
    m.st.info = { ...NOTEPAD, password: true };
    const r = m.d.insert("secret", { hook: {} });
    await vi.advanceTimersByTimeAsync(400);
    expect((await r).action).toBe("refused");
    expect(m.writes).toEqual(["earlier words"]); // the refused words never reached the clipboard
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.text()).toBe("theirs"); // and the earlier dictation's put-back still happens
  });

  it("the keyboard moves to a password box while the user's keys go up: refused there too, clipboard given back", async () => {
    const m = make(NOTEPAD);
    const first = m.d.insert("earlier words", { hook: {} });
    await vi.advanceTimersByTimeAsync(400);
    await first;
    let up = false;
    const r = m.d.insert("secret", { hook: {}, keysUp: async () => { while (!up) await new Promise((res) => setTimeout(res, 25)); return true; } });
    await vi.advanceTimersByTimeAsync(200);
    m.st.info = { ...NOTEPAD, password: true };
    up = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect((await r).action).toBe("refused");
    expect(m.writes).not.toContain("secret");
    expect(m.text()).toBe("theirs");
    expect(m.pasted).toEqual(["earlier words"]);
  });

  it("a password box is refused on every path: only-copy setting, no keyboard hook, Filow's own windows", async () => {
    const pw = { ...NOTEPAD, password: true };
    const copyOnly = make(pw, { insert: "copy" });
    expect((await copyOnly.d.insert("secret", { hook: {} })).action).toBe("refused");
    expect(copyOnly.writes).toEqual([]);
    const noHook = make(pw);
    expect((await noHook.d.insert("secret", {})).action).toBe("refused");
    expect(noHook.writes).toEqual([]);
    // One of Filow's own windows with a password input in focus (an API key box): the page says so.
    const own = make(NOTEPAD, {}, { isDestroyed: () => false, isVisible: () => true, webContents: { executeJavaScript: async () => ({ password: true }), insertText: async () => { throw new Error("must not type"); } } });
    expect((await own.d.insert("secret", { hook: {} })).action).toBe("refused");
    expect(own.writes).toEqual([]);
    expect(own.log.join("\n")).not.toContain("secret");
  });

  it("Windows cannot say whether it is a password box: asked once more, then the log says the check was not possible", async () => {
    const m = make({ ...NOTEPAD, passwordChecked: false });
    let calls = 0;
    const base = m.st.info as Info;
    Object.defineProperty(m.st, "info", { get: () => { calls++; return calls === 2 ? { ...base, password: true, passwordChecked: true } : base; } });
    const r = m.d.insert("secret", { hook: {} });
    await vi.advanceTimersByTimeAsync(300);
    expect((await r).action).toBe("refused"); // the second look found the password box
    const u = make({ ...NOTEPAD, passwordChecked: false });
    const r2 = u.d.insert("plain words", { hook: {} });
    await vi.advanceTimersByTimeAsync(600);
    expect((await r2).action).toBe("paste");
    expect(u.log.join("\n")).toContain("could not say whether the focused control of Notepad.exe [Notepad > RichEditD2DPT] is a password box");
  });

  it("an administrator window: only copied, and the reason is said", async () => {
    const m = make({ ...NOTEPAD, exe: "regedit.exe", cls: "RegEdit_RegEdit", elevated: 1 });
    const r = await m.d.insert("typed for the admin window", { hook: {} });
    expect(r).toMatchObject({ action: "copy", reason: "elevated" });
    expect(m.pasted).toEqual([]);
    expect(m.text()).toBe("typed for the admin window");
  });

  it("Filow itself running as administrator can type into an administrator window", async () => {
    const m = make({ ...NOTEPAD, elevated: 1, selfElevated: 1 });
    const r = m.d.insert("fine", { hook: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect((await r).action).toBe("paste");
  });

  it("no window has the keyboard (a remote desktop left minimized): copied, with that reason", async () => {
    const m = make({ hwnd: 0, pid: 0, exe: "", cls: "", focusCls: "", elevated: -1, selfElevated: 0, own: false, password: false, passwordChecked: false, remote: true });
    const r = await m.d.insert("words", { hook: {} });
    expect(r).toMatchObject({ action: "copy", reason: "nofocus" });
    expect(m.log.join("\n")).toContain("no window has the keyboard (remote desktop session)");
  });

  it("a terminal: typed as characters, the clipboard is never touched", async () => {
    const m = make({ ...NOTEPAD, exe: "WindowsTerminal.exe", cls: "CASCADIA_HOSTING_WINDOW_CLASS", focusCls: "" });
    const r = await m.d.insert("git status così", { hook: {} });
    expect(r).toMatchObject({ action: "typed", chars: 15 });
    expect(m.typed).toEqual(["git status così"]);
    expect(m.writes).toEqual([]);
    expect(m.text()).toBe("theirs");
  });

  it("a terminal, phrase after phrase: the space between phrases is typed too", async () => {
    const m = make({ ...NOTEPAD, exe: "conhost.exe", cls: "ConsoleWindowClass" });
    const run = m.d.newPhraseRun();
    await m.d.insert("echo one", { hook: {}, run });
    await m.d.insert("two", { hook: {}, run });
    expect(m.typed).toEqual(["echo one", " two"]);
  });

  it("Windows takes none of the keys (typing or paste): copied and said, never reported as typed", async () => {
    const t = make({ ...NOTEPAD, exe: "conhost.exe", cls: "ConsoleWindowClass" });
    t.accept.type = 0;
    expect(await t.d.insert("words", { hook: {} })).toMatchObject({ action: "copy", reason: "blocked" });
    expect(t.text()).toBe("words");
    const p = make(NOTEPAD);
    p.accept.paste = 0;
    const r = p.d.insert("words", { hook: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect(await r).toMatchObject({ action: "copy", reason: "blocked" });
    expect(p.log.join("\n")).toContain("Windows accepted 0 of 4 key events");
  });

  it("the target is the window that has the keyboard when the keys are up, not when they went down", async () => {
    // "Press the keys, then click a text box in another window": the click lands while the keys are held.
    const m = make(NOTEPAD); // while the keys are held Notepad has the keyboard...
    let up = false;
    const r = m.d.insert("goes to the box I pointed at", { hook: {}, keysUp: async () => { while (!up) await new Promise((res) => setTimeout(res, 25)); return true; } });
    await vi.advanceTimersByTimeAsync(200);
    m.st.info = { ...NOTEPAD, exe: "WINWORD.EXE", cls: "OpusApp", focusCls: "_WwG" }; // ...then the user clicked into Word
    up = true;
    await vi.advanceTimersByTimeAsync(200);
    expect((await r).action).toBe("paste");
    expect(m.pasted).toEqual(["goes to the box I pointed at"]);
    expect(m.log.join("\n")).toContain("target WINWORD.EXE [OpusApp > _WwG] -> paste");
  });

  it("without the helper (macOS, Linux) the paste goes through the keyboard hook as before", async () => {
    const pasted: string[] = [];
    const st = { items: [new FakeItem({ "text/plain": "theirs" })] as FakeItem[] };
    const d = createDictation({
      getSettings: () => ({ dictation: {} }), saveSettings: () => {}, logLine: () => {},
      clipboard: { read: async () => st.items, readText: async () => String(st.items[0]?.data["text/plain"] ?? ""), write: async (i: FakeItem[]) => { st.items = i; }, writeText: async () => {}, clear: async () => {} },
      ClipboardItem: FakeItem, BrowserWindow: { getFocusedWindow: () => null },
      sendPaste: () => { pasted.push(String(st.items[0]?.data["text/plain"])); },
      target: () => null, platform: "linux", env: {},
    });
    const r = d.insert("words", { hook: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect((await r).action).toBe("paste");
    expect(pasted).toEqual(["words"]);
  });

  it("the keyboard goes to one of Filow's own windows while the keys go up: its page decides, never a blind paste", async () => {
    const m = make(NOTEPAD);
    let up = false;
    const state = { win: null as unknown };
    // the same dictation object, but Electron now reports a focused Filow window with a password input
    const d2 = createDictation({
      getSettings: () => ({ dictation: { v: 2, removeFillers: false } }), saveSettings: () => {}, logLine: (l: string) => m.log.push(l),
      clipboard: { read: async () => m.st.items, readText: async () => m.text(), write: async (i: FakeItem[]) => { m.writes.push(String(i[0].data["text/plain"])); m.st.items = i; }, writeText: async (t: string) => { m.writes.push(t); }, clear: async () => {} },
      ClipboardItem: FakeItem, BrowserWindow: { getFocusedWindow: () => state.win },
      sendPaste: () => { throw new Error("no hook path"); },
      target: () => ({ info: () => m.st.info as Info, sendPaste: () => { m.pasted.push(m.text()); return 4; }, typeText: () => 0 }),
      platform: "win32", env: {},
    });
    const r = d2.insert("secret", { hook: {}, keysUp: async () => { while (!up) await new Promise((res) => setTimeout(res, 25)); return true; } });
    await vi.advanceTimersByTimeAsync(200);
    m.st.info = { ...NOTEPAD, exe: "Filow.exe", cls: "Chrome_WidgetWin_1", own: true, passwordChecked: false };
    state.win = { isDestroyed: () => false, isVisible: () => true, webContents: { executeJavaScript: async () => ({ password: true }), insertText: async () => { throw new Error("must not type"); } } };
    up = true;
    await vi.advanceTimersByTimeAsync(500);
    expect((await r).action).toBe("refused");
    expect(m.pasted).toEqual([]);
    expect(m.writes).not.toContain("secret");
  });

  it("something the user copies while the keys are still down is what comes back after the paste", async () => {
    const m = make(NOTEPAD);
    let up = false;
    const r = m.d.insert("dictated", { hook: {}, keysUp: async () => { while (!up) await new Promise((res) => setTimeout(res, 25)); return true; } });
    await vi.advanceTimersByTimeAsync(200);
    m.st.items = [new FakeItem({ "text/plain": "copied during the wait" })];
    up = true;
    await vi.advanceTimersByTimeAsync(200);
    expect((await r).action).toBe("paste");
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.text()).toBe("copied during the wait");
  });

  // Seen in Notepad on 2026-11-11: two dictations in a row came out as "...alle 9.La riunione...".
  it("two dictations in a row into the same window are joined by a space; not after a key or a click, not in another window", async () => {
    const m = make(NOTEPAD);
    const d = m.d as typeof m.d & { userMoved(): void };
    const say = async (text: string) => { const r = d.insert(text, { hook: {} }); await vi.advanceTimersByTimeAsync(2500); return r; };
    await say("La riunione comincia domani mattina alle 9.");
    await say("Porta la relazione.");
    expect(m.pasted).toEqual(["La riunione comincia domani mattina alle 9.", " Porta la relazione."]);
    d.userMoved(); // the user pressed Enter or clicked: the caret is somewhere else
    await say("Nuova riga.");
    expect(m.pasted[2]).toBe("Nuova riga.");
    m.st.info = { ...NOTEPAD, hwnd: 200, exe: "WINWORD.EXE", cls: "OpusApp" };
    await say("In un'altra finestra.");
    expect(m.pasted[3]).toBe("In un'altra finestra.");
    // Japanese is written without spaces.
    await say("会議は明日です。");
    await say("よろしく。");
    expect(m.pasted[5]).toBe("よろしく。");
  });

  it("Filow's own paste keys coming back through the keyboard hook do not count as the user typing", async () => {
    const m = make(NOTEPAD);
    const d = m.d as typeof m.d & { userMoved(): void };
    const r = d.insert("first.", { hook: {} });
    await vi.advanceTimersByTimeAsync(100);
    await r;
    d.userMoved(); // the hook reports our own Ctrl + V a moment after it was sent
    await vi.advanceTimersByTimeAsync(2500);
    const r2 = d.insert("second.", { hook: {} });
    await vi.advanceTimersByTimeAsync(500);
    await r2;
    expect(m.pasted).toEqual(["first.", " second."]);
  });
});

describe("dictation target: the facts", () => {  it("keeps names only: a title or a path never gets through", () => {
    const t = target.describeTarget({ ...NOTEPAD, exe: "C:\\Users\\someone\\app.exe", cls: "Cls<script>", title: "Private letter.docx" });
    expect(JSON.stringify(t)).not.toContain("Private");
    expect(t.exe).toBe("CUserssomeoneapp.exe"); // separators are dropped: the helper sends a file name, and a path cannot be rebuilt
    expect(t.cls).toBe("Clsscript");
  });

  it("an unknown elevation is not treated as administrator; unreadable facts paste as before", () => {
    expect(target.chooseMethod(target.describeTarget({ ...NOTEPAD, elevated: -1 })).method).toBe("paste");
    expect(target.chooseMethod(target.describeTarget(null))).toEqual({ method: "paste", reason: "" });
    expect(target.targetLine(target.describeTarget(null))).toContain("unknown");
  });

  it("there is a helper for Windows x64 only, and inside a package it is read from outside app.asar", () => {
    const exists = () => true;
    expect(target.nativeFile({ platform: "darwin", exists })).toBe("");
    expect(target.nativeFile({ platform: "win32", arch: "x64", baseDir: path.join("X:", "resources", "app.asar"), exists })).toContain("app.asar.unpacked");
    expect(target.nativeFile({ platform: "win32", arch: "arm64", exists: () => false })).toBe("");
  });

  it("the Windows binary in the repository was built from the source next to it", () => {
    const dir = path.join(__dirname, "native", "target");
    const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "src", "target.cc"), "utf8").replace(/\r\n/g, "\n")).digest("hex");
    expect(fs.readFileSync(path.join(dir, "prebuilds", "win32-x64", "BUILT-FROM.txt"), "utf8")).toContain(sha);
    // ...and the binary is the one that build wrote (a stale or swapped file fails here).
    const bin = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "prebuilds", "win32-x64", "filow-target.node"))).digest("hex");
    expect(fs.readFileSync(path.join(dir, "prebuilds", "win32-x64", "BUILT-FROM.txt"), "utf8")).toContain(`filow-target.node sha256 ${bin}`);
  });

  it.runIf(process.platform === "win32" && process.arch === "x64")("the helper loads on Windows and answers with facts, no title and no text", () => {
    const h = target.loadTarget();
    expect(h).not.toBeNull();
    const info = h!.info(); // read-only: no key is ever sent by this test
    expect(Object.keys(info).sort()).toEqual(["cls", "elevated", "exe", "focusCls", "hwnd", "own", "password", "passwordChecked", "pid", "remote", "selfElevated"]);
    expect(typeof info.remote).toBe("boolean");
  });
});
