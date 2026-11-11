// Hands-free dictation (issue #2): phrase after phrase into the app with focus, through dictation.js's real
// insert() and the real clipboard inserter, with a recording clipboard.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Run = { pasteText(t: string): string; typed(t: string): void; copyText(t: string): string };
type Result = { ok: boolean; action: string; reason: string; chars: number };
const { createDictation } = require("./dictation.js") as {
  createDictation(deps: Record<string, unknown>): {
    insert(raw: string, o: { hook?: unknown; keysUp?: () => Promise<boolean>; spokenLanguage?: string; run?: Run }): Promise<Result>;
    newPhraseRun(): Run;
  };
};
const core = require("./dictation-core.js") as { createPhraseRun(): Run };

class FakeItem {
  constructor(public data: Record<string, unknown>) {}
  get types() { return Object.keys(this.data); }
  async getType(t: string) { return this.data[t]; }
}
const HIST = 'electron application/osclipboard;format="CanIncludeInClipboardHistory"';
const CLOUD = 'electron application/osclipboard;format="CanUploadToCloudClipboard"';

function make(settings: Record<string, unknown> = {}) {
  const st = { items: [new FakeItem({ "text/plain": "theirs", "text/html": "<b>theirs</b>" })] as FakeItem[] };
  const text = () => String(st.items[0]?.data["text/plain"] ?? "");
  /** What each write put on the clipboard, and what the app with focus received at each paste. */
  const writes: FakeItem[] = [];
  const pasted: string[] = [];
  const clipboard = {
    read: async () => st.items,
    readText: async () => text(),
    write: async (items: FakeItem[]) => { writes.push(items[0]); st.items = items; },
    writeText: async (t: string) => { st.items = [new FakeItem({ "text/plain": t })]; },
    clear: async () => { st.items = []; },
  };
  const d = createDictation({
    getSettings: () => ({ dictation: settings }),
    saveSettings: () => {},
    logLine: () => {},
    clipboard,
    ClipboardItem: FakeItem,
    BrowserWindow: { getFocusedWindow: () => null },
    sendPaste: () => { pasted.push(text()); },
    platform: "win32",
    env: {},
  });
  return { d, text, writes, pasted, st };
}

describe("hands-free dictation: phrase after phrase", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("each phrase is typed after the one before, with the space the language writes between them", async () => {
    const { d, pasted } = make();
    const run = d.newPhraseRun();
    for (const phrase of ["Hello there.", "How are you?", "Fine, thanks."]) {
      expect(await d.insert(phrase, { hook: {}, run })).toMatchObject({ ok: true, action: "paste" });
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pasted).toEqual(["Hello there.", " How are you?", " Fine, thanks."]);
    expect(pasted.join("")).toBe("Hello there. How are you? Fine, thanks.");
  });

  it("Japanese phrases follow each other without a space", async () => {
    const { d, pasted } = make({ v: 2, language: "ja" });
    const run = d.newPhraseRun();
    await d.insert("こんにちは。", { hook: {}, run });
    await d.insert("元気ですか", { hook: {}, run });
    expect(pasted.join("")).toBe("こんにちは。元気ですか");
  });

  it("a phrase that is only a filler sound types nothing and does not add a space later", async () => {
    const { d, pasted } = make();
    const run = d.newPhraseRun();
    await d.insert("One", { hook: {}, run });
    expect(await d.insert("um", { hook: {}, run, spokenLanguage: "en" })).toMatchObject({ action: "none" });
    await d.insert("two", { hook: {}, run });
    expect(pasted).toEqual(["One", " two"]);
  });

  it("clipboard safety for every phrase: kept out of history and cloud sync, and the user's clipboard comes back", async () => {
    const { d, writes, text, st } = make();
    const run = d.newPhraseRun();
    // Phrase two comes before the first one's restore, phrase three long after the second one's.
    await d.insert("one", { hook: {}, run });
    await vi.advanceTimersByTimeAsync(700);
    await d.insert("two", { hook: {}, run });
    await vi.advanceTimersByTimeAsync(1500);
    expect(text()).toBe("theirs");
    await d.insert("three", { hook: {}, run });
    expect(text()).toBe(" three");
    await vi.advanceTimersByTimeAsync(1500);
    expect(text()).toBe("theirs");
    expect(st.items[0].data["text/html"]).toBe("<b>theirs</b>");
    const dictated = writes.filter((w) => String(w.data["text/plain"]) !== "theirs");
    expect(dictated.map((w) => w.data["text/plain"])).toEqual(["one", " two", " three"]);
    for (const w of dictated) { expect(w.types).toContain(HIST); expect(w.types).toContain(CLOUD); }
  });

  it("copy only: the clipboard holds everything said so far, not just the last phrase", async () => {
    const { d, text, writes } = make({ v: 2, insert: "copy" });
    const run = d.newPhraseRun();
    expect(await d.insert("First phrase.", { hook: {}, run })).toMatchObject({ action: "copy", reason: "setting" });
    await d.insert("Second one.", { hook: {}, run });
    expect(text()).toBe("First phrase. Second one.");
    expect(writes.at(-1)?.types).toContain(HIST);
  });

  it("one dictation at a time is unchanged: no run, no space added", async () => {
    const { d, pasted } = make();
    await d.insert("one", { hook: {} });
    await d.insert("two", { hook: {} });
    expect(pasted).toEqual(["one", "two"]);
  });

  it("a new run starts clean", () => {
    const a = core.createPhraseRun();
    a.typed("word");
    expect(a.pasteText("next")).toBe(" next");
    expect(core.createPhraseRun().pasteText("next")).toBe("next");
  });
});
