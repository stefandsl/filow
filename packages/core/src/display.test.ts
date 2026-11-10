import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, displayStyle, eyelineScrollTop, normalizeDisplay } from "./display";

describe("display preferences", () => {
  it("keeps valid choices and drops anything else", () => {
    expect(normalizeDisplay({ size: "xl", width: "narrow", eyeline: "top", mirror: true, contrast: true, extra: 1 }))
      .toEqual({ size: "xl", width: "narrow", eyeline: "top", mirror: true, contrast: true });
    expect(normalizeDisplay({ size: "huge", width: 3, eyeline: null, mirror: "yes", contrast: 1 })).toEqual(DEFAULT_DISPLAY);
    expect(normalizeDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(normalizeDisplay("{}")).toEqual(DEFAULT_DISPLAY);
  });

  it("puts the current point on the eyeline, never past either end", () => {
    // a point 900 px down in a 600 px view: a third down means 200 px above it
    expect(eyelineScrollTop(900, 600, "upper", 5000)).toBe(702);
    expect(eyelineScrollTop(900, 600, "top", 5000)).toBe(840);
    expect(eyelineScrollTop(900, 600, "middle", 5000)).toBe(600);
    expect(eyelineScrollTop(50, 600, "middle", 5000)).toBe(0);
    expect(eyelineScrollTop(900, 600, "top", 300)).toBe(300);
  });

  it("turns a choice into the prompter's CSS variables", () => {
    expect(displayStyle({ ...DEFAULT_DISPLAY, size: "l", width: "medium", eyeline: "top" })).toEqual({
      "--display-scale": "1.375",
      "--display-measure": "42ch",
      "--display-room-vh": "90vh",
    });
  });
});
