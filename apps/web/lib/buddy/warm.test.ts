import { describe, expect, it } from "vitest";
import { WARM_MIN_VRAM_GB, warmEvictsDecision } from "./providers";

// Measured on the owner's PC (RTX 3070, 8 GB, G:/FILOW/tmp/evict2-ollama): Clef Flash alone holds 7.1 of
// the 8 GB, so OK Filow's helpers loaded ahead of a question push it out and the take starts "Reloading".
const card = (vramTotalGb: number | null, kind: "discrete" | "integrated" | "unified" | "none" = "discrete") => ({ kind, vramTotalGb });
const here = { model: "clef-flash", server: null };
const INSTALLED = ["gemma4:e4b", "lfm3-vl:latest", "clef-flash:latest"];

describe("warming OK Filow's helpers would push the decision model out of the graphics card", () => {
  it("an 8 GB card with Clef installed on this PC: yes", () => {
    expect(warmEvictsDecision(card(8), here, INSTALLED)).toBe(true);
  });

  it("the limit is 12 GB: just under it yes, at it and over it no", () => {
    expect(WARM_MIN_VRAM_GB).toBe(12);
    expect(warmEvictsDecision(card(11.9), here, INSTALLED)).toBe(true);
    expect(warmEvictsDecision(card(12), here, INSTALLED)).toBe(false);
    expect(warmEvictsDecision(card(24), here, INSTALLED)).toBe(false);
  });

  it("no card of its own (shared memory, none, or unknown size): no", () => {
    expect(warmEvictsDecision(card(8, "integrated"), here, INSTALLED)).toBe(false);
    expect(warmEvictsDecision(card(8, "unified"), here, INSTALLED)).toBe(false);
    expect(warmEvictsDecision(card(null, "none"), here, INSTALLED)).toBe(false);
    expect(warmEvictsDecision(card(null), here, INSTALLED)).toBe(false);
  });

  it("the decision model on the user's own server, or not installed here: no take uses this card", () => {
    expect(warmEvictsDecision(card(8), { model: "clef-flash", server: { id: "s1", name: "Lab" } }, INSTALLED)).toBe(false);
    expect(warmEvictsDecision(card(8), here, ["gemma4:e4b", "lfm3-vl:latest"])).toBe(false);
    expect(warmEvictsDecision(card(8), { model: null, server: null }, INSTALLED)).toBe(false);
  });

  it("the name matches with or without :latest, and only that model", () => {
    expect(warmEvictsDecision(card(8), { model: "clef-flash:latest", server: null }, ["clef-flash"])).toBe(true);
    expect(warmEvictsDecision(card(8), { model: "clef-pro", server: null }, INSTALLED)).toBe(false);
  });
});
