import type { Script, Section } from "./types";

/**
 * Script format (Markdown-ish):
 *
 *   # Section title
 *   - talking point
 *   - talking point
 *
 * Blank lines and anything else are ignored. IDs are stable per position so
 * state survives a reload of an unchanged script.
 */
/** A script exported from a slide deck carries this marker so `slideChanged` can navigate it. */
export const SLIDES_MARKER = "<!-- source: slides -->";
/** A script built by /api/import carries this marker. Slides win when both are present. */
export const IMPORT_MARKER = "<!-- source: import -->";

/** Optional heading prefix: "Intro - What is a decision model?" is the label "Intro" and the title after it. */
export function sectionLabel(title: string): { label: string; title: string } {
  const separator = title.indexOf(" - ");
  return separator > 0 ? { label: title.slice(0, separator), title: title.slice(separator + 3) } : { label: "", title };
}

/**
 * Optional time targets (the talk timer, rehearsal-timer.ts):
 *
 *   <!-- target: 20 min -->      the whole talk
 *   # Introduction (3 min)       one section
 *
 * The heading suffix is taken off the title, so every surface shows "Introduction". Minutes may be
 * written in the five speech languages ("3 min", "3 minuti", "3 minute", "3 мин", "3分").
 */
const SECTION_MINUTES = /\s*[([（]\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:min\.?|mins|minutes?|minut[oi]|minut[ei]?|мин\.?|минут[аы]?|分間?)\s*[)\]）]\s*$/iu;
const TALK_MINUTES = /^<!--\s*target\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*min\w*\s*-->$/i;

function minutesOf(raw: string): number | undefined {
  const n = Number(raw.replace(",", "."));
  return n > 0 && n <= 600 ? n : undefined;
}

/** "Intro (3 min)" -> { title: "Intro", minutes: 3 }; a title without a valid suffix stays as it is. */
export function splitSectionMinutes(title: string): { title: string; minutes?: number } {
  const m = title.match(SECTION_MINUTES);
  const minutes = m ? minutesOf(m[1]) : undefined;
  const rest = m ? title.slice(0, m.index).trim() : "";
  return minutes !== undefined && rest ? { title: rest, minutes } : { title };
}

const fmtMinutes = (n: number) => String(Math.round(n * 10) / 10);

/** True when points come before the first heading (parseScript then makes an "Untitled" section). */
export function hasLeadingPoints(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#+\s*\S/.test(line)) return false;
    if (/^[-*•]\s+\S/.test(line)) return true;
  }
  return false;
}

/**
 * Write the time targets into script text, changing only the target line and the heading suffixes:
 * everything else (comments, blank lines, markers) stays as the presenter wrote it. `sections` is
 * in heading order; null or a missing entry removes that section's target.
 */
export function setTimeTargets(text: string, targets: { minutes?: number | null; sections: Array<number | null | undefined> }): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Points before the first heading make an "Untitled" first section with no heading to hold a target.
  let idx = hasLeadingPoints(text) ? 1 : 0;
  const lines = text.split(/\r?\n/).filter((line) => !TALK_MINUTES.test(line.trim()));
  const out = lines.map((line) => {
    const heading = line.match(/^(\s*#+\s*)(.+?)\s*$/);
    if (!heading) return line;
    const { title } = splitSectionMinutes(heading[2]);
    const m = targets.sections[idx++];
    return m && m > 0 ? `${heading[1]}${title} (${fmtMinutes(m)} min)` : `${heading[1]}${title}`;
  });
  if (targets.minutes && targets.minutes > 0) {
    // after a leading source marker, so the marker stays the first line
    const at = out.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("<!--"));
    out.splice(at < 0 ? out.length : at, 0, `<!-- target: ${fmtMinutes(targets.minutes)} min -->`);
  }
  return out.join(eol);
}

export function parseScript(text: string): Script {
  const sections: Section[] = [];
  let current: Section | null = null;
  const fromSlides = text.includes(SLIDES_MARKER);
  const fromImport = text.includes(IMPORT_MARKER);
  let talkMinutes: number | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const talk = line.match(TALK_MINUTES);
    if (talk) talkMinutes = minutesOf(talk[1]);
    if (!line || line.startsWith("<!--")) continue;

    const heading = line.match(/^#+\s*(.+)$/);
    if (heading) {
      const { title, minutes } = splitSectionMinutes(heading[1].trim());
      current = { id: `s${sections.length}`, title, bullets: [], ...(minutes !== undefined ? { minutes } : {}) };
      sections.push(current);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (!current) {
        current = { id: `s${sections.length}`, title: "Untitled", bullets: [] };
        sections.push(current);
      }
      current.bullets.push({
        id: `${current.id}b${current.bullets.length}`,
        text: bullet[1].trim(),
      });
    }
  }

  const script: Script = fromSlides ? { sections, source: "slides" } : fromImport ? { sections, source: "import" } : { sections };
  return talkMinutes !== undefined ? { ...script, minutes: talkMinutes } : script;
}

export function serializeScript(script: Script): string {
  const marker = script.source === "slides" ? SLIDES_MARKER + "\n" : script.source === "import" ? IMPORT_MARKER + "\n" : "";
  const target = script.minutes ? `<!-- target: ${fmtMinutes(script.minutes)} min -->\n` : "";
  return marker + target + script.sections
    .map((s) => [`# ${s.title}${s.minutes ? ` (${fmtMinutes(s.minutes)} min)` : ""}`, ...s.bullets.map((b) => `- ${b.text}`)].join("\n"))
    .join("\n\n");
}
