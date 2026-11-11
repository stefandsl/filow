import { renderToStaticMarkup } from "react-dom/server";
import { useLang } from "@filow/ui";
import { expect, it, vi } from "vitest";
import { okfText } from "@/lib/buddy/text";

// T1: the OK Filow windows were always English because no LangProvider wrapped /okfilow/*. The layout
// feeds the provider from the same preference as the main window (useUiLang, here the stored "it").
vi.mock("@/components/LangSwitch", () => ({ useUiLang: () => ["it", () => {}] }));

function Probe() {
  const t = okfText(useLang());
  return <p>{t("close")}</p>;
}

it("gives the OK Filow windows the interface language the user picked", async () => {
  const { default: OkFilowLayout } = await import("@/app/okfilow/layout");
  expect(renderToStaticMarkup(<OkFilowLayout><Probe /></OkFilowLayout>)).toBe("<p>Chiudi</p>");
});

it("reads English for a key a language lacks, and lets a client say a sentence its own way", () => {
  expect(okfText("xx")("close")).toBe("Close");
  expect(okfText("en", { close: "desktopOnly" })("close")).toBe(okfText("en")("desktopOnly"));
});
