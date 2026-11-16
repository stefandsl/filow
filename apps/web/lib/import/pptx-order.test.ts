import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importFile } from "./parse";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const shape = (ph: string, text: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="${ph}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const slide = (title: string) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${shape("title", title)}</p:spTree></p:cSld></p:sld>`;
const notes = (text: string) => `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}><p:cSld><p:spTree>${shape("body", text)}</p:spTree></p:cSld></p:notes>`;
const rels = (items: Array<[string, string, string]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/**
 * Deck order (sldIdLst): slide3.xml "Intro", slide1.xml "Middle", slide2.xml "End"
 * (slides were reordered after creation). Only "Middle" and "End" have notes; their notes
 * parts are notesSlide1.xml (for slide2.xml "End") and notesSlide2.xml (for slide1.xml "Middle"),
 * linked through each slide's .rels as OOXML requires.
 */
async function deck(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
  z.file("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]]));
  z.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId2"/></p:sldIdLst></p:presentation>`);
  z.file("ppt/_rels/presentation.xml.rels", rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide3.xml"]]));
  z.file("ppt/slides/slide1.xml", slide("Middle"));
  z.file("ppt/slides/slide2.xml", slide("End"));
  z.file("ppt/slides/slide3.xml", slide("Intro"));
  z.file("ppt/slides/_rels/slide1.xml.rels", rels([["rId2", "notesSlide", "../notesSlides/notesSlide2.xml"]]));
  z.file("ppt/slides/_rels/slide2.xml.rels", rels([["rId2", "notesSlide", "../notesSlides/notesSlide1.xml"]]));
  z.file("ppt/slides/_rels/slide3.xml.rels", rels([]));
  z.file("ppt/notesSlides/notesSlide1.xml", notes("Note for End"));
  z.file("ppt/notesSlides/notesSlide2.xml", notes("Note for Middle"));
  return z.generateAsync({ type: "uint8array" });
}

describe("importFile pptx slide order and notes", () => {
  it("follows sldIdLst order and pairs notes through the slide relationships", async () => {
    const out = await importFile("deck.pptx", "", await deck());
    const body = out.text.slice(out.text.indexOf("\n# ") + 1);
    expect(body).toBe(["# Intro", "", "# Middle", "- Note for Middle", "", "# End", "- Note for End"].join("\n"));
  });
});
