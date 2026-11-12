import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, LANGS, t, type I18nKey, type Lang } from "@filow/core";
import { iconPaths } from "../icons";
import { DisplayPanel } from "./DisplayPanel";
import { SectionNav } from "./SectionNav";

// The owner asked for the quick "Display" panel and the whiteboard as buttons in the sidebar, above
// "Import document" and "Reload script". Teleprompter.tsx is not rendered in a unit test (it needs a
// browser), so its wiring is read from the source; the look is checked over CDP (tmp/sidebar-buttons).
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const prompter = fs.readFileSync(path.join(here, "..", "Teleprompter.tsx"), "utf8");
const translate = (lang: Lang, key: I18nKey) => t(key, lang);
const css = fs.readFileSync(path.join(here, "..", "..", "app", "globals.css"), "utf8");

describe("Display and Whiteboard buttons in the sidebar", () => {
  it("puts the tool buttons first in the block at the foot of the sidebar, above Import and Reload", () => {
    const html = renderToStaticMarkup(<SectionNav sections={[{ id: "a", title: "Intro" }]} current={0} onSelect={() => {}}
      toolActions={<><button>Display</button><button>Whiteboard</button></>} importAction={<button>Import</button>} reloadAction={<button>Reload</button>} />);
    const actions = html.slice(html.indexOf('class="nav-actions"'));
    expect(actions.match(/<button>([^<]+)<\/button>/g)).toEqual(["<button>Display</button>", "<button>Whiteboard</button>", "<button>Import</button>", "<button>Reload</button>"]);
    // the buttons are outside the scrolling list of sections, so a long script never pushes them away
    expect(html.indexOf('class="section-nav-list"')).toBeLessThan(html.indexOf('class="nav-actions"'));
    expect(html.slice(html.indexOf('class="section-nav-list"'), html.indexOf('class="nav-actions"'))).not.toContain("Display");
  });

  it("the main window hands both buttons to the sidebar: Display opens the quick panel, Whiteboard calls it up", () => {
    const nav = prompter.slice(prompter.indexOf("<SectionNav"), prompter.indexOf("importAction="));
    expect(nav).toContain("toolActions={<>");
    expect(nav).toMatch(/<button type="button" className="btn display-link" onClick=\{\(\) => setDisplayOpen\(true\)\} aria-label=\{t\("display\.open"\)\} title=\{t\("display\.openTitle"\)\} aria-haspopup="dialog"><Icon name="sliders" \/><span className="action-label">\{t\("display\.open"\)\}<\/span><\/button>/);
    expect(nav).toMatch(/<button type="button" className="btn whiteboard-link" onClick=\{\(\) => void openWhiteboard\(\)\} aria-label=\{t\("ctl\.whiteboard"\)\} title=\{t\("ctl\.whiteboardTitle"\)\}><Icon name="board" \/><span className="action-label">\{t\("ctl\.whiteboard"\)\}<\/span><\/button>/);
    expect(prompter.indexOf("display-link")).toBeLessThan(prompter.indexOf("whiteboard-link"));
    expect(prompter).toContain('import { openWhiteboard } from "@/lib/whiteboard/open";');
    expect(iconPaths.board).toBeTruthy();
  });

  it("the header keeps the Settings gear and no second Display button", () => {
    const header = prompter.slice(prompter.indexOf('<header className="topbar">'), prompter.indexOf("</header>"));
    expect(header).toContain('<a className="btn settings-link" href="/settings"');
    expect(header).not.toContain("display-link");
    expect(prompter.match(/setDisplayOpen\(true\)/g)).toHaveLength(1);
  });

  it("the panel opened from the sidebar sits beside it; elsewhere (mirror page) it stays top right", () => {
    expect(prompter).toContain('<DisplayPanel prefs={display} onChange={setDisplay} onClose={() => setDisplayOpen(false)} pointsWindow={pointsWindow} anchor="sidebar" />');
    const beside = renderToStaticMarkup(<DisplayPanel prefs={DEFAULT_DISPLAY} onChange={() => {}} onClose={() => {}} anchor="sidebar" />);
    expect(beside).toContain("display-panel display-panel-sidebar");
    const plain = renderToStaticMarkup(<DisplayPanel prefs={DEFAULT_DISPLAY} onChange={() => {}} onClose={() => {}} />);
    expect(plain).toContain("display-panel");
    expect(plain).not.toContain("display-panel-sidebar");
    // clear of the 260px sidebar (56px in a narrow window) and never wider than the room left beside it
    expect(css).toContain("dialog.modal-bg.accessible-dialog:has(> .display-panel-sidebar) { justify-content: flex-start; align-items: flex-end; }");
    expect(css).toContain(".modal.display-panel.display-panel-sidebar { width: min(400px, calc(100vw - 292px)); margin: 64px 16px 16px 276px; }");
    expect(css).toContain("@media (max-width: 899px) { .modal.display-panel.display-panel-sidebar { width: min(400px, calc(100vw - 88px)); margin-left: 72px; } }");
    // the block of buttons keeps its height when the list of sections is long: the list shrinks and scrolls
    expect(css).toContain(".nav-actions { margin: auto 0 0; align-items: stretch; flex-direction: column; flex-shrink: 0; }");
  });

  it("names the Whiteboard button in all five languages", () => {
    const names = LANGS.map((lang) => translate(lang, "ctl.whiteboard"));
    expect(names).toEqual(["Whiteboard", "Lavagna", "Доска", "Tablă", "ホワイトボード"]);
    for (const lang of LANGS) {
      const title = translate(lang, "ctl.whiteboardTitle");
      expect(title).not.toBe("ctl.whiteboardTitle");
      expect(title.length).toBeGreaterThan(20);
      if (lang !== "en") expect(title).not.toBe(translate("en", "ctl.whiteboardTitle"));
    }
  });
});
