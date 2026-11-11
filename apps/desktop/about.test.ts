import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { runInThisContext } from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
// about.js reads its texts from vendor/i18n, a build of the core dictionary (npm run build:welcome)
// that is not in git: the test hands it the source, as main.seams.test.ts does.
import * as i18n from "../../packages/core/src/i18n";

/** about.js, loaded with vendor/i18n replaced by the core source. */
function loadAbout() {
  const file = path.resolve(__dirname, "about.js");
  const own = createRequire(file);
  const mod = { exports: {} as Record<string, unknown> };
  const wrapped = runInThisContext(Module.wrap(readFileSync(file, "utf8")), { filename: file });
  wrapped.call(mod.exports, mod.exports, (id: string) => (id === "./vendor/i18n" ? i18n : own(id)), mod, file, path.dirname(file));
  return mod.exports;
}
const { parseMarkdown, parseInline, policyFile, crashSummary, reportFile, reportName, issueUrl, createAboutPages, textFor, ABOUT_KEYS, SUPPORT, ISSUE_URL_LIMIT } = loadAbout() as any;
const TEXT = { en: textFor("en"), it: textFor("it") };

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
  it("reads every text from the shared dictionary (the parity test covers its languages)", () => {
    const en = i18n.DICTIONARIES.en as Record<string, string>;
    expect((ABOUT_KEYS as string[]).filter((k) => !en[`about.${k}`])).toEqual([]);
    for (const lang of i18n.LANGS) for (const k of ABOUT_KEYS as string[]) expect(textFor(lang)[k], `${lang} ${k}`).toBe(i18n.t(`about.${k}` as i18n.I18nKey, lang));
  });
  it("sends reports to the project's GitHub issues page", () => {
    expect(SUPPORT).toEqual({ issues: "https://github.com/stefandsl/filow/issues", newIssue: "https://github.com/stefandsl/filow/issues/new" });
  });
});

