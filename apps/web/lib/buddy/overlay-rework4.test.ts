import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import poses from "./leader-poses.fixture.json";
import { measureLeaders, type Pixel } from "./leader-metrics";
import { hookCount, routeLeaders } from "./leader-route";
import { flightPoint, planFlight, arrivalPhase } from "./pointer-flight";

it("measures final polylines, including touching bends, overlaps and opposite columns",()=>{
  const p=(x:number,y:number)=>({x,y});
  expect(measureLeaders([[p(0,0),p(20,20)],[p(0,20),p(20,0)]]).intersections).toBe(1);
  expect(measureLeaders([[p(0,0),p(10,10),p(20,0)],[p(0,10),p(20,10)]]).intersections).toBe(1);
  expect(measureLeaders([[p(0,0),p(20,0)],[p(5,0),p(15,0)]]).intersections).toBe(1);
  expect(measureLeaders([[p(0,0),p(20,0)],[p(0,12),p(20,12)]]).clearance).toBe(12);
});

it("reproduces e7db482 crossings and routes 24 full-turn plus eight sheet poses with fixed anchors and columns, allowing rows to move to avoid hooks",()=>{
  const samples=poses.map(f=>f.lines.map(l=>l.map(([x,y])=>({x,y}))));
  expect(Math.max(...samples.map(p=>measureLeaders(p).intersections))).toBeGreaterThan(0);
  let previous:Pixel[][]|null=null;
  for(const lines of samples) {
    lines.forEach((p,i)=>{p[p.length-1]=samples[0][i].at(-1)!;});
    const routes=routeLeaders(lines,{width:760,height:460},previous);
    // Check the same tenth-pixel quantisation that is written to the SVG, not proposed slots.
    const drawn=routes.map(p=>p.map(q=>({x:+q.x.toFixed(1),y:+q.y.toFixed(1)})));
    const m=measureLeaders(drawn,8);
    expect(m.intersections).toBe(0);
    expect(hookCount(drawn)).toBe(0);
    expect(m.clearance).toBeGreaterThanOrEqual(12);
    routes.forEach((p,i)=>{expect(p[0]).toEqual(lines[i][0]);expect(p.at(-1)!.x).toEqual(samples[0][i].at(-1)!.x);
      expect(samples[0].map(line=>line.at(-1)!.y)).toContain(p.at(-1)!.y);});
    previous=routes;
  }
});

it("flies monotonically with a short path and a gentle first step, including real text blockers",()=>{
  for(const texts of [[],[{left:450,top:250,right:600,bottom:277},{left:420,top:310,right:740,bottom:312}]]) {
    const plan=planFlight({x:80,y:100},{x:500,y:262},texts,{width:1000,height:700},90);
    const ps=Array.from({length:61},(_,i)=>flightPoint(plan,i/60));
    const steps=ps.slice(1).map((p,i)=>Math.hypot(p.x-ps[i].x,p.y-ps[i].y));
    for(let i=1;i<ps.length;i++){expect(ps[i].x-ps[i-1].x).toBeGreaterThanOrEqual(-1);expect(ps[i].y-ps[i-1].y).toBeGreaterThanOrEqual(-1);}
    expect(steps.reduce((a,b)=>a+b,0)/Math.hypot(plan.to.x-plan.from.x,plan.to.y-plan.from.y)).toBeLessThan(1.25);
    expect(steps[0]/Math.max(...steps.slice(1))).toBeLessThanOrEqual(1.25);
    expect(steps[0]/Math.max(...steps.slice(1))).toBeLessThan(0.1);
    expect(plan.duration).toBeLessThanOrEqual(900);expect(plan.overlap).toBe(0);
  }
});

it("cases light leaders and the full-size landing ring with opaque contrast above 4.5 on both surfaces",()=>{
  const css=readFileSync("apps/web/app/okfilow/okfilow.css","utf8");
  const halo=css.match(/light"\] .okf-part-leader .okf-part-halo \{([^}]+)}/)![1];
  const ink=css.match(/light"\] .okf-part-leader .okf-part-ink \{([^}]+)}/)![1];
  expect(halo).toContain("stroke: #08090b");expect(halo).toContain("stroke-width: 4.5");expect(ink).toContain("stroke-width: 2");
  expect(css).toContain("border: 2.5px solid");
  expect(arrivalPhase(500,500).scale*2.5).toBeGreaterThanOrEqual(2);
  expect(css).toContain("box-shadow: 0 0 0 2px #08090b, inset 0 0 0 1.5px #08090b");
  const lum=(hex:string)=>hex.match(/\w\w/g)!.map(n=>parseInt(n,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
  for(const bg of ["ffffff","cbd5e1","eeeeee"]) expect((lum(bg)+.05)/(lum("08090b")+.05)).toBeGreaterThanOrEqual(4.5);
});
