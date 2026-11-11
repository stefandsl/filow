import { renderToStaticMarkup } from "react-dom/server";
import { LangProvider } from "@filow/ui";
import { expect, it } from "vitest";
import { LANGS, t } from "@filow/core";
import { ImportError } from "./ImportError";

it("immediately exposes the full import error as an alert in every interface language", () => {
  for (const lang of LANGS) {
    const html = renderToStaticMarkup(<LangProvider lang={lang}><ImportError error="Corrupt document & invalid format" /></LangProvider>);
    expect(html).toContain('role="alert"');
    if (lang === "en" || lang === "it") expect(html).toContain(lang === "en" ? 'Could not import the document:' : 'Impossibile importare il documento:');
    // the sentence of this language around the error, not the English one
    const lead = t("import.failed", lang, { error: "" }).trim();
    expect(lead.length).toBeGreaterThan(5);
    expect(html).toContain(lead);
    if (lang !== "en") expect(html).not.toContain('Could not import the document');
    expect(html).toContain('Corrupt document &amp; invalid format');
    expect(html).not.toMatch(/hidden|<details/);
  }
});
