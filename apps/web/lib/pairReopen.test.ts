import { describe, expect, it } from "vitest";
import { consumeReopenPairing, markReopenPairing } from "./pairReopen";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("pairing panel survives the reload after switching the public link", () => {
  it("reopens once after it was marked", () => {
    const s = memoryStorage();
    markReopenPairing(s);
    expect(consumeReopenPairing(s)).toBe(true);
    expect(consumeReopenPairing(s)).toBe(false);
  });
  it("stays closed when nothing was marked", () => {
    expect(consumeReopenPairing(memoryStorage())).toBe(false);
  });
  it("never throws when storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => markReopenPairing(broken)).not.toThrow();
    expect(consumeReopenPairing(broken)).toBe(false);
  });
});
