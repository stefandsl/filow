// Reads a synthetic pointing screen (latency-screens.cjs) and says whether a stored target box sits on the
// thing the picture draws: a filled button, or a white text field with a border. Used by latency-screens.test.ts.
export type Box = { name: string; type: string; x1: number; y1: number; x2: number; y2: number };
/** Raw RGB, 3 bytes per pixel. */
export type Picture = { data: Uint8Array; width: number; height: number };

const rgb = (p: Picture, x: number, y: number) => { const i = (y * p.width + x) * 3; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const WHITE = [255, 255, 255];
const pixels = (b: Box, p: Picture) => ({ left: Math.round((b.x1 * p.width) / 1000), right: Math.round((b.x2 * p.width) / 1000), top: Math.round((b.y1 * p.height) / 1000), bottom: Math.round((b.y2 * p.height) / 1000) });
function row(p: Picture, y: number, x0: number, x1: number): number[][] {
  const out: number[][] = [];
  if (y < 0 || y >= p.height) return out;
  for (let x = Math.max(0, x0); x < Math.min(p.width, x1); x++) out.push(rgb(p, x, y));
  return out;
}
const share = (list: number[][], test: (c: number[]) => boolean) => (list.length ? list.filter(test).length / list.length : 0);

/** Why the drawn target is not inside this box, or "" when it is. */
export function notDrawn(b: Box, p: Picture): string {
  const { left, right, top, bottom } = pixels(b, p);
  if (b.type === "button") {
    // a filled button: one colour fills the box, and that colour stops at its edges
    const inside: number[][] = [];
    for (let y = top + 6; y < bottom - 6; y++) inside.push(...row(p, y, left + 6, right - 6));
    const counts = new Map<string, number>();
    for (const c of inside) counts.set(c.join(), (counts.get(c.join()) ?? 0) + 1);
    const [main, n] = [...counts.entries()].sort((a, c) => c[1] - a[1])[0] ?? ["", 0];
    if (!inside.length || n / inside.length < 0.5) return `no single fill inside (${Math.round((100 * n) / Math.max(1, inside.length))}%)`;
    const fill = main.split(",").map(Number);
    for (const [from, to] of [[top - 10, top - 5], [bottom + 5, bottom + 10]]) {
      const band: number[][] = [];
      for (let y = from; y < to; y++) band.push(...row(p, y, left + 6, right - 6));
      const same = share(band, (c) => dist(c, fill) <= 10);
      if (same > 0.2) return `the fill ${main} goes on past the box (${Math.round(100 * same)}% at ${from}..${to})`;
    }
    return "";
  }
  // a text field: white, with a border along its top and bottom edges
  const edge = (from: number, to: number) => Math.max(...Array.from({ length: to - from + 1 }, (_, k) => share(row(p, from + k, left + 8, right - 8), (c) => dist(c, WHITE) > 25)));
  if (edge(top - 2, top + 2) < 0.8) return `no border along the top edge (${Math.round(100 * edge(top - 2, top + 2))}%)`;
  if (edge(bottom - 3, bottom + 1) < 0.8) return `no border along the bottom edge (${Math.round(100 * edge(bottom - 3, bottom + 1))}%)`;
  // the field's own padding, left of its text, is white
  const middle = share(row(p, Math.round((top + bottom) / 2), left + 3, left + 8), (c) => dist(c, WHITE) <= 10);
  return middle < 0.8 ? "not white inside" : "";
}
