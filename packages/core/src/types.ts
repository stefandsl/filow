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
  /** Target length of this section in minutes ("# Intro (3 min)"), for the talk timer. */
  minutes?: number;
};

export type Script = {
  sections: Section[];
  /** "slides" when built from a deck, so slide index == section index. */
  source?: "markdown" | "slides" | "import" | "screen";
  /** Target length of the whole talk in minutes ("<!-- target: 20 min -->"), for the talk timer. */
  minutes?: number;
};

/**
 * When the take started and which section showed when (rehearsal-timer.ts). Kept by the prompter
 * that runs the take, not by the engine, and sent with the state so the phone mirror shows the same
 * timer. Times are epoch ms on the prompter's computer.
 */
export type TalkClock = {
  startedAt: number | null;
  /** set when the take stopped; the timer then stays still */
  endedAt: number | null;
  /** every section shown during the take, in order; the first is the one showing at the start */
  entries: Array<{ idx: number; at: number }>;
  /** the prompter's time when this was sent, so a phone whose clock differs can line up */
  sentAt: number;
};

export type PointStatus = "waiting" | "started" | "missed";
/** @deprecated use PointStatus */
export type BulletStatus = PointStatus;

export type PointState = {
  status: PointStatus;
  /** 0..1, last reported by the decision model */
  confidence: number;
  startedAt?: number;
  /**
   * The speech in progress (partial STT text, not yet committed) seems to be about this point. A hint
   * for the UI only: partial text never flips a point. Cleared by the model's next answer about it.
   */
  active?: boolean;
  /** Why the point is done ("why is this done?" in the UI): set by every flip and manual mark. */
  evidence?: Evidence;
};

/**
 * What a "done" point rests on. Times are on the engine clock (epoch ms in the app, talk time in the
 * gauntlet): when the STT committed the first and the last words of the quote, or when the presenter
 * marked the point by hand.
 */
export type Evidence =
  | {
      source: "model";
      /** the committed sentence the flip rests on: the one sharing most of the point's words, or the latest segment */
      quote: string;
      fromMs: number;
      toMs: number;
      /** decision model confidence of the answer that flipped the point */
      decision: number;
      /** embedding similarity of the transcript tail, when the pre-filter ran */
      gate?: number;
      /** share of the point's words found in the quote (fuzzy), 0..1 */
      lexical: number;
      model: string;
      /** answers of the verification that let the point tick, when the provider verifies (api.ts, Verification) */
      verified?: { real: number; sameParty: number };
    }
  | { source: "manual"; fromMs: number; toMs: number };
/** @deprecated use PointState */
export type BulletState = PointState;

export type SttBackendId = "browser" | "elevenlabs" | "openai" | "whisper" | "sherpa";

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
  engine: { backend: SttBackendId | null; recording: boolean; error?: string; /** set while the decision model answers slower than the tick (ms per call) */ slowMs?: number; /** set while the decision model is loaded again after it left memory mid-take (EngineOptions.reload) */ reloading?: boolean };
  slide?: { index: number; total: number; title?: string };
  screen?: ScreenSummary | null;
  /** On-screen facts the decision model says were not said yet (gap detector). */
  unmentioned?: string[];
  /** Vision calls and their cost, counted in stats.costUsd too. */
  screenStats?: { frames: number; costUsd: number | null; analysing: boolean };
  /** The talk timer's clock, added by the prompter when it publishes the state (never set by the engine). */
  clock?: TalkClock;
  /** The point the presenter last said they are on (the "anchor" command); see currentPoint() in anchor.ts. */
  here?: string;
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
  | { type: "forgetScreen" }
  /**
   * The presenter says where they are (a click on a point or a section, a clicker key, a section's
   * name said aloud). `pointId`: the point they are on. `keep`: "recent" keeps the last seconds of
   * speech for the new place (Next: people often start the next part before pressing), "all" keeps
   * everything (going back after a move made by mistake). Engine.anchor() has the rules.
   */
  | { type: "anchor"; idx: number; pointId?: string; keep?: "recent" | "all" }
  /**
   * A typed question for OK Filow from a paired phone (the mirror's "Ask OK Filow" box). Not the
   * engine's: the session server relays it only from a controller the presenter allowed to ask, with
   * the device it came from; the desktop app's main window hands it to OK Filow's panel, which asks
   * the presenter on the PC before anything happens (phone-ask.ts has the rules).
   */
  | { type: "askOkFilow"; text: string };

/** Who sent a command: the session server adds it to every command it relays from a paired device. */
export type CommandFrom = { id: string; device: string };

export type CommandResult = { ok: true } | { ok: false; error: string };
