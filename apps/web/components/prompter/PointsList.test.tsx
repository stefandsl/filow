import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LANGS, t } from "@filow/core";
import { LangProvider } from "@filow/ui";
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
import { PointsList, WhyDone, saidAnnouncement } from "./PointsList";
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

it("labels all three states in every interface language", () => {
 for (const lang of LANGS) {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><PointsList points={(["waiting","active","done"] as const).map(state => ({id:state,text:state,state,confidence:0.5}))} /></LangProvider>);
  if (lang === "en" || lang === "it") for (const label of lang === "en" ? ["Waiting","In progress","Said"] : ["In attesa","In corso","Detto"]) expect(html).toContain(label);
  for (const key of ["state.waiting", "state.active", "state.done"] as const) expect(html).toContain(escapeHtml(t(key, lang)));
  if (lang !== "en") expect(html).not.toContain("In progress");
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

it("explains a model flip: quote, time range, model, confidence and scores, in every interface language", () => {
 for (const lang of LANGS) {
  const html = renderToStaticMarkup(<LangProvider lang={lang}><WhyDone evidence={MODEL_EVIDENCE} /></LangProvider>);
  expect(html).toContain("We hired three engineers in July.");
  expect(html).toContain("clef-flash (local)");
  expect(html).toContain("91%");
  expect(html).toContain("80%");
  expect(html).toContain("62%");
  if (lang === "en" || lang === "it") expect(html).toContain(lang === "en" ? "Why is this done?" : "Perché è segnato come detto?");
  expect(html).toContain(escapeHtml(t("why.title", lang)));
  if (lang !== "en") expect(html).not.toContain("Why is this done?");
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

// A11Y-05 (WCAG 4.1.3): ticks are announced through a polite live region.
it("carries a polite live region that stays readable while hidden from sight", () => {
 const html = renderToStaticMarkup(<PointsList points={[{id:"a",text:"First",state:"waiting",confidence:0}]} />);
 expect(html).toMatch(/<div class="sr-only" role="status" aria-live="polite"><\/div>/);
 const rule = readFileSync(new URL('../../app/globals.css',import.meta.url),'utf8').match(/\.sr-only\s*\{([^}]*)\}/)?.[1] ?? "";
 expect(rule).toContain("clip-path: inset(50%)");
 expect(rule, "display none or visibility hidden silences a live region").not.toMatch(/display:\s*none|visibility:\s*hidden/);
});

it("announces the points that were just ticked, and nothing else", () => {
 const list = (...states: ("waiting" | "active" | "done")[]) => states.map((state, i) => ({id: `p${i}`, text: `Point ${i + 1}`, state}));
 const seen = (points: ReturnType<typeof list>) => new Map(points.map(p => [p.id, p.state]));
 // first render: points already done are not news
 expect(saidAnnouncement(null, list("done", "waiting"), "Said")).toBeNull();
 expect(saidAnnouncement(seen(list("waiting", "active")), list("done", "active"), "Said")).toBe("Said: Point 1");
 expect(saidAnnouncement(seen(list("waiting", "active")), list("done", "done"), "Detto")).toBe("Detto: Point 1. Detto: Point 2");
 // progress without a tick, and no change at all, say nothing
 expect(saidAnnouncement(seen(list("waiting", "waiting")), list("active", "waiting"), "Said")).toBeNull();
 expect(saidAnnouncement(seen(list("done", "waiting")), list("done", "waiting"), "Said")).toBeNull();
 // another section came on screen with a point already done: not news
 expect(saidAnnouncement(new Map([["other", "waiting" as const]]), list("done"), "Said")).toBeNull();
 // a reopened point clears the region, so ticking it again is announced again
 expect(saidAnnouncement(seen(list("done", "waiting")), list("waiting", "waiting"), "Said")).toBe("");
});
