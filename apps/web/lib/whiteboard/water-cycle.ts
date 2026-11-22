/** The prepared board is local teaching material, independent of generated whiteboards. */
export const waterCycle = [
  ["lesson.evaporation", "lesson.surface", "lesson.vapour"],
  ["lesson.condensation", "lesson.vapour", "lesson.droplets"],
  ["lesson.precipitation", "lesson.droplets", "lesson.surface"],
  ["lesson.runoff", "lesson.surface", "lesson.collection"],
] as const;
