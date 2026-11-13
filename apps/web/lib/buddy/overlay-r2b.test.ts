import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { planFlight, flightPoint, pointerBoxes, overlapArea, arrivalPhase } from "./pointer-flight";
import { surfaceAnchor } from "./model-surface";
import { layoutPartLabels, leadersCross, slotsOverlap } from "./model-labels";
import { drawingStarts, marksReleased } from "./marks-sync";
import { marksBegun } from "./motion";
import { placeLabels } from "./marks";
import type { BuddyMark } from "./prompt";

describe("round 2B motion contracts", () => {
  const texts = [{ left: 450, top: 250, right: 600, bottom: 276 }, { left: 420, top: 310, right: 740, bottom: 312 }];
  const plan = () => planFlight({ x: 80, y: 100 }, { x: 500, y: 262 }, texts, { width: 1000, height: 700 }, 100);
  it("has in-between positions, no row jump and an exact endpoint", () => {
    const p = plan(); let prev=flightPoint(p,0); let steps=0;
    for(let t=16.7;t<p.duration;t+=16.7) {
      const next=flightPoint(p,t/p.duration);
      expect(Math.hypot(next.x-prev.x,next.y-prev.y)).toBeLessThan(14); prev=next; steps++;
    }
    expect(steps).toBeGreaterThan(20);
    expect(Math.abs((p.to.x-p.from.x)*(p.control.y-p.from.y)-(p.to.y-p.from.y)*(p.control.x-p.from.x))).toBeGreaterThan(1);
    expect(flightPoint(p,1)).toEqual(p.to);
  });
  it("keeps the whole pointer body and docked pill off glyphs and dividers", () => {
    const p=plan();
    for(let i=0;i<=200;i++) for(const b of pointerBoxes(flightPoint(p,i/200),p.dock,p.width)) for(const r of texts) expect(overlapArea(b,r)).toBe(0);
  });
  it("reports a blocked flight when no clear space exists instead of claiming clearance", () => {
    const p=planFlight({x:80,y:100},{x:500,y:262},[{left:0,top:0,right:1000,bottom:700}],{width:1000,height:700},100);
    expect(p.overlap).toBeGreaterThan(0);
  });
  it("uses the flight clock for the arrival, including pause and reduced motion", () => {
    expect(arrivalPhase(499,500).opacity).toBe(0);
    expect(arrivalPhase(500,500).opacity).toBe(1);
    expect(arrivalPhase(800,500).opacity).toBe(1);
    expect(arrivalPhase(800,500,true)).toEqual({opacity:1,scale:1});
    expect(arrivalPhase(1101,500).opacity).toBe(1);
  });
  it("anchors the casing on its visible shell, never its axis", () => {
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(2,2,5,64),new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(); const camera=new THREE.PerspectiveCamera(); camera.position.set(6,0,10); camera.lookAt(0,0,0); camera.updateMatrixWorld();
    const a=surfaceAnchor(mesh,camera);
    expect(Math.hypot(a.x,a.z)).toBeCloseTo(2,2);
    expect(a.z).toBeGreaterThan(0);
    mesh.userData.shell=true;
    const shell=surfaceAnchor(mesh,camera);
    expect(shell.y).toBeGreaterThan(1);
    expect(Math.hypot(shell.x,shell.z)).toBeCloseTo(2,2);
  });
  it("gives nearly coincident engine leaders distinct lanes without crossings", () => {
    const anchors=Array.from({length:6},(_,i)=>({x:280+i*23,y:220+i*.01}));
    const slots=layoutPartLabels(anchors,anchors.map(()=>({width:110,height:28})),{width:760,height:460},380);
    expect(leadersCross(slots)).toBe(false); expect(slotsOverlap(slots)).toBe(false);
    for(const side of ["left","right"]) {
      const ys=slots.filter(s=>s.side===side).map(s=>s.knee.y).sort((a,b)=>a-b);
      for(let i=1;i<ys.length;i++) expect(ys[i]-ys[i-1]).toBeGreaterThanOrEqual(12-1e-8);
    }
  });
  it("appends marks without restarting the first stroke and releases trailing marks", () => {
    const a: BuddyMark={kind:"circle",x:100,y:100,r:20,label:"A",screen:1};
    const b={...a,x:300,label:"B"};
    const old=drawingStarts(null,[a],100);
    const next=drawingStarts({list:[a],starts:old.starts},[a,b],1100);
    expect(next).toEqual({grew:true,starts:[100,1100]});
    expect(marksBegun(next.starts,1099)).toBe(1);
    expect(marksReleased([0,2],Infinity)).toBe(2);
    const first=placeLabels([a],[{width:70,height:30}],{width:800,height:600});
    first[0] = { ...first[0]!, x: 600 };
    const more=placeLabels([a,b],[{width:70,height:30},{width:70,height:30}],{width:800,height:600},[],18,8,{keep:first,texts:[{left:250,top:30,right:450,bottom:100}]});
    expect(more[0]).toEqual(first[0]);
  });
});
