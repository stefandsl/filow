import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planFlight, flightPoint, pointerBoxes, overlapArea } from "./pointer-flight";
import { layoutPartLabels, retainLabelOrder, readingOrder, type LabelSide } from "./model-labels";
const view={width:1000,height:700};
const texts=[{left:450,top:250,right:600,bottom:277},{left:420,top:310,right:740,bottom:312}];
it("freezes identity across rotations and renderer number updates",()=>{
 let sides:LabelSide[]|null=null; let numbers:number[]|null=null; let identities:string[]=[];
 for(let frame=0;frame<32;frame++) {
  const a=Array.from({length:6},(_,i)=>({x:380+150*Math.cos(i+frame*.3),y:200+80*Math.sin(i+frame*.3)}));
  const slots=layoutPartLabels(a,a.map(()=>({width:100,height:28})),{width:760,height:460},380,sides);
  sides=slots.map(s=>s.side);numbers??=readingOrder(slots);
  const now=sides.map((s,i)=>s+numbers![i]);if(!frame)identities=now;expect(now).toEqual(identities);
 }
 const source=readFileSync("apps/web/app/okfilow/model/page.tsx","utf8");
 expect(source).toContain("numbers ??= readingOrder(slots)");
});
it("caps every flight and gives typical distances a quick flight",()=>{
 for(const x of [20,500,2000,100000]) {
  const p=planFlight({x:20,y:50},{x,y:300},[],{width:200000,height:1000},100);
  expect(p.duration).toBeLessThanOrEqual(900);expect(p.duration).toBeGreaterThanOrEqual(450);
 }
 expect(planFlight({x:80,y:100},{x:500,y:262},texts,view,100).duration).toBeLessThanOrEqual(700);
});
it("lands clear and never backtracks on the final approach",()=>{
 const p=planFlight({x:80,y:100},{x:500,y:262},texts,view,100);
 const pill=pointerBoxes(p.to,p.dock,p.width)[1];
 for(const r of texts) expect(overlapArea({left:pill.left-8,top:pill.top-8,right:pill.right+8,bottom:pill.bottom+8},r)).toBe(0);
 let prev=flightPoint(p,.7),backtrack=0;
 for(let i=701;i<=1000;i++){const q=flightPoint(p,i/1000);backtrack+=Math.max(0,prev.x-q.x)+Math.max(0,prev.y-q.y);prev=q;}
 expect(backtrack).toBeLessThan(1);
 for(const top of [290,300,305,315,320]) {
  const obstacles=[texts[0],{left:420,top,right:740,bottom:top+2}];
  const q=planFlight({x:80,y:100},{x:500,y:262},obstacles,view,100);
  const b=pointerBoxes(q.to,q.dock,q.width)[1];
  for(const r of obstacles) expect(overlapArea({left:b.left-8,top:b.top-8,right:b.right+8,bottom:b.bottom+8},r)).toBe(0);
 }
 const divider={left:420,top:280,right:740,bottom:282};
 expect(planFlight(null,{x:500,y:262},[texts[0],divider],view,100).underline).toBe(false);
});
it("gives light arrival accents at least 4.5 contrast and the arrow outline weight",()=>{
 const css=readFileSync("apps/web/app/okfilow/okfilow.css","utf8");
 const lum=(hex:string)=>hex.match(/\w\w/g)!.map(n=>parseInt(n,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
 for(const selector of ['okf-arrival','okf-point-target']) {
  const rule=css.match(new RegExp('light"\\] \\.'+selector+' \\{([^}]+)'))![1];
  const ink=rule.match(/border-color: #(\w{6})/)![1];
  expect(1.05/(lum(ink)+.05)).toBeGreaterThanOrEqual(4.5);
  expect(rule).toContain('1.5px');expect(rule).toContain('#08090b');
 }
});

it("holds label rows while only the anchor and clear leader route move",()=>{
 const size=[{width:100,height:28}], view={width:760,height:460};
 const first=layoutPartLabels([{x:250,y:150}],size,view,380);
 const moved=layoutPartLabels([{x:320,y:300}],size,view,380,["left"]);
 const held=retainLabelOrder(moved,first);
 expect(held[0].y).toBe(first[0].y);
 expect(held[0].from).toEqual({x:320,y:300});
});
