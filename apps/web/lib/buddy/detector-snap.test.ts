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

  it("keeps a POINT already inside a detected element where it is so correct hits are never dragged off target", () => {
    const inside = snapToDetected({ x: 112, y: 208 }, boxes, 1);
    expect(inside).toBeNull();
    expect(placePoint("some button", { x: 112, y: 208 }, boxes, 1)).toEqual({ x: 112, y: 208, how: "guess" });
  });

  it("snaps a POINT outside but within DETECTOR_SNAP_REACH_PX to the nearest detected element's center", () => {
    // 18 grid units vertically on 1920x1080 = 19.44 px <= 24 px
    const near = snapToDetected({ x: 520, y: 540 + 18 }, boxes, 1);
    expect(near).toMatchObject({ x: 520, y: 520, how: "snap" });
  });

  it("does not snap across a large distance when nothing is within reach, and ignores giant regions", () => {
    const far = snapToDetected({ x: 520, y: 540 + SNAP_REACH + 12 }, boxes, 1);
    expect(far).toBeNull();
    const placed = placePoint("some icon", { x: 750, y: 750 }, boxes, 1);
    expect(placed).toEqual({ x: 750, y: 750, how: "guess" });
  });

  it("scopes snapping strictly to the target monitor (multi-monitor isolation)", () => {
    const onScreen2 = snapToDetected({ x: 520, y: 520 }, boxes, 2);
    expect(onScreen2).toBeNull();
    // 10 grid units below the screen-2 button = 10.8 px <= 24 px -> snaps on screen 2
    const hitScreen2 = snapToDetected({ x: 140, y: 250 }, boxes, 2);
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

  // Round 2 regression tests for review findings (must fail on eb554952, then pass):
  it("never moves a correct guess already inside a target off-target onto an overlapping detector box", () => {
    // Target button is at [100, 200, 150, 230] (center 125, 215).
    // An overlapping detector box covers [100, 200, 260, 290] (center 180, 245 - OUTSIDE the target!).
    const overlapping = [det(100, 200, 260, 290, 1, 0.82)];
    const guessInsideTarget = { x: 125, y: 215 };
    const placed = placePoint("Save", guessInsideTarget, overlapping, 1);
    expect(placed).toMatchObject({ x: 125, y: 215 });
    // Point must remain inside the target [100..150, 200..230]
    expect(placed!.x).toBeGreaterThanOrEqual(100);
    expect(placed!.x).toBeLessThanOrEqual(150);
    expect(placed!.y).toBeGreaterThanOrEqual(200);
    expect(placed!.y).toBeLessThanOrEqual(230);
  });

  it("rejects low-confidence detector boxes and ambiguous neighbour snaps", () => {
    const lowConf = [det(200, 200, 250, 230, 1, 0.08)];
    expect(snapToDetected({ x: 225, y: 238 }, lowConf, 1)).toBeNull();

    // Two adjacent toolbar buttons 10 grid units apart; guess sits midway between them
    const neighbours = [
      det(100, 100, 140, 130, 1, 0.9),
      det(152, 100, 192, 130, 1, 0.9),
    ];
    expect(snapToDetected({ x: 146, y: 115 }, neighbours, 1)).toBeNull();
  });

  it("measures detector snap reach in physical pixels rather than grid units (e.g. 4K display)", () => {
    const boxes4k = [det(500, 500, 530, 530, 1, 0.9)];
    // 20 grid units horizontally on 3840x2160 = 76.8 px -> MUST NOT snap (reach is 24 px)
    const farOn4k = snapToDetected({ x: 550, y: 515 }, boxes4k, 1, { screenSize: { width: 3840, height: 2160 } } as never);
    expect(farOn4k).toBeNull();
    // 5 grid units horizontally on 3840x2160 = 19.2 px -> within 24 px reach -> snaps
    const nearOn4k = snapToDetected({ x: 535, y: 515 }, boxes4k, 1, { screenSize: { width: 3840, height: 2160 } } as never);
    expect(nearOn4k).toMatchObject({ x: 515, y: 515, how: "snap" });
  });

  it("fair regression test: guesses on every labelled element never lose a single center hit", () => {
    // Synthetic toolbar with 10 densely packed buttons plus noisy/overlapping detector boxes
    const targets = Array.from({ length: 10 }, (_, i) => ({
      name: `Btn${i}`,
      x1: 50 + i * 50,
      y1: 100,
      x2: 90 + i * 50,
      y2: 130,
    }));
    const dets: ScreenElement[] = [
      // Some exact boxes, some offset/merged overlapping boxes, some low-conf false positives
      ...targets.slice(0, 6).map((t) => det(t.x1, t.y1, t.x2, t.y2, 1, 0.85)),
      det(300, 95, 490, 135, 1, 0.72), // merged container overlapping Btn5..Btn8
      det(495, 98, 545, 132, 1, 0.81), // slightly shifted box over Btn9
      det(550, 100, 580, 130, 1, 0.09), // low-conf FP
    ];
    let lostHits = 0;
    for (const t of targets) {
      const cx = (t.x1 + t.x2) / 2;
      const cy = (t.y1 + t.y2) / 2;
      const placed = placePoint(t.name, { x: cx, y: cy }, dets, 1)!;
      const stillInside = placed.x >= t.x1 && placed.x <= t.x2 && placed.y >= t.y1 && placed.y <= t.y2;
      if (!stillInside) lostHits++;
    }
    expect(lostHits).toBe(0);
  });
});
