import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../../packages/core/src/index";
import Tour from "./page";

// A factory snapshot may share its node_modules with the parent. The page must see its own copy.
vi.mock("@filow/core", async () => import("../../../../packages/core/src/index"));
const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("@/components/LangSwitch", () => ({ useUiLang: () => [language.value] }));

describe("N-02 first task", () => {
  it.each([["en", "Talk or type"], ["it", "Parla o scrivi"]] as const)("offers a keyboard button before local practice in %s", (lang, label) => {
    language.value = lang;
    const html = renderToStaticMarkup(<Tour />);
    expect(html).toContain(">" + label + "</button>");
    expect(html.indexOf(label + "</button>")).toBeLessThan(html.indexOf(t("tour.highlight", lang) + "</button>"));
    expect(html).toContain(t("tour.target", lang));
    expect(html).toContain(t("tour.private", lang));
  });
  it("opens the same question box as the prompter without submitting a canned question", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/await openOkFilow\(/);
    expect(page).not.toMatch(/tour\?\.ask\(/);
  });
  it("shows the first-use action on the first Welcome screen", () => {
    const html = readFileSync(new URL("../../../desktop/welcome.html", import.meta.url), "utf8");
    const firstScreen = html.match(/<section[^>]*data-step="language"[\s\S]*?<\/section>/)?.[0];
    expect(firstScreen).toMatch(/<button[^>]*type="button"[^>]*data-i18n="ctl.okfilow"/);
  });
});
