import type { Pixel } from "./leader-metrics";

export const LEADER_EASE_MS = 160;

/** Equal arc-length samples let routes with different bend counts blend continuously. */
export function sampleLeader(path: Pixel[], count = 65): Pixel[] {
  const distances = [0];
  for (let i=1; i<path.length; i++) distances.push(distances[i-1]+Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y));
  return Array.from({length:count}, (_,k) => {
    const d=distances[distances.length-1]*k/(count-1);
    let i=1; while(i<path.length-1 && distances[i]<d) i++;
    const t=(d-distances[i-1])/(distances[i]-distances[i-1] || 1);
    return {x:path[i-1].x+(path[i].x-path[i-1].x)*t,y:path[i-1].y+(path[i].y-path[i-1].y)*t};
  });
}

export function routeChange(a: Pixel[][], b: Pixel[][]): number {
  return Math.max(0,...a.flatMap((path,i) => {
    const next=sampleLeader(b[i]), before=sampleLeader(path);
    return before.map((p,k)=>Math.hypot(p.x-next[k].x,p.y-next[k].y));
  }));
}

export function createLeaderMotion() {
  let from: Pixel[][] | null = null, target: Pixel[][] = [], start = 0;
  const at = (now:number) => {
    const k=Math.min(1,Math.max(0,(now-start)/LEADER_EASE_MS)), t=k*k*(3-2*k);
    if(k===0) return from!;
    if(k===1) return target;
    return from!.map((path,i) => {
      const a=sampleLeader(path), b=sampleLeader(target[i]);
      return a.map((p,j)=>({x:p.x+(b[j].x-p.x)*t,y:p.y+(b[j].y-p.y)*t}));
    });
  };
  return (next:Pixel[][], now:number):Pixel[][] => {
    if(!from) { from=target=next; start=now-LEADER_EASE_MS; return next; }
    const current=at(now), change=routeChange(target,next);
    if(change>16 || (now-start>=LEADER_EASE_MS && change>0.1)) { from=current; start=now; }
    target=next;
    return at(now);
  };
}
