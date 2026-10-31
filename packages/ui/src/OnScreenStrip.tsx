"use client";

import type { ScreenSummary } from "@intelliprompter/core";

export type OnScreenStripProps = {
  screen: ScreenSummary;
  /** facts the decision model says were not said yet; rendered highlighted */
  unmentioned?: string[];
  analysing?: boolean;
  onLookNow?: () => void;
  onForget?: () => void;
};

/** The ON SCREEN strip (ARCHITECTURE.md §6.3): shows, points to make, facts, mismatch, or the unavailable reason. */
export function OnScreenStrip({ screen, unmentioned = [], analysing, onLookNow, onForget }: OnScreenStripProps) {
  return (
    <div className="strip onscreen">
      <div className="label">
        On screen{screen.title ? ` / ${screen.title}` : ""}
        {analysing ? " · analysing…" : ""}
      </div>
      {screen.unavailable ? (
        <div className="hint">{screenUnavailable(screen.unavailable)}</div>
      ) : (
        <>
          <div className="hint">{screen.shows}</div>
          {screen.pointsToMake.length > 0 && (
            <div className="row">
              {screen.pointsToMake.map((p, i) => (
                <span key={i} className="next-item">
                  ▸ {p}
                </span>
              ))}
            </div>
          )}
          {screen.facts.length > 0 && (
            <div className="row">
              {screen.facts.map((f, i) => (
                <span key={i} className={`fact ${unmentioned.includes(f) ? "unsaid" : ""}`} title={unmentioned.includes(f) ? "On the slide, not said yet" : ""}>
                  {unmentioned.includes(f) ? "! " : ""}
                  {f}
                </span>
              ))}
            </div>
          )}
          {screen.mismatch && <div className="chip err">{screen.mismatch}</div>}
        </>
      )}
      {(onLookNow || onForget) && (
        <div className="row actions">
          {onLookNow && (
            <button className="btn" onClick={onLookNow}>
              Look now
            </button>
          )}
          {onForget && (
            <button className="btn" onClick={onForget} title="Drop every screen summary and note from this session">
              Forget screen context
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function screenUnavailable(reason: NonNullable<ScreenSummary["unavailable"]>) {
  switch (reason) {
    case "no-screen-selected":
      return "No screen selected. Pick a screen, window or region to watch.";
    case "could-not-read":
      return "Could not read the screen.";
    case "capped":
      return "Frame cap reached for this minute.";
    case "disabled":
      return "Screen Sense is off (offline mode or disabled in Settings).";
    default:
      return "";
  }
}
