"use client";

import type { ScreenSummary } from "@filow/core";
import { useT } from "./lang";

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
  const t = useT();
  return (
    <div className="strip onscreen">
      <div className="label">
        {t("screen.onScreen")}
        {screen.title ? ` / ${screen.title}` : ""}
        {analysing ? ` · ${t("app.analysing")}` : ""}
      </div>
      {screen.unavailable ? (
        <div className="hint">{t(`screen.unavailable.${screen.unavailable}`)}</div>
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
                <span key={i} className={`fact ${unmentioned.includes(f) ? "unsaid" : ""}`} title={unmentioned.includes(f) ? t("screen.unsaid") : ""}>
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
              {t("screen.lookNow")}
            </button>
          )}
          {onForget && (
            <button className="btn" onClick={onForget} title={t("screen.forgetTitle")}>
              {t("screen.forgetLong")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
