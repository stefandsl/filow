/** Read a prediction only when it names one of this request's offered choices. */
export function offeredChoice(value: unknown, choices: readonly string[]): string | null {
  return typeof value === "string" && choices.includes(value) ? value : null;
}
