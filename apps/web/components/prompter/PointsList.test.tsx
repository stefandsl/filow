import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PointsList } from "./PointsList";
for (const layout of ["rail", "sidebar"] as const) it(`keeps full points and three semantic states in ${layout}`, () => {
 const long = "A long talking point ".repeat(10);
 const html = renderToStaticMarkup(<PointsList layout={layout} points={(["waiting","active","done"] as const).map((state,i) => ({id:String(i), text:long, state, confidence:0.45}))} />);
 expect(html.split(long)).toHaveLength(4);
 for (const icon of ["clock","circle","check"]) expect(html).toContain(`data-icon="${icon}"`);
 for (const state of ["waiting","active","done"]) expect(html).toContain(`data-state="${state}"`);
 for (const percent of [0,45,100]) expect(html).toContain(`aria-valuenow="${percent}"`);
 const css = readFileSync(new URL('../../app/globals.css',import.meta.url),'utf8');
 expect(css).toMatch(/\.point-text\s*\{[^}]*overflow-wrap: anywhere/);
 expect(css).not.toMatch(/\.point[^{}]*\{[^}]*text-overflow/);
 expect(css).toContain('font-size: 1.375rem; font-weight: 700');
});
