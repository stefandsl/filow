import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LangProvider } from "@filow/ui";
import { PreparedWaterCycle } from "./Teleprompter";

it.each([
  ["en", "Prepared water-cycle board", "Surface water", "Water vapour", "Cloud droplets", "Collection"],
  ["it", "Lavagna preparata sul ciclo dell’acqua", "Acqua in superficie", "Vapore acqueo", "Goccioline nella nube", "Raccolta"],
] as const)("shows the prepared board and lets the teacher choose a local photograph (%s)", (lang, title, surface, vapour, droplets, collection) => {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><PreparedWaterCycle onClose={() => {}} /></LangProvider>);
  expect(html).toContain(title);
  for (const [from, to] of [[surface, vapour], [vapour, droplets], [droplets, surface], [surface, collection]]) {
    expect(html).toContain(`<td>${from}</td><td aria-hidden="true">→</td><td>${to}</td>`);
  }
  expect(html).toContain('type="file"');
  expect(html).toContain("image/png");
});
