// Domain types shared by every surface. See ARCHITECTURE.md §5.4.

/** A talking point. The UI calls it a "point"; the type name is kept for compatibility. */
export type Bullet = {
  id: string;
  text: string;
};

export type Section = {
  id: string;
  title: string;
  bullets: Bullet[];
};

export type Script = {
  sections: Section[];
  /** "slides" when built from a deck, so slide index == section index. */
  source?: "markdown" | "slides" | "import";
};

export type PointStatus = "waiting" | "started" | "missed";
/** @deprecated use PointStatus */
export type BulletStatus = PointStatus;

export type PointState = {
  status: PointStatus;
  /** 0..1, last reported by the decision model */
  confidence: number;
  startedAt?: number;
};
/** @deprecated use PointState */
export type BulletState = PointState;

export type SttBackendId = "browser" | "elevenlabs" | "openai";

export type ScreenSummary = {
  at: number;
  source: "screen" | "window" | "region" | "slide-text";
  title?: string;
  /** one sentence */
  shows: string;
  /** max 3 */
  pointsToMake: string[];
  /** numbers, names, visible text worth saying */
  facts: string[];
  /** vs the script, e.g. "slide says 2025, script says 2024" */
  mismatch?: string;
  unavailable?: "no-screen-selected" | "could-not-read" | "capped" | "disabled";
};

export type SessionStats = {
  calls: number;
  totalMs: number;
  avgMs: number;
  /** null when the provider reports no usage.cost */
  costUsd: number | null;
  model: string;
};

export type SessionState = {
  id: string;
  version: number;
  script: Script;
  sectionIdx: number;
  points: Record<string, PointState>;
  /** last 160 chars of the transcript */
  transcriptTail: string;
  stats: SessionStats;
  engine: { backend: SttBackendId | null; recording: boolean; error?: string };
  slide?: { index: number; total: number; title?: string };
  screen?: ScreenSummary | null;
};

export type Command =
  | { type: "nextSection" }
  | { type: "prevSection" }
  | { type: "goToSection"; idx: number }
  | { type: "resetSection" }
  | { type: "markStarted"; id: string }
  | { type: "markMissed"; id: string }
  | { type: "reopen"; id: string }
  | { type: "startTake" }
  | { type: "stopTake" }
  | { type: "loadScript"; text: string }
  | { type: "slideChanged"; index: number; total: number; title?: string }
  | { type: "lookNow" }
  | { type: "forgetScreen" };

export type CommandResult = { ok: true } | { ok: false; error: string };
