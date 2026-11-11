import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LANGS, t } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { NextSection } from "./NextSection";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

it("keeps full next points, completed state and a labelled horizontal resize control in every interface language", () => {
  const point = "A long next-section point ".repeat(30);
  for (const lang of LANGS) {
    const html = renderToStaticMarkup(<LangProvider lang={lang}><NextSection title="Next" points={[point, "Done"]} completed={[false, true]} /></LangProvider>);
    expect(html).toContain(point);
    expect(html).toContain('<li class="done">Done</li>');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuemin="120"');
    expect(html).toContain('tabindex="0"');
    if (lang === "en" || lang === "it") expect(html).toContain(lang === "en" ? 'Drag to resize the next section (double click resets)' : 'Trascina per ridimensionare la prossima sezione (doppio clic per ripristinare)');
    expect(html).toContain(escapeHtml(t("next.resize", lang)));
    if (lang !== "en") expect(html).not.toContain('Drag to resize');
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlled).toBeTruthy();
    expect(html).toContain(`id="${controlled}"`);
  }
});
