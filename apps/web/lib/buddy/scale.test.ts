import { describe, expect, it } from "vitest";
import { markToDisplay, pointToDisplay } from "./prompt";

// Electron reports display bounds in DIP: a 2560x1440 panel at 125% is 2048x1152, a 4K panel at 150%
// is 2560x1440. The model answers on a 0-1000 grid of the screenshot, so a point must land on the same
// spot whatever the scale, and on the right monitor whatever its offset (left of or above the primary).
const at125 = { x: 0, y: 0, width: 2048, height: 1152 };
const at150Right = { x: 2048, y: -144, width: 2560, height: 1440 };
const at150Left = { x: -2560, y: 0, width: 2560, height: 1440 };

describe("coordinate mapping at display scale 1.25 and 1.5", () => {
  it("maps grid points to the same relative spot at 125%", () => {
    expect(pointToDisplay({ x: 500, y: 500, label: "", screen: 1 }, at125)).toEqual({ x: 1024, y: 576 });
    expect(pointToDisplay({ x: 0, y: 0, label: "", screen: 1 }, at125)).toEqual({ x: 0, y: 0 });
    // The Start button sits in the bottom-left corner of the taskbar.
    expect(pointToDisplay({ x: 12, y: 985, label: "", screen: 1 }, at125)).toEqual({ x: 25, y: 1135 });
  });

  it("maps onto a 150% monitor right of the primary and raised above it", () => {
    expect(pointToDisplay({ x: 500, y: 500, label: "", screen: 2 }, at150Right)).toEqual({ x: 2048 + 1280, y: -144 + 720 });
    expect(pointToDisplay({ x: 1000, y: 1000, label: "", screen: 2 }, at150Right).x).toBeLessThanOrEqual(2048 + 2560);
  });

  it("maps onto a 150% monitor left of the primary (negative x)", () => {
    expect(pointToDisplay({ x: 250, y: 100, label: "", screen: 2 }, at150Left)).toEqual({ x: -2560 + 640, y: 144 });
  });

  it("scales mark sizes with the display, not the screenshot", () => {
    expect(markToDisplay({ kind: "circle", x: 500, y: 500, r: 50, label: "", screen: 1 }, at125)).toMatchObject({ x: 1024, y: 576, r: 58 });
    expect(markToDisplay({ kind: "arrow", x1: 0, y1: 0, x2: 1000, y2: 1000, label: "", screen: 2 }, at150Right)).toMatchObject({ x1: 2048, y1: -144 });
  });
});
