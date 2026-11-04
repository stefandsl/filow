import { describe, expect, it } from "vitest";
import { DEFAULT_RAIL_WIDTH, clampRailWidth, readRailWidth, writeRailWidth } from "./railWidth";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("resizable next-section rail", () => {
  it("keeps the rail between 280 px and the smaller of 720 px or 55 percent of the window", () => {
    expect(clampRailWidth(100, 1920)).toBe(280);
    expect(clampRailWidth(500, 1920)).toBe(500);
    expect(clampRailWidth(2000, 1920)).toBe(720);
    expect(clampRailWidth(700, 1100)).toBe(605);
  });
  it("never lets the points column lose its room on a narrow window", () => {
    expect(clampRailWidth(600, 1000)).toBe(550);
  });
  it("remembers the chosen width and falls back to the default", () => {
    const s = memoryStorage();
    expect(readRailWidth(s, 1920)).toBe(DEFAULT_RAIL_WIDTH);
    writeRailWidth(s, 512.4);
    expect(readRailWidth(s, 1920)).toBe(512);
    s.setItem("prefs:railWidth", "not a number");
    expect(readRailWidth(s, 1920)).toBe(DEFAULT_RAIL_WIDTH);
  });
  it("clamps a saved width when the window got smaller", () => {
    const s = memoryStorage();
    writeRailWidth(s, 700);
    expect(readRailWidth(s, 1000)).toBe(550);
  });
});
