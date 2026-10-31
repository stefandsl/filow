// HTTP contracts between an engine and the Next.js API routes.
import type { Bullet, Script, ScreenSummary } from "./types";

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
  /** Which decision provider to use; the server falls back to its configured default. */
  provider?: DecisionProviderId;
};

export type DecisionProviderId = "openrouter" | "clef-local" | "clef-cloudflare";

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

// ---- Screen Sense (§6) --------------------------------------------------------------

export type VisionRequest = {
  /** JPEG or PNG as a data URL. Sent once, never stored. */
  image: string;
  source: "screen" | "window" | "region";
  /** what the presenter planned to say here, for the mismatch check */
  context?: { sectionTitle?: string; points?: string[] };
  /** a spoken question that came with a hotkey capture */
  question?: string;
};

export type VisionResponse = {
  summary: ScreenSummary;
  latencyMs: number;
  cost: number | null;
  model: string;
};

/** POST /api/import: the file becomes a Script in script.md format. */
export type ImportResponse = {
  text: string;
  script: Script;
  /** "pdf" | "pptx" | "docx" | "text" */
  kind: string;
  pages: number;
  warnings: string[];
};
