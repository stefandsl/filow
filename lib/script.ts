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
export function parseScript(text: string): Script {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^#+\s*(.+)$/);
    if (heading) {
      current = { id: `s${sections.length}`, title: heading[1].trim(), bullets: [] };
      sections.push(current);
      continue;
    }

    const bullet = line.match(/^[-*•]\s*(.+)$/);
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

  return { sections };
}

export function serializeScript(script: Script): string {
  return script.sections
    .map((s) => [`# ${s.title}`, ...s.bullets.map((b) => `- ${b.text}`)].join("\n"))
    .join("\n\n");
}
