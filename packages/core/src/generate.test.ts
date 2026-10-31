import { describe, expect, it } from "vitest";
import { generateScript, parseGenerated, pointsFromNotes, slideNeedsImage, type SlideInput } from "./generate";
import { parseScript } from "./script";

describe("pointsFromNotes", () => {
  it("takes bullet lines verbatim, else splits prose into sentences", () => {
    expect(pointsFromNotes("intro\n- say hi\n* thank the host\n• agenda")).toEqual(["say hi", "thank the host", "agenda"]);
    expect(pointsFromNotes("We grew 12%. Churn fell. Hiring continues in Q1.")).toEqual(["We grew 12%.", "Churn fell.", "Hiring continues in Q1."]);
    expect(pointsFromNotes("")).toEqual([]);
    expect(pointsFromNotes(undefined)).toEqual([]);
  });
});

describe("slideNeedsImage", () => {
  it("is true for pictures and for slides with little text", () => {
    expect(slideNeedsImage({ index: 0, text: "Q3" })).toBe(true);
    expect(slideNeedsImage({ index: 0, text: "A long paragraph of slide text that clearly stands on its own." })).toBe(false);
    expect(slideNeedsImage({ index: 0, text: "A long paragraph of slide text that clearly stands on its own.", hasPicture: true })).toBe(true);
  });
});

describe("parseGenerated", () => {
  it("parses JSON, strips fences, caps points, falls back to lines", () => {
    expect(parseGenerated('```json\n{"title":"Growth","points":["a","b","c","d","e","f"],"transition":"Now costs."}\n```', "x")).toEqual({
      title: "Growth",
      points: ["a", "b", "c", "d", "e"],
      transition: "Now costs.",
    });
    expect(parseGenerated("- first claim here\n- second claim here", "Fallback")).toEqual({ title: "Fallback", points: ["first claim here", "second claim here"] });
  });
});

describe("generateScript", () => {
  const slides: SlideInput[] = [
    { index: 0, title: "Intro", text: "Welcome to Acme", notes: "- greet everyone\n- one-line agenda" },
    { index: 1, title: "Revenue", text: "Revenue up 12% to EUR 4.2M", hasPicture: true },
    { index: 2, text: "" },
    { index: 3, title: "Q&A", text: "Questions?" },
  ];

  it("keeps notes, generates the rest, skips empty slides, requests images only where needed", async () => {
    const asked: Array<{ index: number; image: boolean }> = [];
    const out = await generateScript({ slides, language: "en" }, async (s) => {
      asked.push({ index: s.index, image: Boolean(s.imageBase64) });
      return { generated: { title: s.title || "Summary", points: [`claim about slide ${s.index + 1}`, "second claim"], transition: "Next." }, cost: 0.001, model: "m" };
    });
    expect(asked.map((a) => a.index)).toEqual([1, 3]);
    expect(out.perSlide.map((p) => p.source)).toEqual(["notes", "generated", "empty", "generated"]);
    expect(out.cost).toBeCloseTo(0.002);
    const script = parseScript(out.text);
    expect(script.source).toBe("slides");
    expect(script.sections.map((s) => s.title)).toEqual(["Intro", "Revenue", "Slide 3", "Q&A"]);
    expect(script.sections[0].bullets.map((b) => b.text)).toEqual(["greet everyone", "one-line agenda"]);
    expect(script.sections[1].bullets.map((b) => b.text)).toEqual(["claim about slide 2", "second claim"]);
    expect(script.sections[2].bullets).toEqual([]);
    expect(out.text).toContain("<!-- slide: 1 -->");
    expect(out.text).toContain("_Next._");
  });

  it("reports progress per slide", async () => {
    const seen: number[] = [];
    await generateScript({ slides }, async () => ({ generated: { title: "t", points: ["p"] }, cost: null, model: "m" }), (p) => seen.push(p.done));
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
