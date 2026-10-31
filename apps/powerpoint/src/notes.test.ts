import { describe, expect, it } from "vitest";
import { parseScript, SLIDES_MARKER } from "@intelliprompter/core";
import { notesToScript, pickTitle } from "./notes";

describe("notesToScript", () => {
  it("makes one section per slide and keeps only bullet lines", () => {
    const text = notesToScript([
      { title: "Intro", notes: "Say hello\n- welcome everyone\n* what we build\nremember to smile" },
      { notes: "" },
      { title: "  ", notes: "• recap" },
    ]);
    expect(text.startsWith(SLIDES_MARKER)).toBe(true);
    const script = parseScript(text);
    expect(script.source).toBe("slides");
    expect(script.sections.map((s) => s.title)).toEqual(["Intro", "Slide 2", "Slide 3"]);
    expect(script.sections[0].bullets.map((b) => b.text)).toEqual(["welcome everyone", "what we build"]);
    expect(script.sections[1].bullets).toEqual([]);
    expect(script.sections[2].bullets[0].id).toBe("s2b0");
  });

  it("round-trips through the Markdown parser without the marker leaking as a point", () => {
    const script = parseScript(notesToScript([{ title: "A", notes: "- x" }]));
    expect(script.sections).toHaveLength(1);
    expect(script.sections[0].bullets).toHaveLength(1);
  });

  it("parseScript without the marker has no source", () => {
    expect(parseScript("# A\n- x").source).toBeUndefined();
  });
});

describe("pickTitle", () => {
  it("takes the first non-empty line and caps length", () => {
    expect(pickTitle(["", "\n  Hello world\nmore"])).toBe("Hello world");
    expect(pickTitle(["x".repeat(200)])?.length).toBe(120);
    expect(pickTitle([])).toBeUndefined();
  });
});
