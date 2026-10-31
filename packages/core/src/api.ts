// HTTP contracts between an engine and the Next.js API routes.
import type { Bullet } from "./types";

export type Decision = {
  id: string;
  started: boolean;
  confidence: number;
};

export type DecideRequest = {
  transcript: string;
  /** Points still open in the current section: the ones to decide on. */
  bullets: Bullet[];
  sectionTitle: string;
  /** Points of this section already marked started (context only, not decided again). */
  covered?: string[];
  /** Points of the next section (context so the model can tell "moved on" from "covering"). */
  upcoming?: string[];
  /** Facts currently visible on screen (Screen Sense), context only. */
  onScreen?: string[];
  /** Optional language hint, e.g. "it" or "en". */
  language?: string;
};

export type DecideResponse = {
  decisions: Decision[];
  /** On-screen facts the speaker has not mentioned yet (gap detector). */
  unmentioned?: string[];
  latencyMs: number;
  /** USD; null when the provider does not report usage.cost */
  cost: number | null;
  model: string;
};

export type SttStatus = {
  elevenlabs: boolean;
  openai: boolean;
};
