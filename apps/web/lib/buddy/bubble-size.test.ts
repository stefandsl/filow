import { it, expect } from "vitest";
import { observeBubbleSize } from "./bubble-size";
import fs from "node:fs";
it("measures initial and streamed sizes and disconnects on unmount", () => {
  let resize=()=>{}, disconnected=false;
  class Observer { constructor(fn:()=>void) { resize=fn; } observe() {} disconnect() { disconnected=true; } }
  const inner={offsetWidth:150,offsetHeight:25} as HTMLElement, outer={style:{}} as HTMLElement;
  const off=observeBubbleSize(inner,outer,Observer as unknown as typeof ResizeObserver);
  expect(outer.style).toEqual({width:"178px",height:"45px"});
  Object.assign(inner,{offsetWidth:352,offsetHeight:80}); resize();
  expect(outer.style).toEqual({width:"380px",height:"100px"}); off(); expect(disconnected).toBe(true);
});
it("animates both dimensions for 160 ms, with a reduced-motion opt-out", () => {
  const css=fs.readFileSync(new URL("../../app/okfilow/okfilow.css",import.meta.url),"utf8");
  expect(css).toContain("width 160ms ease-out, height 160ms linear, transform .16s ease-out");
  expect(css).toContain(".okf-bubble, .okf-bubble--answer { transition: none; }");
});

it("releases trailing marks only for the live answer after the voice completes", () => {
 const page=fs.readFileSync(new URL("../../app/okfilow/panel/page.tsx",import.meta.url),"utf8");
 expect(page).toMatch(/await voice.finish\(text\);\s*if \(run.current === id && answerCtx.current\?\.gate\) \{\s*answerCtx.current.gate.spoken = Infinity;\s*releaseMarks\(\);/);
});
it("keeps model margins click-through and limits the hover IPC to the model renderer", () => {
 const main=fs.readFileSync(new URL("../../../desktop/okfilow.js",import.meta.url),"utf8");
 expect(main).toContain('modelWin.setIgnoreMouseEvents(true, { forward: true })');
 expect(main).toContain('e.sender === modelWin.webContents');
 expect(main).toContain('modelWin.setIgnoreMouseEvents(active !== true, { forward: true })');
});

it("remembers speech that started before the first mark arrived", () => {
 const page=fs.readFileSync(new URL("../../app/okfilow/panel/page.tsx",import.meta.url),"utf8");
 expect(page).toContain('if (answerCtx.current) answerCtx.current.spoken = n;');
 expect(page).toContain('spoken: ctx.spoken ?? ctx.gate?.spoken ?? -1');
});
it("keeps size transitions enabled during the first bubble placement", () => {
 const page=fs.readFileSync(new URL("../../app/okfilow/overlay/page.tsx",import.meta.url),"utf8");
 expect(page).toContain('h.placed && h.answer ? "" : "opacity, width, height"');
});

it("keeps light model labels above 4.5 to 1 text contrast", () => {
 const css=fs.readFileSync(new URL("../../app/okfilow/okfilow.css",import.meta.url),"utf8");
 const colors=/html\[data-theme="light"\] \.okf-part \{ background: (#[a-f0-9]+); color: (#[a-f0-9]+)/.exec(css)!;
 expect(colors).toBeTruthy();
 const lum=(hex:string) => hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[0.2126,0.7152,0.0722][i],0);
 const a=lum(colors[1]),b=lum(colors[2]);expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThan(4.5);
});
