// One planned quadratic flight for the tip, body and pill. No snapping during flight.
export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type FlightPlan = { from: Point; to: Point; control: Point; dock: Point; width: number; duration: number; overlap: number; targetRect?: Rect };
export const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
export function flightPoint(p: FlightPlan, progress: number): Point {
  const k = Math.max(0, Math.min(1, progress));
  const t = 1 - (1 - k) ** 2;
  return { x: (1-t)**2*p.from.x + 2*(1-t)*t*p.control.x + t*t*p.to.x, y: (1-t)**2*p.from.y + 2*(1-t)*t*p.control.y + t*t*p.to.y };
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
  const docks = [{ x: 40, y: 0 }, { x: -width-12, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -40 }];
  let best: FlightPlan | null = null, bestCost = Infinity;
  for (const to of targets) for (const dock of docks) {
    const start = from ?? { x: Math.max(12, to.x-180), y: Math.max(48, to.y-100) };
    for (const lift of [-40, -80, -180, -360, 40, 80, 180, 360]) for (const bend of [0, 240, 480]) {
      const control = { x: (start.x+to.x)/2+bend, y: (start.y+to.y)/2+lift };
      const length = Math.hypot(start.x-control.x,start.y-control.y)+Math.hypot(to.x-control.x,to.y-control.y);
      const p: FlightPlan = { from: start, to, control, dock, width, duration: Math.min(12000, Math.max(450, length*2.8, Math.hypot(control.x-start.x,control.y-start.y)*5.2)), overlap: 0, targetRect };
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
  return { opacity: t>=0 ? 1 : 0, scale: reduced ? 1 : 0.35+Math.max(0,Math.min(1,t))*0.65 };
}
