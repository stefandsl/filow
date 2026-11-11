import type { Script } from "@filow/core";

/** The languages a script can be translated into: the five Filow speaks, plus three common ones. */
export const TRANSLATE_LANGS: Record<string, string> = { en: "English", it: "Italian", ru: "Russian", ro: "Romanian", ja: "Japanese", de: "German", fr: "French", es: "Spanish" };

/**
 * The talk timer's targets are not text to translate: "<!-- target: 20 min -->" and the "(3 min)" of
 * each heading come back from a model changed, moved or dropped. Take them from the source script:
 * the whole talk's target always, each section's when the translation kept the sections one to one.
 */
export function keepTimeTargets(source: Script, translated: Script): Script {
  const sameSections = source.sections.length === translated.sections.length;
  const sections = sameSections ? translated.sections.map((s, i) => ({ ...s, minutes: source.sections[i].minutes })) : translated.sections;
  return { ...translated, sections, minutes: source.minutes, source: source.source };
}
