import { describe, expect, it } from "vitest";
import { speechDeadline } from "./speech";

describe("speech deadline", () => {
  it("gives short answers a few seconds and long answers more", () => {
    expect(speechDeadline("")).toBe(8000);
    expect(speechDeadline("x".repeat(120))).toBe(28000);
  });
  it("waits longer for slow voices and never divides by zero", () => {
    expect(speechDeadline("x".repeat(120), 0.5)).toBe(48000);
    expect(speechDeadline("x".repeat(120), 0)).toBe(28000);
  });
});
