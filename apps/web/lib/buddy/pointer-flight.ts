// One planned quadratic flight for the tip, body and pill. No snapping during flight.
export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type FlightPlan = { from: Point; to: Point; control: Point; dock: Point; width: number; duration: number; overlap: number };
export const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
export function flightPoint(p: FlightPlan, progress: number): Point {
  const k = Math.max(0, Math.min(1, progress));
  const t = 1 - (1 - k) ** 2;
  return { x: (1-t)**2*p.from.x + 2*(1-t)*t*p.control.x + t*t*p.to.x, y: (1-t)**2*p.from.y + 2*(1-t)*t*p.control.y + t*t*p.to.y };
}
export function pointerBoxes(p: Point, dock: Point, width: number): Rect[] {
  return [{ left: p.x-4, top: p.y-4, right: p.x+32, bottom: p.y+32 }, { left: p.x+dock.x-3, top: p.y+dock.y-3, right: p.x+dock.x+width+3, bottom: p.y+dock.y+31 }];
}
export function planFlight(from: Point | null, target: Point, texts: Rect[], view: { width: number; height: number }, width: number): FlightPlan {
  const targets = [{ x: target.x+8, y: target.y+10 }];
  for (const r of texts) if (target.x >= r.left-24 && target.x <= r.right+24 && target.y >= r.top-24 && target.y <= r.bottom+24) {
    targets.push({ x: r.right+8, y: r.bottom+8 }, { x: r.left-40, y: r.bottom+8 }, { x: r.right+8, y: r.top-40 });
  }
  const docks = [{ x: 40, y: 0 }, { x: -width-12, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -40 }];
  let best: FlightPlan | null = null, bestCost = Infinity;
  for (const to of targets) for (const dock of docks) {
    const start = from ?? { x: Math.max(12, to.x-180), y: Math.max(48, to.y-100) };
    for (const lift of [-40, -80, -180, -360, 40, 80, 180, 360]) {
      const control = { x: (start.x+to.x)/2, y: (start.y+to.y)/2+lift };
      const length = Math.hypot(start.x-control.x,start.y-control.y)+Math.hypot(to.x-control.x,to.y-control.y);
      const p: FlightPlan = { from: start, to, control, dock, width, duration: Math.min(12000, Math.max(450, length*2.8)), overlap: 0 };
      for (let i=0;i<=80;i++) for (const b of pointerBoxes(flightPoint(p,i/80),dock,width)) {
        for (const r of texts) p.overlap += overlapArea(b,r);
        if (b.left<4 || b.top<4 || b.right>view.width-4 || b.bottom>view.height-4) p.overlap += 10000;
      }
      const cost = p.overlap*1000 + length + Math.hypot(to.x-target.x,to.y-target.y)*3;
      if (cost<bestCost) { best=p; bestCost=cost; }
    }
  }
  return best!;
}
export function arrivalPhase(elapsed: number, duration: number, reduced = false) {
  const t = (elapsed-duration)/600;
  return { opacity: t>=0 && t<=1 ? (reduced ? 1 : 1-t) : 0, scale: reduced ? 1 : 0.35+Math.max(0,Math.min(1,t))*0.9 };
}
