import { renderToStaticMarkup } from "react-dom/server";
import { LangProvider } from "@filow/ui";
import { expect, it } from "vitest";
import { ImportError } from "./ImportError";

it("immediately exposes the full import error as an alert in EN and IT", () => {
  for (const lang of ["en", "it"] as const) {
    const html = renderToStaticMarkup(<LangProvider lang={lang}><ImportError error="Corrupt document & invalid format" /></LangProvider>);
    expect(html).toContain('role="alert"');
    expect(html).toContain(lang === "en" ? 'Could not import the document:' : 'Impossibile importare il documento:');
    expect(html).toContain('Corrupt document &amp; invalid format');
    expect(html).not.toMatch(/hidden|<details/);
  }
});
