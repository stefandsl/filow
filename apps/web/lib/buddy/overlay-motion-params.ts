// Tunable constants for the overlay pointer flight and the model leader routes, in one place so the
// AR-2 autoresearch loop has one editable file (tools/autoresearch/program.md). Values are those of
// overlay round 2B; overlay-motion-params.test.ts pins them until a kept experiment changes them.

export const POINTER = {
  /** Share of the flight spent on the curve before the straight vertical final approach. */
  approachSplit: 0.7,
  /** Acceleration and deceleration ramp, as a share of the flight. */
  ramp: 0.15,
  /** Flight time: base + distance * perPx, clamped to [min, max] ms. */
  baseMs: 400,
  perPxMs: 0.4,
  minMs: 450,
  maxMs: 900,
  /** Distance pacing: never shorter than floorMs, and pacedMs per unit of path/straight ratio. */
  floorMs: 600,
  pacedMs: 510,
  /** Label pill docks: reach from the tip, and the gap when the pill sits on the left or above. */
  dockReach: 40,
  dockGap: 12,
  /** Lift of the curve's turning point, as a share of the vertical distance. */
  lifts: [0, 0.25, 0.5, 0.75, 1],
  /** Clear space kept around the landed pill, and from the window edge. */
  pillClearPx: 8,
  edgePx: 4,
  /** Cost weights: overlap with text, crowding of the landed pill, path length, curve length, target offset. */
  overlapWeight: 1000,
  clearanceWeight: 100000,
  lengthWeight: 0.001,
  targetWeight: 3,
  /** Arrival ring: time to grow, and how much it grows. */
  arrivalMs: 600,
  arrivalGrow: 0.15,
} as const;

export const LEADER = {
  /** Grid step of the route search, px. */
  gridStep: 8,
  /** Anchor discs excluded from clearance, px. */
  anchorRadius: 8,
  /** Keep the previous elbows while they stay this clear, px. */
  keepClearance: 13,
  /** Use the straight forward route when it is this clear, px. */
  directClearance: 14,
  /** A route set is good when it is this clear, px. */
  goodClearance: 12.2,
  /** Corridor kept around routed leaders and unrouted ends, px. */
  corridor: 14,
  /** Anchors closer than this to the start do not reserve an exit, px. */
  exitSpacing: 28,
  /** The search may finish once this close to the label end, px. */
  endReach: 32,
  /** Route orders tried, and row permutations tried. */
  attempts: 12,
  permutations: 64,
  /** Leader route easing, ms. */
  easeMs: 160,
  /** Vertical gap between leader lanes, px. */
  laneGap: 28,
} as const;
