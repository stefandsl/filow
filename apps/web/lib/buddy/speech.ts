/** Longest time a spoken answer may take before OK Filow stops waiting for the end event (ms). */
export function speechDeadline(text: string, speed = 1): number {
  // ~12 characters per second at normal speed, doubled for slow voices, plus 8 s of slack.
  return Math.round((text.length / 12 / Math.max(0.5, speed || 1)) * 2000 + 8000);
}
