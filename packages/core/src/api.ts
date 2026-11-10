// HTTP contracts between an engine and the Next.js API routes.
import type { Bullet, Script, ScreenSummary } from "./types";

export type Decision = {
  id: string;
  started: boolean;
  confidence: number;
  /** pre-filter scores of the transcript tail for this point, when the gate ran (gate.ts) */
  gate?: number;
  lexical?: number;
  /** Present when the provider verified this point in this answer (the request listed it in `verify`). */
  verification?: Verification;
};

/**
 * The second look at a point that is about to be ticked (TRK-2, docs/gauntlet/BASELINE.md): two
 * focused questions the decision model answers far better than one broad one.
 */
export type Verification = {
  /** 0..1: the speaker presents it as true, happening or planned (not cancelled, denied, imagined or ironic) */
  real: number;
  /** 0..1: the transcript says it of the same party as the script point (not a supplier or competitor when the point is about us) */
  sameParty: number;
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
  /** Ids of the points (among `bullets`) to verify in the same call: the ones one answer away from a tick. */
  verify?: string[];
  /** Which decision provider to use; the server falls back to its configured default. */
  provider?: DecisionProviderId;
};

/** "matcher" runs inside the page (packages/core/src/matcher.ts) and is never sent to /api/decide. */
export type DecisionProviderId = "openrouter" | "clef-local" | "clef-cloudflare" | "matcher";
export type ServerDecisionProviderId = Exclude<DecisionProviderId, "matcher">;

export type DecideResponse = {
  decisions: Decision[];
  /** On-screen facts the speaker has not mentioned yet (gap detector). */
  unmentioned?: string[];
  latencyMs: number;
  /** USD; null when the provider does not report usage.cost */
  cost: number | null;
  model: string;
  /** true when this provider answers `verify` requests; the engine then waits for the verification before a tick */
  canVerify?: boolean;
};

export type SttStatus = {
  elevenlabs: boolean;
  openai: boolean;
};

// ---- Screen Sense (§6) --------------------------------------------------------------

export type VisionRequest = {
  /** JPEG, PNG or WebP as a data URL. Sent once, never stored. */
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
