import { describe, expect, it } from "vitest";
import { parseScript } from "@filow/core";
import { detectKind, docxParagraphs, pagesToText, paragraphsToText, pptxBody, pptxNotes, pptxTitle, slidesToText } from "./parse";

const slideXml = `<p:sld><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Q3 </a:t></a:r><a:r><a:t>Results &amp; Outlook</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Revenue up 12%</a:t></a:r></a:p><a:p><a:r><a:t>Churn down</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>3</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

const notesXml = `<p:notes><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Thank the team first</a:t></a:r></a:p><a:p><a:r><a:t>Mention the 12% beat</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>3</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

describe("pptx", () => {
  it("reads title, body and notes, skipping slide numbers", () => {
    expect(pptxTitle(slideXml)).toBe("Q3 Results & Outlook");
    expect(pptxBody(slideXml)).toEqual(["Revenue up 12%", "Churn down"]);
    expect(pptxNotes(notesXml)).toEqual(["Thank the team first", "Mention the 12% beat"]);
  });
  it("builds a slides script: notes become points, body is the fallback", () => {
    const text = slidesToText([
      { title: "Intro", body: ["Welcome"], notes: ["Say hi", "Agenda in one breath"] },
      { title: undefined, body: ["Pricing", "From $9"], notes: [] },
    ]);
    const script = parseScript(text);
    expect(script.source).toBe("slides");
    expect(script.sections.map((s) => s.title)).toEqual(["Intro", "Pricing"]);
    expect(script.sections[0].bullets.map((b) => b.text)).toEqual(["Say hi", "Agenda in one breath"]);
    expect(script.sections[1].bullets.map((b) => b.text)).toEqual(["From $9"]);
  });
});

describe("docx", () => {
  it("turns headings into sections and paragraphs into points", () => {
    const xml = `<w:document><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Why now</w:t></w:r></w:p>
<w:p><w:r><w:t>The market doubled. </w:t></w:r><w:r><w:t>Nobody serves SMBs.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p>
<w:p><w:r><w:t>Ship in Q1</w:t></w:r></w:p>
</w:body></w:document>`;
    const paras = docxParagraphs(xml);
    expect(paras).toHaveLength(4);
    const script = parseScript(paragraphsToText(paras, "doc"));
    expect(script.sections.map((s) => s.title)).toEqual(["Why now", "Plan"]);
    expect(script.sections[0].bullets.map((b) => b.text)).toEqual(["The market doubled. Nobody serves SMBs."]);
    expect(script.sections[1].bullets.map((b) => b.text)).toEqual(["Ship in Q1"]);
  });
  it("adds a section when the document has no headings", () => {
    const script = parseScript(paragraphsToText([{ style: "", text: "Just a note" }], "memo"));
    expect(script.sections[0].title).toBe("memo");
  });
});

describe("pdf pages", () => {
  it("one section per page, first line as title, empty pages warned", () => {
    const warnings: string[] = [];
    const text = pagesToText(["Agenda\nWe cover three things today. Then we take questions.", "   "], warnings);
    const script = parseScript(text);
    expect(script.sections.map((s) => s.title)).toEqual(["Agenda", "Page 2"]);
    expect(script.sections[0].bullets.map((b) => b.text)).toEqual(["We cover three things today.", "Then we take questions."]);
    expect(warnings[0]).toMatch(/Page 2/);
  });
});

describe("detectKind", () => {
  it("uses the extension first, then the mime type", () => {
    expect(detectKind("deck.PPTX", "")).toBe("pptx");
    expect(detectKind("notes", "text/markdown")).toBe("text");
    expect(detectKind("x.bin", "application/octet-stream")).toBeNull();
  });
});
