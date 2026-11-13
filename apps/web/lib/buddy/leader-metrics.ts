// Geometry measured in final overlay pixels, after projection and animation.
export type Pixel = { x: number; y: number };
const cross = (a: Pixel, b: Pixel, c: Pixel) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const pointDistance = (p: Pixel, a: Pixel, b: Pixel) => {
  const dx=b.x-a.x, dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
export function segmentDistance(a: Pixel,b: Pixel,c: Pixel,d: Pixel): number {
  if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) return 0;
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
/** Portions outside the anchor discs. Intersections are still checked on the complete lines. */
export function outsideAnchors(a:Pixel,b:Pixel,anchors:Pixel[],radius:number): Array<[Pixel,Pixel]> {
  let ranges:Array<[number,number]>=[[0,1]];
  const dx=b.x-a.x,dy=b.y-a.y,A=dx*dx+dy*dy;
  if(A<1e-12)return [];
  for(const p of anchors) {
    const B=2*((a.x-p.x)*dx+(a.y-p.y)*dy),C=(a.x-p.x)**2+(a.y-p.y)**2-radius*radius,D=B*B-4*A*C;
    if(D<=0)continue;
    const lo=(-B-Math.sqrt(D))/(2*A),hi=(-B+Math.sqrt(D))/(2*A);
    ranges=ranges.flatMap(([l,h])=>hi<=l||lo>=h?[[l,h]]:([...(lo>l?[[l,lo]]:[]),...(hi<h?[[hi,h]]:[])] as Array<[number,number]>));
  }
  const at=(t:number)=>({x:a.x+dx*t,y:a.y+dy*t});
  return ranges.map(([l,h])=>[at(l),at(h)]);
}
/** All pairs, including opposite columns, touching endpoints and shared segments. */
export function measureLeaders(lines: Pixel[][], anchorRadius=0): { intersections: number; clearance: number } {
  let intersections=0, clearance=Infinity;
  for(let i=0;i<lines.length;i++) for(let j=i+1;j<lines.length;j++) {
    let distance=Infinity, gap=Infinity;
    for(let a=1;a<lines[i].length;a++) for(let b=1;b<lines[j].length;b++) {
      distance=Math.min(distance,segmentDistance(lines[i][a-1],lines[i][a],lines[j][b-1],lines[j][b]));
      const anchors=[lines[i][0],lines[j][0]];
      for(const [p,q] of outsideAnchors(lines[i][a-1],lines[i][a],anchors,anchorRadius)) for(const [r,s] of outsideAnchors(lines[j][b-1],lines[j][b],anchors,anchorRadius)) gap=Math.min(gap,segmentDistance(p,q,r,s));
    }
    if(distance<1e-6) intersections++;
    clearance=Math.min(clearance,anchorRadius?gap:distance);
  }
  return {intersections,clearance};
}
