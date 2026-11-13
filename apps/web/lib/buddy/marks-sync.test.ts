import { describe, expect, it } from "vitest";
import { drawingStarts, extendsMarks, markSentences, marksReleased } from "./marks-sync";
import { appendStarts, marksBegun, SENTENCE_GAP_MS, STROKE_GAP_MS } from "./motion";
import { parseBuddyAnswer, type BuddyMark } from "./prompt";
import { splitSentences } from "./turn";

const screens = [{ index: 1, width: 1024, height: 576, cursor: true }];
const ANSWER = "Open the File menu first. That panel [BOX:620,140,980,560:Layers panel] lists your layers. Then press Save [CIRCLE:300,40,20:Save]. The title [UNDERLINE:100,90,400:Title] is at the top. [ARROW:900,900,700,700:Export]";

describe("each mark belongs to the sentence its tag stands in", () => {
  it("counts sentences of the shown text, a tag after a full stop going with the sentence just ended", () => {
    const at = markSentences(ANSWER, screens);
    const parsed = parseBuddyAnswer(ANSWER, screens);
    expect(parsed.marks.map((m) => m.kind)).toEqual(["box", "circle", "underline", "arrow"]);
    expect(at).toEqual([1, 2, 3, 3]);
    // the indices are the bubble's and the voice's (turn.ts splitSentences of the shown text)
    const sentences = splitSentences(parsed.text);
    expect(sentences[1]).toContain("lists your layers");
    expect(sentences[2]).toContain("press Save");
  });
  it("works on a partial stream and skips tags that do not parse", () => {
    expect(markSentences("Look here [BOX:1,2,3:bad arity] and [CIRCLE:10,10,10:ok]. Next [BO", screens)).toEqual([0]);
    expect(markSentences("No marks at all.", screens)).toEqual([]);
  });
  it("Japanese sentences end with 。", () => {
    expect(markSentences("ファイルを開きます。保存ボタン[BOX:1,1,50,50:保存]を押します。", screens)).toEqual([1]);
  });
});

describe("marks are released as the voice reaches their sentence", () => {
  it("in order, each waiting for the ones before it", () => {
    expect(marksReleased([1, 2, 3, 3], -1)).toBe(0);
    expect(marksReleased([1, 2, 3, 3], 0)).toBe(0);
    expect(marksReleased([1, 2, 3, 3], 1)).toBe(1);
    expect(marksReleased([1, 2, 3, 3], 3)).toBe(4);
    expect(marksReleased([0, 5, 1], 2)).toBe(1);
  });
});

const m = (x: number, label = "a"): BuddyMark => ({ kind: "circle", x, y: 10, r: 5, label, screen: 1 });

describe("start times of a drawing", () => {
  it("a new drawing starts its marks one after another, done ones long ago", () => {
    expect(appendStarts([], 3, 1000)).toEqual([1000, 1000 + STROKE_GAP_MS, 1000 + 2 * STROKE_GAP_MS]);
    expect(appendStarts([], 3, 1000, STROKE_GAP_MS, 1)).toEqual([-Infinity, 1000, 1000 + STROKE_GAP_MS]);
    expect(marksBegun([0, 900, 1800], 950)).toBe(2);
  });
  it("a drawing that grew keeps the starts it had and starts the new marks now", () => {
    const first = drawingStarts(null, [m(1)], 0);
    expect(first).toEqual({ starts: [0], grew: false });
    const grown = drawingStarts({ list: [m(1)], starts: first.starts }, [m(1), m(2), m(3)], 5000);
    expect(grown).toEqual({ starts: [0, 5000, 5000 + SENTENCE_GAP_MS], grew: true });
    // a later sentence starts at once, even while the previous stroke is finishing
    expect(drawingStarts({ list: [m(1)], starts: [0] }, [m(1), m(2)], 100).starts).toEqual([0, 100]);
  });
  it("another drawing (a mark changed, or a Resume with marks done) starts again", () => {
    expect(extendsMarks([m(1)], [m(1, "b"), m(2)])).toBe(false);
    expect(extendsMarks([], [m(1)])).toBe(false);
    expect(drawingStarts({ list: [m(1)], starts: [0] }, [m(9), m(2)], 100).grew).toBe(false);
    expect(drawingStarts({ list: [m(1)], starts: [0] }, [m(1), m(2)], 100, 1)).toEqual({ starts: [-Infinity, 100], grew: false });
    // the same marks again (the answer's end releases what is left): nothing restarts
    expect(drawingStarts({ list: [m(1), m(2)], starts: [0, 450] }, [{ ...m(1), done: true } as BuddyMark & { done: boolean }, m(2)], 9000)).toEqual({ starts: [0, 450], grew: true });
  });
});
