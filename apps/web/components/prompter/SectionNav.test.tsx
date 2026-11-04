import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SectionNav } from "./SectionNav";
for (const layout of ["rail", "sidebar"] as const) it(`renders 12 reachable sections in ${layout}`, () => {
  const html = renderToStaticMarkup(<SectionNav layout={layout} sections={Array.from({length:12}, (_,i) => ({id:`s${i}`,title:`Section title ${i}`}))} current={10} onSelect={() => {}} importAction={<button>Import</button>} reloadAction={<button>Reload</button>} />);
  expect(html.match(/data-section-index=/g)).toHaveLength(12);
  expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  for (let i=0; i<12; i++) { expect(html).toContain(`Section title ${i}`); expect(html).toContain(String(i+1).padStart(2,"0")); }
  expect(html).toContain('Import');
});
