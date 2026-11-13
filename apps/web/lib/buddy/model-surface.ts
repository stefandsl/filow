import * as THREE from "three";
type P = { x: number; y: number };
function hull(points: P[]): P[] {
  const sorted = points.sort((a,b) => a.x-b.x || a.y-b.y);
  const cross = (a:P,b:P,c:P) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half = (ps:P[]) => { const out:P[]=[]; for(const p of ps) { while(out.length>1 && cross(out[out.length-2],out[out.length-1],p)<=0) out.pop(); out.push(p); } return out; };
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}
export function projectedSurface(mesh: THREE.Mesh, camera: THREE.Camera, width: number, height: number): P[] {
  const pos=mesh.geometry.attributes.position, v=new THREE.Vector3(), points:P[]=[];
  for(let i=0;i<pos.count;i++) { v.fromBufferAttribute(pos,i); mesh.localToWorld(v).project(camera); points.push({x:(v.x+1)*width/2,y:(1-v.y)*height/2}); }
  return hull(points);
}
export function edgeMargin(p:P, polygon:P[]): number {
  return Math.min(...polygon.map((a,i) => {
    const b=polygon[(i+1)%polygon.length], dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }));
}
/** Pick the centre of the largest sampled visible patch, excluding opaque neighbours.
 * Margins are screen pixels and include neighbouring colour boundaries, not just the part's box. */
export function visibleSurfaceAnchor(mesh:THREE.Mesh, meshes:THREE.Mesh[], camera:THREE.Camera, width:number, height:number, vertical = 0.5): { anchor:THREE.Vector3; margin:number } {
  const polygon=projectedSurface(mesh,camera,width,height);
  const xs=polygon.map(p=>p.x), ys=polygon.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const others=meshes.filter(m=>m!==mesh && !m.userData.shell);
  const boundaries=others.map(m=>projectedSurface(m,camera,width,height));
  const ray=new THREE.Raycaster();
  let best=-Infinity, margin=0, anchor=surfaceAnchor(mesh,camera);
  const preferred=mesh.localToWorld(anchor.clone()).project(camera);
  const preferredX=(preferred.x+1)*width/2;
  for(let iy=1;iy<8;iy++) for(let ix=1;ix<8;ix++) {
    const p={x:left+(right-left)*ix/8,y:top+(bottom-top)*iy/8};
    // A transparent casing must identify its upper shell, clear of the inner machinery.
    if(mesh.userData.shell && iy>2) continue;
    const own=edgeMargin(p,polygon);
    ray.setFromCamera(new THREE.Vector2(p.x/width*2-1,1-p.y/height*2),camera);
    const hit=ray.intersectObject(mesh,false)[0];
    if(!hit) continue;
    const front=ray.intersectObjects(others,false)[0];
    if(front && front.distance<hit.distance-0.0001) continue;
    const clearance=Math.min(own,...boundaries.map(b=>edgeMargin(p,b)));
    // Never trade a safe patch for lane preference. Tiny parts use their best available patch.
    const score=clearance < 8 ? clearance-1000000 : clearance - (mesh.userData.shell ? Math.abs(p.x-preferredX)*0.6 : Math.abs(p.y-(top+(bottom-top)*vertical))*0.9);
    if(score>best) { best=score; margin=clearance; anchor=mesh.worldToLocal(hit.point.clone()); }
  }
  return {anchor,margin};
}
/** A ray from the viewer meets the actual geometry, including an open or transparent shell. */
export function surfaceAnchor(mesh: THREE.Mesh, camera: THREE.Camera): THREE.Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const centre = mesh.localToWorld(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
  if (mesh.userData.shell) {
    // A transparent front projects over the inner machinery. Choose the upper shell instead,
    // so its label reads as casing even when the surface itself is see-through.
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    centre.addScaledVector(up, Math.min(size.x, size.y, size.z) * 0.35);
  }
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(eye, centre.clone().sub(eye).normalize());
  const hit = ray.intersectObject(mesh, false)[0];
  return hit ? mesh.worldToLocal(hit.point.clone()) : mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
}
