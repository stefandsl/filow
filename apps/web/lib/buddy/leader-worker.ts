import { routeLeaders } from "./leader-route";
import type { Pixel } from "./leader-metrics";

// Grid searches must never hold up a frame of the 160 ms route transition.
self.onmessage = (event: MessageEvent<{ lines: Pixel[][]; view: {width:number;height:number}; previous: Pixel[][] | null }>) => {
  const { lines, view, previous } = event.data;
  self.postMessage(routeLeaders(lines, view, previous));
};
