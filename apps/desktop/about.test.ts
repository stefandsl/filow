import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { parseMarkdown, parseInline, policyFile, crashSummary, reportFile, reportName, createAboutPages, TEXT, SUPPORT } = require("./about.js");

const docs = path.join(__dirname, "..", "..", "docs");
const policy = (name: string) => parseMarkdown(readFileSync(path.join(docs, name), "utf8"));
type Span = { t: string; v: string; href?: string };
type Block = { type: string; level?: number; inline?: Span[]; items?: Span[][]; head?: Span[][]; rows?: Span[][][] };
const spans = (blocks: Block[]): Span[] => blocks.flatMap((b) => [...(b.inline || []), ...(b.items || []).flat(), ...(b.head || []).flat(), ...(b.rows || []).flat(2)]);

describe("the privacy policy shipped in the app", () => {
  it.each(["PRIVACY.md", "PRIVACY.it.md"])("%s reads as headings, paragraphs, lists and tables, with nothing left over", (name) => {
    const blocks: Block[] = policy(name);
    expect(blocks[0]).toMatchObject({ type: "h", level: 1 });
    for (const b of blocks.filter((x) => x.type === "table")) {
      for (const row of b.rows!) expect(row, `a row of a table in ${name} has a different number of cells`).toHaveLength(b.head!.length);
    }
    const text = spans(blocks).filter((s) => s.t === "text").map((s) => s.v).join("\n");
    // Markdown that the reader did not understand would show as raw characters on the page.
    expect(text).not.toMatch(/\*\*|`|\[\[|\]\]|^#|^\|/m);
    for (const link of spans(blocks).filter((s) => s.t === "link")) expect(link.href).toMatch(/^(https:\/\/|mailto:)/);
  });
  it("English and Italian have the same sections, tables and placeholders", () => {
    const shape = (blocks: Block[]) => blocks.map((b) => (b.type === "table" ? `table ${b.head!.length}x${b.rows!.length}` : b.type === "h" ? `h${b.level}` : b.type === "ul" || b.type === "ol" ? `${b.type} ${b.items!.length}` : b.type));
    const en: Block[] = policy("PRIVACY.md"), it: Block[] = policy("PRIVACY.it.md");
    expect(shape(it)).toEqual(shape(en));
    const todos = (blocks: Block[]) => spans(blocks).filter((s) => s.t === "todo").length;
    expect(todos(it)).toBe(todos(en));
    expect(todos(en), "the controller's name, address and contact are the owner's to fill").toBeGreaterThanOrEqual(3);
  });
  it("states plainly that the public link is on by default and that there is no telemetry", () => {
    const en = readFileSync(path.join(docs, "PRIVACY.md"), "utf8");
    expect(en).toMatch(/\*\*Today this link is on by default/);
    expect(en).toMatch(/\*\*No telemetry\.\*\*/);
  });
  it("Italian opens the Italian file when it is there, anything else the English one", () => {
    const join = (...p: string[]) => p.join("/");
    expect(policyFile("R", "it", () => true, join)).toBe("R/PRIVACY.it.md");
    expect(policyFile("R", "it", () => false, join)).toBe("R/PRIVACY.md");
    expect(policyFile("R", "en", () => true, join)).toBe("R/PRIVACY.md");
  });
});

describe("parseInline", () => {
  it("never turns a script or a non-web link into a link", () => {
    expect(parseInline("[x](javascript:alert(1)) <b>y</b>")).toEqual([{ t: "text", v: "[x](javascript:alert(1)) <b>y</b>" }]);
    expect(parseInline("see [docs](https://example.org/a) and **this**")).toEqual([
      { t: "text", v: "see " }, { t: "link", v: "docs", href: "https://example.org/a" }, { t: "text", v: " and " }, { t: "b", v: "this" },
    ]);
  });
});

describe("the problem report", () => {
  const sections = [{ id: "system", text: "Filow test" }, { id: "take", text: "" }, { id: "log", text: "line 1\n" }];
  it("puts the user's words first, titles each section in the user's language and counts crash files it leaves out", () => {
    const text = reportFile({ lang: "it", date: "2026-11-10 12:00", description: "  si blocca  ", sections, crash: { count: 2, mb: 1.5 } });
    expect(text.indexOf("si blocca")).toBeLessThan(text.indexOf("Filow test"));
    expect(text).toContain(`== ${TEXT.it.fileSystem}`);
    expect(text).toContain(TEXT.it.fileNoTake);
    expect(text).toContain("File di crash non inclusi: 2 (1.5 MB).");
    expect(reportFile({ lang: "en", date: "d", description: "", sections, crash: { count: 0, mb: 0 } })).toContain(TEXT.en.fileNone);
  });
  it("names the file by date", () => expect(reportName("2026-11-10 12:00")).toBe("filow-report-2026-11-10.txt"));
  it("counts .dmp files under Crashpad, a few folders deep", () => {
    const tree: Record<string, Array<{ name: string; dir: boolean }>> = {
      C: [{ name: "reports", dir: true }, { name: "settings.dat", dir: false }],
      "C/reports": [{ name: "a.dmp", dir: false }, { name: "b.DMP", dir: false }, { name: "notes.txt", dir: false }],
    };
    const fs = {
      readdirSync: (d: string) => (tree[d] || []).map((e) => ({ name: e.name, isDirectory: () => e.dir, isFile: () => !e.dir })),
      statSync: () => ({ size: 1024 * 1024 }),
    };
    expect(crashSummary("C", fs, (...p: string[]) => p.join("/"))).toEqual({ count: 2, mb: 2 });
    expect(crashSummary("missing", { readdirSync: () => { throw new Error("ENOENT"); } }, (...p: string[]) => p.join("/"))).toEqual({ count: 0, mb: 0 });
  });
  it("has the same keys and placeholders in English and Italian", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(TEXT.it).sort()).toEqual(Object.keys(TEXT.en).sort());
    for (const k of Object.keys(TEXT.en)) {
      expect(TEXT.it[k].trim(), k).not.toBe("");
      expect(vars(TEXT.it[k]), k).toEqual(vars(TEXT.en[k]));
    }
  });
  it("has no support address until the owner gives one (D33)", () => expect(SUPPORT).toEqual({ email: "", form: "" }));
});

describe("the About and privacy window", () => {
  function setup() {
    const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {};
    const windows: any[] = [];
    class Win extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() });
      constructor(public options: any) { super(); windows.push(this); }
      loadFile = vi.fn(async () => undefined);
      setMenuBarVisibility() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {} restore() {} close() {}
    }
    const written: Array<[string, string]> = [];
    const deps = {
      BrowserWindow: Win, ipcMain: { handle: (c: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { handlers[c] = fn; } },
      dialog: { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "D:/out/report.txt" })) },
      clipboard: { writeText: vi.fn() }, shell: { openPath: vi.fn() }, openExternalSafe: vi.fn(), logLine: vi.fn(),
      fs: { existsSync: () => false, readFileSync: () => "# Policy\n\nText.", readdirSync: () => [], statSync: () => ({ size: 0 }), writeFileSync: (f: string, t: string) => { written.push([f, t]); } },
      path, pageFile: "about.html", preload: "about-preload.js", lang: () => "en", theme: () => "dark", icon: () => "icon.ico",
      info: () => ({ version: "1.0", electron: "45", configFolder: "G:/profile" }), docsDir: "G:/docs", crashDir: "G:/profile/Crashpad",
      documentsDir: () => "D:/docs", collectReport: vi.fn(async () => [{ id: "log", text: "the log" }]),
    };
    const pages = createAboutPages(deps);
    const call = (channel: string, win: { webContents: unknown }, ...args: unknown[]) => handlers[channel]({ sender: win.webContents }, ...args);
    return { pages, deps, windows, handlers, call, written };
  }
  it("keeps the window on its own page: links go to the system browser, new windows are refused", () => {
    const s = setup(); const w = s.pages.open("about");
    const event = { preventDefault: vi.fn() };
    w.webContents.emit("will-navigate", event, "https://example.org/");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(s.deps.openExternalSafe).toHaveBeenCalledWith("https://example.org/");
    const open = w.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(open({ url: "https://x.org/" })).toEqual({ action: "deny" });
    expect(w.options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  });
  it("reads the policy from the package and answers only its own window", async () => {
    const s = setup(); const w = s.pages.open("about");
    const data: any = await s.call("about:data", w);
    expect(data.policy[0]).toMatchObject({ type: "h", level: 1 });
    expect(() => s.handlers["about:data"]({ sender: {} })).toThrow("Denied");
  });
  it("saves exactly the text it showed, with the user's words, to the file the user picked", async () => {
    const s = setup(); const w = s.pages.open("report");
    await s.call("report:data", w);
    const shown = await s.call("report:preview", w, "it froze");
    expect(await s.call("report:save", w, "it froze")).toEqual({ saved: "D:/out/report.txt" });
    expect(s.written).toEqual([["D:/out/report.txt", shown]]);
    expect(s.deps.openExternalSafe, "nothing leaves the PC").not.toHaveBeenCalled();
  });
  it("writes nothing when the user cancels the save", async () => {
    const s = setup(); const w = s.pages.open("report");
    s.deps.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "" });
    expect(await s.call("report:save", w, "")).toEqual({ canceled: true });
    expect(s.written).toEqual([]);
  });
  it("the page learns the view asked for last, even when it was asked before the page loaded", async () => {
    const s = setup(); const w = s.pages.open("about");
    s.pages.open("report");
    expect(s.windows).toHaveLength(1);
    expect(((await s.call("about:data", w)) as { view: string }).view).toBe("report");
  });
  it("closes when asked (the main window went away), and a later open makes a new window", () => {
    const s = setup(); const w = s.pages.open("about"); w.close = vi.fn(() => w.emit("closed"));
    s.pages.close();
    expect(w.close).toHaveBeenCalledOnce();
    s.pages.open("about");
    expect(s.windows).toHaveLength(2);
  });
  it("opens no mail or form while no support address is set", async () => {
    const s = setup(); const w = s.pages.open("report");
    await s.call("report:support", w, "email");
    await s.call("report:support", w, "form");
    expect(s.deps.openExternalSafe).not.toHaveBeenCalled();
  });
});
