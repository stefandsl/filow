// Unit tests for local screen element detector snapping (OmniParser icon_detect_v3 pilot).
// Written before implementation: fails on origin/main, passes once detector snapping is wired.
import { describe, expect, it } from "vitest";
import {
  askedNames,
  matchElements,
  namedInQuestion,
  pickNames,
  placeBox,
  placePoint,
  placeTags,
  sanitizeElements,
  snapToDetected,
  SNAP_REACH,
  type ScreenElement,
} from "./ground";

const uia = (name: string, x1: number, y1: number, x2: number, y2: number, screen = 1): ScreenElement => ({
  name,
  screen,
  x1,
  y1,
  x2,
  y2,
  type: "Button",
});

const det = (x1: number, y1: number, x2: number, y2: number, screen = 1, score = 0.72): ScreenElement => ({
  name: "",
  screen,
  x1,
  y1,
  x2,
  y2,
  type: "Detected",
  source: "detector",
  score,
});

describe("detector snapping (contains, nearest within radius, nothing in range)", () => {
  const boxes = [
    det(100, 200, 180, 240, 1, 0.85), // small button: center (140, 220)
    det(80, 180, 260, 320, 1, 0.6),   // enclosing toolbar panel: center (170, 250)
    det(500, 500, 540, 540, 1, 0.9),  // isolated icon: center (520, 520)
    det(0, 0, 900, 900, 1, 0.5),      // giant region (> SNAP_MAX_AREA): must be ignored
    det(100, 200, 180, 240, 2, 0.88), // screen 2 element
  ];

  it("snaps a POINT contained inside a detected element to the smallest containing element's center", () => {
    const hit = snapToDetected({ x: 112, y: 208 }, boxes, 1);
    expect(hit).toMatchObject({ x: 140, y: 220, how: "snap" });
    expect(hit?.on).toMatchObject({ x1: 100, y1: 200, x2: 180, y2: 240, source: "detector" });
  });

  it("snaps a POINT outside but within SNAP_REACH to the nearest detected element's center", () => {
    const near = snapToDetected({ x: 520, y: 540 + SNAP_REACH - 5 }, boxes, 1);
    expect(near).toMatchObject({ x: 520, y: 520, how: "snap" });
  });

  it("does not snap across a large distance when nothing is within SNAP_REACH, and ignores giant regions", () => {
    const far = snapToDetected({ x: 520, y: 540 + SNAP_REACH + 12 }, boxes, 1);
    expect(far).toBeNull();
    const placed = placePoint("some icon", { x: 750, y: 750 }, boxes, 1);
    expect(placed).toEqual({ x: 750, y: 750, how: "guess" });
  });

  it("scopes snapping strictly to the target monitor (multi-monitor isolation)", () => {
    const onScreen2 = snapToDetected({ x: 520, y: 520 }, boxes, 2);
    expect(onScreen2).toBeNull();
    const hitScreen2 = snapToDetected({ x: 140, y: 220 }, boxes, 2);
    expect(hitScreen2).toMatchObject({ x: 140, y: 220, how: "snap" });
    expect(hitScreen2?.on?.screen).toBe(2);
  });

  it("snaps a model POINT or BOX tag via placePoint / placeBox / placeTags while preserving UIA priority", () => {
    const merged = [uia("Save", 850, 20, 920, 60, 1), det(200, 400, 280, 440, 1, 0.81)];
    // UIA element wins by name
    expect(placePoint("Save", { x: 210, y: 410 }, merged, 1)).toMatchObject({ x: 885, y: 40, how: "name" });
    // Unexposed element snaps to detector box when within radius
    expect(placePoint("Evaporation", { x: 240, y: 458 }, merged, 1)).toMatchObject({ x: 240, y: 420, how: "snap" });
    // 2-coordinate BOX normalized to POINT snaps cleanly
    expect(placeTags("Look [BOX:240,455:Evaporation:screen1]", merged)).toBe("Look [POINT:240,420:Evaporation:screen1]");
    // 4-coordinate BOX whose center is near/overlapping a detector box snaps to its rectangle
    expect(placeBox("Evaporation", { x1: 195, y1: 398, x2: 285, y2: 444 }, merged, 1)).toMatchObject({
      x1: 200,
      y1: 400,
      x2: 280,
      y2: 440,
      how: "overlap",
    });
    // Far away BOX does not snap
    expect(placeBox("Remote chart", { x1: 600, y1: 600, x2: 700, y2: 700 }, merged, 1)).toMatchObject({
      x1: 600,
      y1: 600,
      x2: 700,
      y2: 700,
      how: "guess",
    });
  });

  it("sanitizeElements accepts unnamed detector boxes while keeping UIA name validation and excluding detector boxes from name matchers", () => {
    const clean = sanitizeElements(
      [
        { name: "Start", screen: 1, x1: 0, y1: 940, x2: 30, y2: 1000, type: "Button" },
        { name: "", screen: 1, x1: 100, y1: 200, x2: 180, y2: 240, type: "Detected", source: "detector", score: 0.77 },
        { name: "", screen: 1, x1: 10, y1: 10, x2: 20, y2: 20 }, // unnamed non-detector is still dropped
      ],
      2,
    );
    expect(clean).toHaveLength(2);
    expect(clean[1]).toMatchObject({ name: "", screen: 1, x1: 100, y1: 200, x2: 180, y2: 240, source: "detector", score: 0.77 });
    expect(matchElements("Detected", clean, 1)).toEqual([]);
    expect(namedInQuestion("Where is Detected?", clean)).toEqual([]);
    expect(pickNames(clean, 1)).toEqual(["Start"]);
    expect(askedNames(clean, 1)).toEqual(["Start"]);
  });

  it("keeps identical behavior when detector is off (no detector elements present)", () => {
    const onlyUia = [uia("Start", 0, 940, 30, 1000, 1)];
    expect(placePoint("Evaporation", { x: 240, y: 458 }, onlyUia, 1)).toEqual({ x: 240, y: 458, how: "guess" });
  });
});
