export type PointState = "waiting" | "active" | "done";
export function pointState(bullet: {started: boolean; confidence: number}, hot: boolean): PointState {
  return bullet.started ? "done" : hot ? "active" : "waiting";
}
