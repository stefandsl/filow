import { it, expect } from "vitest";
import { createRequire } from "node:module";
const { overlayRects } = createRequire(import.meta.url)("./okfilow-rects.js");
it("clips display membership and translates valid rectangles without accepting malformed IPC data", () => {
  const b={x:1920,y:-200,width:1280,height:800};
  expect(overlayRects([{left:2000,top:-100,right:2100,bottom:-80},{left:0,top:0,right:200,bottom:20},{left:NaN,top:0,right:2200,bottom:20}],b)).toEqual([{left:80,top:100,right:180,bottom:120}]);
  expect(overlayRects(null,b)).toEqual([]);
});

it("preload listeners forward the avoidance rectangles and can unsubscribe", async () => {
  const fs=await import("node:fs"), vm=await import("node:vm");
  let bridge: { onDraw: (fn:(...args: unknown[])=>void)=>()=>void };
  const handlers=new Map<string,(...args: unknown[])=>void>();
  vm.runInNewContext(fs.readFileSync(new URL("./okfilow-preload.js",import.meta.url),"utf8"), { process: { env: {} }, require: () => ({ contextBridge:{ exposeInMainWorld: (_:string,b:typeof bridge)=>{bridge=b;} }, ipcRenderer:{ on:(n:string,h:(...args: unknown[])=>void)=>handlers.set(n,h), removeListener:(n:string)=>handlers.delete(n) } }) });
  let args: unknown[]=[]; const off=bridge!.onDraw((...v)=>{args=v;});
  handlers.get("okfilow:draw")!({},["mark"],["avoid"]);
  expect(args).toEqual([["mark"],["avoid"]]); off(); expect(handlers.has("okfilow:draw")).toBe(false);
});
