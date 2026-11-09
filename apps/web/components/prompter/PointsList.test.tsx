import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LangProvider } from "@filow/ui";
import { PointsList, WhyDone } from "./PointsList";
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

const MODEL_EVIDENCE = { source: "model" as const, quote: "We hired three engineers in July.", fromMs: Date.UTC(2026, 10, 8, 20, 4, 12), toMs: Date.UTC(2026, 10, 8, 20, 4, 19), decision: 0.91, gate: 0.62, lexical: 0.8, model: "clef-flash (local)" };

it("offers 'why is this done?' on a done point with evidence, with a hover summary", () => {
 const html = renderToStaticMarkup(<PointsList onToggle={() => {}} points={[{id:"s0b0",text:"We hired 3 engineers",state:"done",confidence:0.91,evidence:MODEL_EVIDENCE},{id:"s0b1",text:"Pending",state:"waiting",confidence:0}]} />);
 expect(html.match(/class="point-why-btn"/g)).toHaveLength(1);
 expect(html).toContain('aria-expanded="false"');
 expect(html).toMatch(/title="[^"]*We hired three engineers in July\.[^"]*clef-flash \(local\)[^"]*"/);
 expect(html).toMatch(/class="point-why"[^>]*hidden=""/); // collapsed until asked, but present for aria-controls
});

it("explains a model flip: quote, time range, model, confidence and scores, in both languages", () => {
 for (const lang of ["en", "it"] as const) {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><WhyDone evidence={MODEL_EVIDENCE} /></LangProvider>);
  expect(html).toContain("We hired three engineers in July.");
  expect(html).toContain("clef-flash (local)");
  expect(html).toContain("91%");
  expect(html).toContain("80%");
  expect(html).toContain("62%");
  expect(html).toContain(lang === "en" ? "Why is this done?" : "Perché è segnato come detto?");
 }
});

it("explains a manual mark", () => {
 const html = renderToStaticMarkup(<WhyDone evidence={{ source: "manual", fromMs: 0, toMs: 0 }} />);
 expect(html).toContain("Marked by hand");
 expect(html).not.toContain("%");
});

/** The outer HTML of the first element carrying role="button", found by counting nested divs. */
function toggleRow(html: string): string {
 const start = html.lastIndexOf("<div", html.indexOf('role="button"'));
 let depth = 0;
 for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
  depth += m[0] === "<div" ? 1 : -1;
  if (depth === 0) return html.slice(start, start + (m.index ?? 0) + 6);
 }
 return html.slice(start);
}

it("keeps the Why? button and its panel outside the toggle row (no nested interactive elements)", () => {
 const html = renderToStaticMarkup(<PointsList onToggle={() => {}} points={[{id:"s0b0",text:"We hired 3 engineers",state:"done",confidence:0.91,evidence:MODEL_EVIDENCE}]} />);
 const row = toggleRow(html);
 expect(row).toContain("We hired 3 engineers");
 expect(row).not.toContain("<button");
 expect(row).not.toContain("point-why");
 expect(html).toContain('aria-controls="why-s0b0"');
 expect(html).toMatch(/<div[^>]*id="why-s0b0"[^>]*hidden=""|<div[^>]*hidden=""[^>]*id="why-s0b0"/);
});
