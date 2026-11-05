import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_HEIGHT, clampNextHeight, maxNextHeight, readNextHeight, writeNextHeight } from "./nextHeight";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("next-section height", () => {
  it("clamps to 120 px and 70 percent of content height, rounding within the bounds", () => {
    expect(clampNextHeight(10, 800)).toBe(120);
    expect(clampNextHeight(300.4, 800)).toBe(300);
    expect(clampNextHeight(900, 800)).toBe(560);
    expect(clampNextHeight(900, 541)).toBe(378);
    expect(maxNextHeight(541)).toBe(378);
  });
  it("keeps the minimum when the content area is too short or not measured yet", () => {
    for (const height of [0, 100, -1, NaN]) expect(clampNextHeight(240, height)).toBe(120);
  });
  it("uses the default for missing, invalid or inaccessible preferences", () => {
    const store = memoryStorage();
    expect(readNextHeight(store, 800)).toBe(DEFAULT_NEXT_HEIGHT);
    for (const value of ["", "0", "-10", "NaN", "Infinity", "bad"]) {
      store.setItem("prefs:nextHeight", value);
      expect(readNextHeight(store, 800)).toBe(DEFAULT_NEXT_HEIGHT);
    }
    const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
    expect(readNextHeight(blocked, 800)).toBe(DEFAULT_NEXT_HEIGHT);
    expect(readNextHeight(blocked, 800, 400)).toBe(400);
    expect(readNextHeight(undefined, 200)).toBe(140);
    expect(() => writeNextHeight(blocked, 320)).not.toThrow();
    expect(() => writeNextHeight(undefined, 320)).not.toThrow();
    expect(clampNextHeight(NaN, 800)).toBe(DEFAULT_NEXT_HEIGHT);
  });
  it("restores the viewer preference after shrinking and growing without overwriting it", () => {
    const store = memoryStorage();
    writeNextHeight(store, 500.4);
    expect(store.getItem("prefs:nextHeight")).toBe("500");
    expect(readNextHeight(store, 400)).toBe(280);
    expect(readNextHeight(store, 800)).toBe(500);
    writeNextHeight(store, DEFAULT_NEXT_HEIGHT);
    expect(readNextHeight(store, 200)).toBe(140);
    expect(readNextHeight(store, 800)).toBe(DEFAULT_NEXT_HEIGHT);
    expect(readNextHeight(memoryStorage(), 800)).toBe(DEFAULT_NEXT_HEIGHT);
  });
});
