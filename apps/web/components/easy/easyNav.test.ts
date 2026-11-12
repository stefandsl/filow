import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@filow/core";

// Settings opens on the Easy page; Advanced settings stays at its address, one link away, and the
// links that point at a section of it keep working.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../../../..", rel), "utf8");

describe("where Settings opens", () => {
  it("the app menu and the take toolbar open the Easy page", () => {
    expect(read("apps/desktop/main.js")).toMatch(/\{ label: mt\("settings"\), click: \(\) => win\.loadURL\(APP_URL \+ "\/settings"\) \}/);
    const take = read("apps/web/components/Teleprompter.tsx");
    expect(take).toContain('<a className="btn settings-link" href="/settings" aria-label={t("ctl.settings")}');
    expect(take).toContain('{id:"screenSettings",label:t("ctl.settings"),onSelect:() => { window.location.href = "/settings"; }}');
  });

  it("the menu entry and the toolbar tooltip are the plain word Settings in five languages", () => {
    const want = { en: "Settings", it: "Impostazioni", ru: "Настройки", ro: "Setări", ja: "設定" };
    for (const [lang, word] of Object.entries(want)) {
      const d = DICTIONARIES[lang as keyof typeof DICTIONARIES] as Record<string, string>;
      expect([d["menu.settings"], d["ctl.settingsTitle"]], lang).toEqual([word, word]);
    }
  });

  it("the Easy page is a page of its own, before Advanced, and leads to it", () => {
    const easy = read("apps/web/app/settings/page.tsx");
    expect(easy).toContain('advancedHref="/settings/local"');
    expect(easy).toContain('keyHref="/settings/local#freellm"');
    // it reads and writes through easy.ts only: no setting of its own is stored
    expect(easy).not.toMatch(/localStorage\.setItem|sessionStorage/);
    for (const fn of ["easyView(", "easyPatch(", "easyReset(", "writeEasyPatch("]) expect(easy, fn).toContain(fn);
  });

  it("Advanced settings says what it is, leads back, and keeps its section links", () => {
    const advanced = read("apps/web/app/settings/local/page.tsx");
    expect(advanced).toContain('<span className="subtitle">{t("easy.advanced")}</span>');
    expect(advanced).toMatch(/<Link className="btn" href="\/settings" data-testid="back-to-easy">\s*\{t\("easy\.back"\)\}/);
    // a download started on the Easy page lands on the list that runs it and can stop it
    expect(advanced).toContain('<section className="strip" id="models">');
    expect(advanced).toContain('window.location.hash === "#models") document.getElementById("models")?.scrollIntoView');
    expect(advanced).toContain('new URLSearchParams(window.location.search).get("auto")');
    // deep links from the take screen, the translate bar and the OK Filow panel
    expect(advanced).toContain('window.location.hash === "#setup"');
    expect(read("apps/web/app/settings/local/FreeLlmSettings.tsx")).toContain('id="freellm"');
    expect(read("apps/web/components/Teleprompter.tsx")).toContain('href="/settings/local#setup"');
  });
});
