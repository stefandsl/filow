import { describe, expect, it } from "vitest";
import { VIDEO, captionLines, frameLayout, videoMime } from "./video";

describe("a lesson saved as a video", () => {
  it("records WebM in the first flavour the browser has, with sound only when asked, and says when it has none", () => {
    const only = (...have: string[]) => (m: string) => have.includes(m);
    expect(videoMime(() => true, true)).toBe("video/webm;codecs=vp9,opus");
    expect(videoMime(() => true, false)).toBe("video/webm;codecs=vp9");
    expect(videoMime(only("video/webm;codecs=vp8", "video/webm"), false)).toBe("video/webm;codecs=vp8");
    expect(videoMime(only("video/webm"), true)).toBe("video/webm");
    expect(videoMime(() => false, true)).toBeNull();
  });

  it("writes the sentence under the board in at most two lines, never cutting a word, with an ellipsis when it is longer", () => {
    expect(captionLines("Voltage drives current.", 84)).toEqual(["Voltage drives current."]);
    const long = "Voltage pushes a current through a resistance, and the larger the resistance the smaller the current for the same voltage across it.";
    const two = captionLines(long, 84);
    expect(two).toHaveLength(2);
    expect(two.every((l) => l.length <= 84)).toBe(true);
    expect(two.join(" ")).toBe(long);
    const cut = captionLines(`${long} ${long}`, 84);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith("\u2026")).toBe(true);
    // Japanese has no spaces and its characters are wide: broken by width, not lost
    const ja = captionLines("\u96fb\u5727\u304c\u96fb\u6d41\u3092\u62bc\u3057\u6d41\u3057\u307e\u3059".repeat(6), 84);
    expect(ja.length).toBe(2);
    expect(Array.from(ja[0]).length).toBeLessThanOrEqual(42);
    expect(captionLines("", 84)).toEqual([]);
  });

  it("fits the wide and the tall board above the caption, centred, inside the frame", () => {
    for (const [w, h] of [[1200, 720], [480, 800], [480, 1400]] as const) {
      const at = frameLayout(w, h);
      expect(at.board.x).toBeGreaterThanOrEqual(0);
      expect(at.board.y).toBeGreaterThanOrEqual(0);
      expect(at.board.x + at.board.w).toBeLessThanOrEqual(VIDEO.width);
      expect(at.board.y + at.board.h).toBeLessThanOrEqual(VIDEO.height - VIDEO.captionH);
      expect(Math.abs(at.board.w / at.board.h - w / h)).toBeLessThan(0.01);
      expect(Math.abs(at.board.x * 2 + at.board.w - VIDEO.width)).toBeLessThanOrEqual(1);
      expect(at.caption).toEqual({ x: 0, y: VIDEO.height - VIDEO.captionH, w: VIDEO.width, h: VIDEO.captionH });
    }
  });
});