describe("the report as a new GitHub issue", () => {
  const sections = [
    { id: "system", text: "Filow 0.9.31 · win32 x64" },
    { id: "take", text: "" },
    { id: "log", text: "first line\nmiddle line\nlast line" },
  ];
  const read = (url: string) => { const u = new URL(url); return { u, title: u.searchParams.get("title") || "", body: u.searchParams.get("body") || "" }; };
  const longLog = (lines: number, word = "line of the log") => Array.from({ length: lines }, (_, i) => `${i + 1} ${word}`).join("\n");

  it("opens the new-issue page with a title from the user's first line and the whole short report", () => {
    const r = issueUrl({ lang: "en", description: "  The points stopped\nafter slide 3.  ", sections, version: "0.9.31" });
    const { u, title, body } = read(r.url);
    expect(u.origin + u.pathname).toBe(SUPPORT.newIssue);
    expect([...u.searchParams.keys()]).toEqual(["title", "body"]);
    expect(title).toBe("Problem report: The points stopped");
    expect(body).toBe(r.body);
    expect(body).toContain("The points stopped\nafter slide 3.");
    expect(body).toContain(`### ${TEXT.en.fileSystem}\n\`\`\`\nFilow 0.9.31 · win32 x64\n\`\`\``);
    expect(body).toContain(TEXT.en.fileNoTake);
    expect(body).toContain("first line\nmiddle line\nlast line");
    expect(r.cut).toBe(false);
    expect(body).not.toContain(TEXT.en.issueCut);
  });
  it("names the version when the user wrote nothing, in the user's language", () => {
    expect(read(issueUrl({ lang: "it", description: "", sections, version: "0.9.31" }).url).title).toBe("Segnalazione di un problema (Filow 0.9.31)");
    const long = read(issueUrl({ lang: "en", description: "word ".repeat(40), sections, version: "1" }).url).title;
    expect(long.length).toBeLessThanOrEqual("Problem report: ".length + 80);
    expect(long.endsWith("…")).toBe(true);
  });
  it("puts nothing in the link but the user's words and the sections it was given", () => {
    const { body } = read(issueUrl({ lang: "en", description: "WORDS", sections: [{ id: "log", text: "MASKED-LOG" }], version: "1" }).url);
    const fixed = [`### ${TEXT.en.fileWhat}`, "WORDS", `### ${TEXT.en.fileLog}`, "```", "MASKED-LOG", "```"];
    expect(body.split("\n").filter(Boolean)).toEqual(fixed);
  });
  it("cuts a long report to the limit: the newest log lines stay, and a line says the file has the rest", () => {
    const r = issueUrl({ lang: "en", description: "it froze", sections: [sections[0], { id: "take", text: longLog(300) }, { id: "log", text: longLog(900) }], version: "1" });
    expect(r.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(r.url.length, "the room is used").toBeGreaterThan(ISSUE_URL_LIMIT - 400);
    const { body } = read(r.url);
    expect(r.cut).toBe(true);
    expect(body.endsWith(TEXT.en.issueCut)).toBe(true);
    expect(body).toContain("it froze");
    expect(body).toContain("Filow 0.9.31");
    expect(body).toContain("900 line of the log");
    expect(body).toContain("300 line of the log");
    expect(body).not.toMatch(/^1 line of the log$/m);
    expect(body).toContain(`${TEXT.en.issueEarlier}\n`);
    // whole lines only: every kept log line is one of the original lines
    for (const line of body.split("\n").filter((l) => /line of the log/.test(l))) expect(line).toMatch(/^\d+ line of the log$/);
  });
  it("counts the limit on the escaped link: accents, apostrophes, Japanese and emoji", () => {
    for (const word of ["perché l'utente è lì", "日本語のログ", "😀😀 log 😀"]) {
      const r = issueUrl({ lang: "it", description: `${word} `.repeat(300), sections: [{ id: "log", text: longLog(500, word) }], version: "1" });
      expect(r.url.length, word).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
      expect(() => decodeURIComponent(new URL(r.url).search), word).not.toThrow();
      expect(read(r.url).title + read(r.url).body, `${word}: no character cut in half`).not.toContain("�");
      expect(read(r.url).body, `${word}: the newest log line stays, however much the user wrote`).toContain(`500 ${word}`);
      expect(read(r.url).body.endsWith(TEXT.it.issueCut), word).toBe(true);
    }
  });
  it("keeps the user's words whole while cutting the logs is enough, and never splits a character pair", () => {
    const words = "😀".repeat(100);
    const r = issueUrl({ lang: "en", description: words, sections: [{ id: "log", text: longLog(2000) }], version: "1" });
    expect(read(r.url).body).toContain(words);
    const tight = issueUrl({ lang: "en", description: "😀".repeat(2000), sections: [], version: "1", limit: 1001 });
    expect(tight.url.length).toBeLessThanOrEqual(1001);
    expect(() => encodeURIComponent(tight.body)).not.toThrow();
    expect(tight.title + tight.body).not.toContain("�");
    expect(tight.title).toBe(`Problem report: ${"😀".repeat(39)}…`);
  });
  it("shortens a very long description rather than drop the logs", () => {
    for (const words of ["日本語".repeat(240), "word ".repeat(800)]) {
      const r = issueUrl({ lang: "en", description: words, sections: [sections[0], { id: "log", text: longLog(400) }], version: "1" });
      expect(r.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
      expect(r.body).toContain("Filow 0.9.31");
      expect(r.body).toContain("400 line of the log");
      expect(r.body.match(/^\d+ line of the log$/gm)!.length, "at least the floor of log lines").toBeGreaterThan(40);
      expect(r.body).toContain(`${words.slice(0, 60)}`);
      expect(r.body).toMatch(/…\n\n### /);
    }
  });
  it("keeps the end of a last log line that is longer than the room there is", () => {
    const r = issueUrl({ lang: "en", description: "", sections: [{ id: "log", text: `old\n${"x".repeat(7000)} THE END` }], version: "1" });
    expect(r.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(r.url.length).toBeGreaterThan(ISSUE_URL_LIMIT - 400);
    expect(r.body).toContain("x THE END\n```");
  });
  it("never goes over the limit, whatever it is given", () => {
    const big = [{ id: "system", text: "s".repeat(7000) }, { id: "log", text: longLog(900) }];
    const r = issueUrl({ lang: "en", description: "words", sections: big, version: "1" });
    expect(r.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(r.cut).toBe(true);
    expect(r.body, "an oversized first section is cut like the others, the log stays").toContain("900 line of the log");
    for (const limit of [3000, 1200, 600, 300, 120, 60]) {
      const t = issueUrl({ lang: "it", description: "perché l'utente ".repeat(200), sections: big, version: "1", limit });
      expect(t.url.length, String(limit)).toBeLessThanOrEqual(limit);
      expect(t.url.startsWith(SUPPORT.newIssue), String(limit)).toBe(true);
      expect(t.cut, String(limit)).toBe(true);
    }
  });
  it("keeps the issue strings in the shared dictionary, in every language, and the page gets them with the rest", () => {
    const issueKeys = (ABOUT_KEYS as string[]).filter((k) => k.startsWith("issue"));
    expect(issueKeys).toHaveLength(10);
    for (const lang of i18n.LANGS) for (const k of issueKeys) expect((i18n.DICTIONARIES[lang] as Record<string, string>)[`about.${k}`], `${lang}.${k}`).toBe(textFor(lang)[k]);
    expect(TEXT.en.issuePublic).toMatch(/public/);
    expect(TEXT.it.issuePublic).toMatch(/pubbliche/);
  });
  it("a log line cannot close its code fence, so nothing in a log becomes a mention or markup", () => {
    const { body } = read(issueUrl({ lang: "en", description: "", sections: [{ id: "log", text: "before\n```\n@someone #12 <b>" }], version: "1" }).url);
    expect(body).toContain("````\nbefore\n```\n@someone #12 <b>\n````");
  });
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
  it("shows a Japanese user the English policy, with the page around it and the note in Japanese", async () => {
    const s = setup(); s.deps.lang = () => "ja"; const w = s.pages.open("about");
    const data: any = await s.call("about:data", w);
    expect(data.policyLang).toBe("en");
    expect(data.text.policyEnglish).toBe(i18n.t("about.policyEnglish", "ja"));
    expect(data.text.tabAbout).toBe(i18n.t("about.tabAbout", "ja"));
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
  it("opens the GitHub issue only on the click, through openExternalSafe, with the masked sections that were shown", async () => {
    const s = setup(); const w = s.pages.open("report");
    await s.call("report:data", w);
    await s.call("report:preview", w, "it froze");
    expect(s.deps.openExternalSafe, "showing the report sends nothing").not.toHaveBeenCalled();
    expect(await s.call("report:issue", w, "it froze")).toEqual({ opened: true, cut: false });
    expect(s.deps.openExternalSafe).toHaveBeenCalledOnce();
    expect(s.deps.shell.openPath, "no other way out").not.toHaveBeenCalled();
    const url = new URL(s.deps.openExternalSafe.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://github.com/stefandsl/filow/issues/new");
    expect(url.searchParams.get("title")).toBe("Problem report: it froze");
    expect(url.searchParams.get("body")).toBe(issueUrl({ lang: "en", description: "it froze", sections: [{ id: "log", text: "the log" }], version: "1.0" }).body);
    expect(s.deps.collectReport, "the sections are the ones the user was shown").toHaveBeenCalledOnce();
    expect(() => s.handlers["report:issue"]({ sender: {} }, "x")).toThrow("Denied");
  });
  it("says so when the browser did not open", async () => {
    const s = setup(); const w = s.pages.open("report");
    s.deps.openExternalSafe.mockRejectedValueOnce(new Error("no browser"));
    expect(await s.call("report:issue", w, "")).toEqual({ error: "no browser" });
    expect(s.deps.collectReport, "collected first when the click came before the report was shown").toHaveBeenCalledOnce();
  });
  it("has no other channel that could send the report", () => {
    const s = setup(); s.pages.open("report");
    expect(Object.keys(s.handlers).sort()).toEqual(["about:close", "about:data", "about:openConfigFolder", "report:copy", "report:data", "report:issue", "report:openCrashFolder", "report:preview", "report:save"]);
  });
});
