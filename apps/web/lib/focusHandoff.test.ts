import { describe, expect, it } from "vitest";
import { refocusIfLost } from "./focusHandoff";

const button = () => {
  const b = { focused: 0, focus() { b.focused++; } };
  return b;
};

describe("refocusIfLost (Start becomes Stop under the keyboard)", () => {
  it("moves the focus to the new control when it fell to the body", () => {
    const body = {};
    const stop = button();
    expect(refocusIfLost(stop, { activeElement: body, body })).toBe(true);
    expect(stop.focused).toBe(1);
  });

  it("moves it when nothing is focused at all", () => {
    const stop = button();
    expect(refocusIfLost(stop, { activeElement: null, body: {} })).toBe(true);
    expect(stop.focused).toBe(1);
  });

  it("leaves the focus where the user put it", () => {
    const stop = button();
    expect(refocusIfLost(stop, { activeElement: { id: "script-editor" }, body: {} })).toBe(false);
    expect(stop.focused).toBe(0);
  });

  it("does nothing without a control to focus", () => {
    const body = {};
    expect(refocusIfLost(null, { activeElement: body, body })).toBe(false);
  });
});
