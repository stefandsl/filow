import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { planFlight, arrivalPhase } from "./pointer-flight";
import { visibleSurfaceAnchor, projectedSurface, edgeMargin } from "./model-surface";
import { layoutPartLabels, leadersCross } from "./model-labels";
import { placePoint } from "./ground";
import { elementRects, avoidRects, localRects } from "./snap";
import { pointToDisplay } from "./prompt";

it("preserves the real grounding, display mapping and avoidance path to the renderer", () => {
  const elements=[{screen:2,name:"Settings",x1:450,y1:350,x2:600,y2:390}];
  const bounds={x:-1000,y:180,width:1000,height:700};
  const displays=[{index:2,bounds}];
  const grounded=placePoint("Settings",null,elements,2)!;
  const mapped=pointToDisplay({...grounded,label:"Settings",screen:2},bounds);
  const rects=localRects(avoidRects(elementRects(elements,displays),displays),bounds);
  const p=planFlight({x:80,y:80},{x:mapped.x-bounds.x,y:mapped.y-bounds.y},rects,{width:1000,height:700},100);
  expect(p.targetRect).toEqual(rects[0]);
  expect(p.to).toEqual({x:rects[0].right,y:rects[0].bottom});
  expect(p.overlap).toBe(0);
});

it("lands on the grounded target corner, including translated display coordinates", () => {
  for(const offset of [0,180]) {
    const r={left:450-offset,top:250,right:600-offset,bottom:276};
    const p=planFlight({x:80,y:100},{x:500-offset,y:262},[r],{width:1000,height:700},100);
    expect(p.to).toEqual({x:r.right,y:r.bottom});
    expect(p.targetRect).toEqual(r);
    expect(p.overlap).toBe(0);
  }
});
it("keeps the landing ring opaque and above 3:1 in both themes", () => {
  const css=readFileSync("apps/web/app/okfilow/okfilow.css","utf8");
  const luminance=(hex:string) => {
    const rgb=hex.match(/\w\w/g)!.map(n=>parseInt(n,16)/255).map(c=>c<=0.04045?c/12.92:((c+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const dark=/border: 2.5px solid #(\w{6})/.exec(css)![1];
  const light=/light"\] .okf-arrival \{ border-color: #(\w{6})/.exec(css)![1];
  for(const [ink,bg] of [[dark,"14161a"],[light,"f7f7f8"]]) {
    const a=luminance(ink),b=luminance(bg);
    expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(3);
  }
  expect(arrivalPhase(2100,500).opacity).toBe(1);
});
it("keeps an anchor inside the visible silhouette through sampled rotation", () => {
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.4,40),new THREE.MeshBasicMaterial());
  mesh.rotation.z=Math.PI/2; mesh.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(35,760/460,.05,200);
  for(let i=0;i<12;i++) {
    camera.position.set(5*Math.cos(i/12*Math.PI*2),3.2,6*Math.sin(i/12*Math.PI*2));
    camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
    const s=visibleSurfaceAnchor(mesh,[mesh],camera,760,460);
    const p=mesh.localToWorld(s.anchor.clone()).project(camera);
    expect(edgeMargin({x:(p.x+1)*380,y:(1-p.y)*230},projectedSurface(mesh,camera,760,460))).toBeGreaterThan(6);
    expect(s.margin).toBeGreaterThan(6);
  }
});
it("gives a compressed outlet the same generous lanes as the inlet", () => {
  const pts=[{x:280,y:180},{x:300,y:181},{x:320,y:182},{x:430,y:220},{x:460,y:221},{x:490,y:222}];
  const slots=layoutPartLabels(pts,pts.map(()=>({width:110,height:28})),{width:760,height:460},380);
  expect(leadersCross(slots)).toBe(false);
  for(const side of ["left","right"]) {
    const ys=slots.filter(s=>s.side===side).map(s=>s.knee.y).sort((a,b)=>a-b);
    expect(Math.min(...ys.slice(1).map((y,i)=>y-ys[i]))).toBeGreaterThanOrEqual(28);
  }
});
it("keeps lane preference away from the engine's neighbouring colour boundaries", () => {
  const specs = [
    [new THREE.CylinderGeometry(.8,.8,.25,40),-1.6,90],
    [new THREE.ConeGeometry(.65,1.2,40),-.7,90],
    [new THREE.CylinderGeometry(.5,.5,1,40),.3,90],
    [new THREE.CylinderGeometry(.55,.55,.4,40),1.1,90],
    [new THREE.ConeGeometry(.45,.9,40),1.8,-90],
    [new THREE.CylinderGeometry(.95,.95,4.2,40),0,90],
  ] as const;
  const meshes=specs.map(([geometry,x,angle],i)=>{
    const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());m.position.x=x;m.rotation.z=angle*Math.PI/180;
    m.userData.shell=i===5;m.updateMatrixWorld(true);return m;
  });
  const camera=new THREE.PerspectiveCamera(35,760/460,.05,200);
  for(let i=0;i<8;i++) {
    camera.position.set(6.25,4,7.5).applyAxisAngle(new THREE.Vector3(0,1,0),-i*.015);
    camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    meshes.forEach((mesh,k)=>{
      const s=visibleSurfaceAnchor(mesh,meshes,camera,760,460,[.5,.75,.25][k%3]);
      expect(s.margin,`part ${k}, sample ${i}`).toBeGreaterThanOrEqual(6);
    });
  }
});
it("uses an opaque tinted light stage with no transparent corner cutouts or cloudy shadow", () => {
  const css=readFileSync("apps/web/app/okfilow/okfilow.css","utf8");
  expect(css).toContain('background: #cbd5e1; color: #18191c');
  expect(css).toContain('background: rgb(16, 17, 20); border-radius: 0;');
  expect(css).toContain('drop-shadow(0 3px 4px rgba(0, 0, 0, 0.22))');
});
