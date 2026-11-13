import { segmentDistance, measureLeaders, outsideAnchors, type Pixel } from "./leader-metrics";

const distance=(a:Pixel,b:Pixel)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Route elbows around already reserved screen-space corridors. Identity and columns never change. */
export function routeLeaders(lines: Pixel[][], view:{width:number;height:number}, previous:Pixel[][]|null=null): Pixel[][] {
  if(previous?.length===lines.length) {
    const carried=previous.map((p,i)=>[lines[i][0],...p.slice(1,-1),lines[i][lines[i].length-1]]);
    const m=measureLeaders(carried,8);
    if(!m.intersections && m.clearance>=13)return carried;
  }
  if(measureLeaders(lines,8).clearance>=14 && !measureLeaders(lines).intersections) return lines;
  const step=8, cols=Math.floor(view.width/step), rows=Math.floor(view.height/step);
  const point=(id:number)=>({x:(id%cols)*step+4,y:Math.floor(id/cols)*step+4});
  const ends=lines.map(p=>p[p.length-1]), starts=lines.map(p=>p[0]);
  const order=lines.map((_,i)=>i).sort((a,b)=>distance(starts[a],ends[a])-distance(starts[b],ends[b]));
  let best=lines, bestScore=-Infinity;
  for(let attempt=0;attempt<12;attempt++) {
    const ids=attempt<6?order.slice(attempt).concat(order.slice(0,attempt)):order.slice().reverse().slice(attempt-6).concat(order.slice().reverse().slice(0,attempt-6));
    const routed:Pixel[][]=Array.from({length:lines.length},()=>[]);
    let failed=false;
    for(const id of ids) {
      const start=starts[id], end=ends[id];
      const obstacles=routed.flatMap(p=>p.slice(1).map((q,i)=>[p[i],q,p[0]]));
      const clear=(a:Pixel,b:Pixel) => {
        for(const [c,d,anchor] of obstacles) {
          if(segmentDistance(a,b,c,d)<0.2) return false;
          const anchors=[start,anchor];
          for(const [p,q] of outsideAnchors(a,b,anchors,8)) for(const [r,s] of outsideAnchors(c,d,anchors,8)) if(segmentDistance(p,q,r,s)<14) return false;
        }
        // Reserve exits for the remaining anchors and label endpoints.
        for(let j=0;j<lines.length;j++) if(j!==id && !routed[j].length) {
          if(distance(start,starts[j])>=28 && segmentDistance(a,b,starts[j],starts[j])<14) return false;
          if(segmentDistance(a,b,ends[j],ends[j])<14) return false;
        }
        return true;
      };
      const costs=new Float64Array(cols*rows).fill(Infinity), parent=new Int32Array(cols*rows).fill(-1);
      const heap:Array<[number,number]>=[];
      const push=(item:[number,number])=>{let k=heap.length;heap.push(item);while(k){const p=(k-1)>>1;if(heap[p][0]<=item[0])break;heap[k]=heap[p];k=p;}heap[k]=item;};
      const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[k]=heap[c];k=c;}heap[k]=last;}return first;};
      for(let y=Math.max(0,Math.floor(start.y/step)-3);y<Math.min(rows,Math.floor(start.y/step)+4);y++) for(let x=Math.max(0,Math.floor(start.x/step)-3);x<Math.min(cols,Math.floor(start.x/step)+4);x++) {
        const k=y*cols+x,p=point(k);if(clear(start,p)){costs[k]=distance(start,p);push([costs[k]+distance(p,end),k]);}
      }
      let found=-1;
      const closed=new Uint8Array(cols*rows);
      while(heap.length) {
        const [,k]=pop();if(closed[k])continue;closed[k]=1;
        const p=point(k);
        if(distance(p,end)<32&&clear(p,end)){found=k;break;}
        const x=k%cols,y=Math.floor(k/cols);
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx=x+dx,ny=y+dy;if(nx<0||nx>=cols||ny<0||ny>=rows)continue;
          const next=ny*cols+nx,q=point(next),cost=costs[k]+distance(p,q);
          if(cost>=costs[next]||!clear(p,q))continue;
          costs[next]=cost;parent[next]=k;push([cost+distance(q,end),next]);
        }
      }
      if(found<0){failed=true;break;}
      const path=[end];for(let k=found;k>=0;k=parent[k])path.push(point(k));path.push(start);path.reverse();
      const simple=[start];let k=0;
      while(k<path.length-1){let j=path.length-1;while(j>k+1&&!clear(path[k],path[j]))j--;simple.push(path[j]);k=j;}
      routed[id]=simple;
    }
    if(!failed) {
      const m=measureLeaders(routed,8);const score=m.clearance-m.intersections*10000;
      if(score>bestScore){best=routed;bestScore=score;}
      if(m.intersections===0 && m.clearance>=12.2)return routed;
    }
  }
  return best;
}

