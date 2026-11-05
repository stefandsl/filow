import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LangProvider } from "@filow/ui";
import { PointsList } from "./PointsList";
it("keeps full points and three semantic states", () => {
 const long = "A long talking point ".repeat(10);
 const html = renderToStaticMarkup(<PointsList points={(["waiting","active","done"] as const).map((state,i) => ({id:String(i), text:long, state, confidence:0.45}))} />);
 expect(html.split(long)).toHaveLength(4);
 for (const icon of ["clock","circle","check"]) expect(html).toContain(`data-icon="${icon}"`);
 for (const state of ["waiting","active","done"]) expect(html).toContain(`data-state="${state}"`);
 for (const percent of [0,45,100]) expect(html).toContain(`aria-valuenow="${percent}"`);
 const css = readFileSync(new URL('../../app/globals.css',import.meta.url),'utf8');
 expect(css).toMatch(/\.point-text\s*\{[^}]*overflow-wrap: anywhere/);
 expect(css).not.toMatch(/\.point[^{}]*\{[^}]*text-overflow/);
 expect(css).toContain('font-size: 1.375rem; font-weight: 700');
});

it("labels all three states in both languages", () => {
 for (const lang of ["en", "it"] as const) {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><PointsList points={(["waiting","active","done"] as const).map(state => ({id:state,text:state,state,confidence:0.5}))} /></LangProvider>);
  for (const label of lang === "en" ? ["Waiting","In progress","Said"] : ["In attesa","In corso","Detto"]) expect(html).toContain(label);
 }
});

it("exposes the manual toggle state to assistive technology", () => {
 const html = renderToStaticMarkup(<PointsList onToggle={() => {}} points={[{id:"done",text:"Said",state:"done",confidence:1},{id:"wait",text:"Pending",state:"waiting",confidence:0}]} />);
 expect(html).toContain('aria-pressed="true"'); expect(html).toContain('aria-pressed="false"');
});
