/** The prepared board is local teaching material, independent of generated whiteboards. */
// Keep the lesson text with the candidate board even in a checkout using a linked installation.
export { t as lessonText, type I18nKey as LessonTextKey } from "../../../../packages/core/src/i18n";
export const waterCycle = [
  ["lesson.evaporation", "lesson.surface", "lesson.vapour"],
  ["lesson.condensation", "lesson.vapour", "lesson.droplets"],
  ["lesson.precipitation", "lesson.clouds", "lesson.ground"],
  ["lesson.runoff", "lesson.ground", "lesson.lake"],
] as const;
