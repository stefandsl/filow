import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LangProvider } from "@filow/ui";
import { OverlayFrame } from "./OverlayFrame";

const render = (overlay: boolean) =>
  renderToStaticMarkup(
    <LangProvider lang="it">
      <OverlayFrame overlay={overlay} onClose={() => undefined}>
        <p>codice</p>
      </OverlayFrame>
    </LangProvider>,
  );

describe("overlay window chrome", () => {
  it("gives the frameless overlay a drag handle and a labelled close button", () => {
    const html = render(true);
    expect(html).toContain('class="overlay-bar"');
    expect(html).toContain('class="drag"');
    expect(html).toMatch(/<button[^>]*aria-label="[^"]+"[^>]*>/);
    expect(html).toContain("<p>codice</p>");
  });
  it("adds nothing outside the overlay window", () => {
    expect(render(false)).toBe("<p>codice</p>");
  });
  it("wraps every state of the mirror page, including the code entry and the waiting screen", () => {
    const page = readFileSync(new URL("../app/mirror/page.tsx", import.meta.url), "utf8");
    const returns = page.slice(page.indexOf("function Mirror(")).match(/return \(\s*<OverlayFrame/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(3);
  });
});
