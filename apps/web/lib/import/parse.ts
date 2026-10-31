// Document import (ARCHITECTURE.md §6.6): PDF, PPTX, DOCX, TXT and MD become a
// Script in script.md format, one section per slide or page. The XML walkers are
// pure functions so they can be tested on strings; the zip handling lives in
// `importFile`.
import JSZip from "jszip";
import { parseScript, SLIDES_MARKER, type Script } from "@intelliprompter/core";

export const IMPORT_MARKER = "<!-- source: import -->";

export type Imported = { text: string; script: Script; kind: string; pages: number; warnings: string[] };

// ---- small XML helpers (no DOM in the Node runtime) -----------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Text of every <a:t> run inside each <a:p> paragraph, in document order. */
export function pptxParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1]));
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line) out.push(line);
  }
  return out;
}

/** Slide title: the paragraphs of the shape whose placeholder type is title/ctrTitle. */
export function pptxTitle(slideXml: string): string | undefined {
  for (const sp of slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    if (/<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp)) {
      const t = pptxParagraphs(sp).join(" ").trim();
      if (t) return t;
    }
  }
  return undefined;
}

/** Body text of a slide, excluding the title shape. */
export function pptxBody(slideXml: string): string[] {
  const out: string[] = [];
  for (const sp of slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    if (/<p:ph\b[^>]*type="(title|ctrTitle|sldNum|dt|ftr)"/.test(sp)) continue;
    out.push(...pptxParagraphs(sp));
  }
  return out;
}

/** Speaker notes: every paragraph except the slide-number placeholder. */
export function pptxNotes(notesXml: string): string[] {
  const out: string[] = [];
  for (const sp of notesXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    if (/<p:ph\b[^>]*type="(sldNum|sldImg|hdr|ftr|dt)"/.test(sp)) continue;
    out.push(...pptxParagraphs(sp));
  }
  return out;
}

/** Paragraphs of a DOCX body as { style, text }. Headings start sections. */
export function docxParagraphs(xml: string): Array<{ style: string; text: string }> {
  const out: Array<{ style: string; text: string }> = [];
  for (const p of xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []) {
    const style = p.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const text = [...p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1])).join("").replace(/\s+/g, " ").trim();
    if (text) out.push({ style, text });
  }
  return out;
}

// ---- builders ------------------------------------------------------------------------------

type Slide = { title?: string; body: string[]; notes: string[] };

/** One section per slide: title → section title; notes (or body lines) → points. */
export function slidesToText(slides: Slide[]): string {
  const parts = [SLIDES_MARKER, IMPORT_MARKER];
  slides.forEach((s, i) => {
    const title = s.title || s.body[0] || `Slide ${i + 1}`;
    const source = s.notes.length ? s.notes : s.body.filter((l) => l !== title);
    const points = source.map(sentenceOrLine).flat().filter(Boolean).slice(0, 8);
    parts.push("", `# ${title}`, ...points.map((p) => `- ${p}`));
  });
  return parts.join("\n");
}

/** Headings become sections; paragraphs become points (list items one each, prose split by sentence). */
export function paragraphsToText(paras: Array<{ style: string; text: string }>, fallbackTitle: string): string {
  const lines = [IMPORT_MARKER, ""];
  let hasSection = false;
  for (const p of paras) {
    if (/^(Heading|Title|Titolo|Überschrift|Titre)/i.test(p.style) || /^heading\d/i.test(p.style)) {
      lines.push("", `# ${p.text}`);
      hasSection = true;
      continue;
    }
    if (!hasSection) {
      lines.push(`# ${fallbackTitle}`);
      hasSection = true;
    }
    for (const s of sentenceOrLine(p.text)) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}

/** One section per page; the first line is the title, the rest become points. */
export function pagesToText(pages: string[], warnings: string[]): string {
  const lines = [IMPORT_MARKER];
  pages.forEach((page, i) => {
    const rows = page
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 1);
    if (!rows.length) {
      warnings.push(`Page ${i + 1} has no extractable text (scanned page?). Add its points by hand.`);
      lines.push("", `# Page ${i + 1}`, "- (no text found on this page)");
      return;
    }
    const title = rows[0].length <= 90 ? rows[0] : `Page ${i + 1}`;
    const rest = rows[0].length <= 90 ? rows.slice(1) : rows;
    const points = rest.join(" ").split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/).map((s) => s.trim()).filter((s) => s.length > 8).slice(0, 8);
    lines.push("", `# ${title}`, ...points.map((p) => `- ${p}`));
  });
  return lines.join("\n");
}

/** Splits prose into sentences (max 3 per paragraph), keeps short lines whole. */
function sentenceOrLine(text: string): string[] {
  const t = text.trim();
  if (t.length <= 140) return [t];
  return t
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 3);
}

// ---- entry point ----------------------------------------------------------------------------

export function detectKind(name: string, mime: string): "pdf" | "pptx" | "docx" | "text" | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "pptx" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (["txt", "md", "markdown"].includes(ext) || mime.startsWith("text/")) return "text";
  return null;
}

export async function importFile(name: string, mime: string, bytes: Uint8Array): Promise<Imported> {
  const kind = detectKind(name, mime);
  const warnings: string[] = [];
  if (!kind) throw new Error(`Unsupported file type: ${name}. Use PDF, PPTX, DOCX, TXT or MD.`);

  if (kind === "text") {
    const raw = new TextDecoder().decode(bytes);
    const direct = parseScript(raw);
    // Already in script format? Keep it verbatim.
    if (direct.sections.some((s) => s.bullets.length)) return { text: raw, script: direct, kind, pages: direct.sections.length, warnings };
    const paras = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((text) => ({ style: /^#/.test(text) ? "Heading" : "", text: text.replace(/^#+\s*/, "") }));
    const text = paragraphsToText(paras, name.replace(/\.[^.]+$/, ""));
    return { text, script: parseScript(text), kind, pages: 1, warnings };
  }

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
    const text = pagesToText(pages, warnings);
    return { text, script: parseScript(text), kind, pages: totalPages, warnings };
  }

  const zip = await JSZip.loadAsync(bytes);
  if (kind === "pptx") {
    const slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
    if (!slideFiles.length) throw new Error("No slides found in this PPTX.");
    const slides: Slide[] = [];
    for (const f of slideFiles) {
      const n = f.match(/(\d+)\.xml$/)![1];
      const xml = await zip.file(f)!.async("string");
      const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
      const notes = notesFile ? pptxNotes(await notesFile.async("string")) : [];
      slides.push({ title: pptxTitle(xml), body: pptxBody(xml), notes });
    }
    if (!slides.some((s) => s.notes.length)) warnings.push("No speaker notes found; slide text was used as points.");
    const text = slidesToText(slides);
    return { text, script: parseScript(text), kind, pages: slides.length, warnings };
  }

  // docx
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("Not a DOCX file (word/document.xml missing).");
  const paras = docxParagraphs(await doc.async("string"));
  if (!paras.length) throw new Error("The document has no text.");
  const text = paragraphsToText(paras, name.replace(/\.[^.]+$/, ""));
  return { text, script: parseScript(text), kind, pages: parseScript(text).sections.length, warnings };
}
