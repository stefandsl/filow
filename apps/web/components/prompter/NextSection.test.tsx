import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LangProvider } from "@filow/ui";
import { NextSection } from "./NextSection";

it("keeps full next points, completed state and a labelled horizontal resize control in EN and IT", () => {
  const point = "A long next-section point ".repeat(30);
  for (const lang of ["en", "it"] as const) {
    const html = renderToStaticMarkup(<LangProvider lang={lang}><NextSection title="Next" points={[point, "Done"]} completed={[false, true]} /></LangProvider>);
    expect(html).toContain(point);
    expect(html).toContain('<li class="done">Done</li>');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuemin="120"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(lang === "en" ? 'Drag to resize the next section (double click resets)' : 'Trascina per ridimensionare la prossima sezione (doppio clic per ripristinare)');
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlled).toBeTruthy();
    expect(html).toContain(`id="${controlled}"`);
  }
});
