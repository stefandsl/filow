// One distance-paced flight for the tip, body and pill, with a straight final approach.
export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type FlightPlan = { from: Point; to: Point; control: Point; dock: Point; width: number; duration: number; overlap: number; targetRect?: Rect; approach?: Point; underline?: boolean; samples?: Point[]; distances?: number[] };
export const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
function rawPoint(p: FlightPlan, progress: number): Point {
  const k = Math.max(0, Math.min(1, progress));
  const progressOut = k;
  if (p.approach) {
    // Finish on a straight vertical approach. The curve joins it with a vertical tangent.
    const split = 0.7;
    if (progressOut >= split) {
      const t = (progressOut - split) / (1 - split);
      return { x: p.to.x, y: p.approach.y + (p.to.y - p.approach.y) * t };
    }
    const t = progressOut / split;
    return { x: (1-t)**2*p.from.x + (2*(1-t)*t+t*t)*p.to.x,
      y: (1-t)**2*p.from.y + 2*(1-t)*t*p.from.y + t*t*p.approach.y };
  }
  const t = progressOut;
  return { x: (1-t)**2*p.from.x + 2*(1-t)*t*p.control.x + t*t*p.to.x, y: (1-t)**2*p.from.y + 2*(1-t)*t*p.control.y + t*t*p.to.y };
}
export function flightPoint(p: FlightPlan, progress: number): Point {
  const k = Math.max(0,Math.min(1,progress));
  // A short acceleration/deceleration ramp avoids the high middle speed of
  // smoothstep, while position and velocity stay continuous at both joins.
  const ramp = 0.15;
  const t = k < ramp ? k*k/(2*ramp*(1-ramp))
    : k > 1-ramp ? 1-(1-k)**2/(2*ramp*(1-ramp))
    : (k-ramp/2)/(1-ramp);
  if (!p.samples || !p.distances) return rawPoint(p,t);
  const distance = t*p.distances[p.distances.length-1];
  let i=1; while(i<p.distances.length-1 && p.distances[i]<distance) i++;
  const a=p.samples[i-1], b=p.samples[i];
  const f=(distance-p.distances[i-1])/(p.distances[i]-p.distances[i-1] || 1);
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
export function pointerBoxes(p: Point, dock: Point, width: number): Rect[] {
  return [{ left: p.x, top: p.y, right: p.x+32, bottom: p.y+32 }, { left: p.x+dock.x-3, top: p.y+dock.y-3, right: p.x+dock.x+width+3, bottom: p.y+dock.y+31 }];
}
export function planFlight(from: Point | null, target: Point, texts: Rect[], view: { width: number; height: number }, width: number): FlightPlan {
  // The point supplied by grounding is inside its UIA element. Use its bottom-right
  // corner: the up-left glyph extends away from the text, while its hotspot stays on target.
  const targetRect = texts.filter(r => target.x >= r.left && target.x <= r.right && target.y >= r.top && target.y <= r.bottom)
    .sort((a,b) => (a.right-a.left)*(a.bottom-a.top)-(b.right-b.left)*(b.bottom-b.top))[0];
  const targets = [targetRect ? { x: targetRect.right, y: targetRect.bottom } : target];
  const docks = [{ x: 40, y: -12 }, { x: 40, y: 0 }, { x: -width-12, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -40 }];
  let best: FlightPlan | null = null, bestCost = Infinity;
  for (const to of targets) for (const dock of docks) {
    const start = from ?? { x: Math.max(12, to.x-180), y: Math.max(48, to.y-100) };
    for (const lift of [0, 0.25, 0.5, 0.75, 1]) for (const bend of [0]) {
      const control = { x: (start.x+to.x)/2+bend, y: (start.y+to.y)/2+lift };
      const length = Math.hypot(start.x-control.x,start.y-control.y)+Math.hypot(to.x-control.x,to.y-control.y);
      const p: FlightPlan = { from: start, to, control, dock, width, duration: Math.min(900, Math.max(450, 400 + Math.hypot(to.x-start.x,to.y-start.y)*0.4)), overlap: 0, targetRect,
        approach: { x: to.x, y: start.y + (to.y-start.y)*lift },
        underline: !targetRect || !texts.some(r => r !== targetRect && r.bottom-r.top <= 6 && r.left < targetRect.right && r.right > targetRect.left && Math.abs(r.top-targetRect.bottom) <= 6) };
      p.samples = Array.from({length:101},(_,i)=>rawPoint(p,i/100));
      p.distances = [0];
      for(let i=1;i<p.samples.length;i++) p.distances.push(p.distances[i-1]+Math.hypot(p.samples[i].x-p.samples[i-1].x,p.samples[i].y-p.samples[i-1].y));
      // At 60 Hz even the fastest frame stays below 4% of endpoint distance.
      const direct = Math.hypot(to.x-start.x,to.y-start.y) || 1;
      p.duration = Math.max(p.duration, 600, Math.ceil(510*p.distances[p.distances.length-1]/direct));
      const pill = pointerBoxes(to,dock,width)[1];
      const exclusion = {left:pill.left-8,top:pill.top-8,right:pill.right+8,bottom:pill.bottom+8};
      const clearanceCost = texts.reduce((sum,r)=>sum+overlapArea(exclusion,r),0);
      for (let i=0;i<=80;i++) for (const b of pointerBoxes(flightPoint(p,i/80),dock,width)) {
        for (const r of texts) p.overlap += overlapArea(b,r);
        if (b.left<4 || b.top<4 || b.right>view.width-4 || b.bottom>view.height-4) p.overlap += 10000;
      }
      const cost = p.overlap*1000 + clearanceCost*100000 + p.distances[p.distances.length-1] + length*0.001 + Math.hypot(to.x-target.x,to.y-target.y)*3;
      if (cost<bestCost) { best=p; bestCost=cost; }
    }
  }
  return best!;
}
export function arrivalPhase(elapsed: number, duration: number, reduced = false) {
  const t = (elapsed-duration)/600;
  return { opacity: t>=0 ? 1 : 0, scale: reduced ? 1 : 1+Math.max(0,Math.min(1,t))*0.15 };
}
