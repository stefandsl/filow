"use client";

import type { ReactNode } from "react";
import { Icon } from "../../../apps/web/components/icons";
import type { Command, SessionState } from "@filow/core";
import { evidenceSummary, missedPoints } from "@filow/core";
import { OnScreenStrip } from "./OnScreenStrip";
import { useLang, useT } from "./lang";

export type StageViewProps = {
  state: SessionState;
  pointMark?: ReactNode;
  previewMark?: ReactNode;
  /** Omit to render a read-only view. */
  onCommand?: (cmd: Command) => void;
  /** "engine offline" and similar, rendered as a banner. */
  banner?: string | null;
  /** Big-type stage mode (phone / mirror). */
  stage?: boolean;
  /** Overlay mode: title, points and the next title only; no controls, no footer. */
  compact?: boolean;
};

/** The live view: section, points, next strip, missed tray, on-screen strip, remote buttons. Uses the app's CSS classes. */
export function StageView({ state, onCommand, banner, stage, compact, pointMark = <Icon name="check" />, previewMark = <Icon name="circle" /> }: StageViewProps) {
  const t = useT();
  const lang = useLang();
  const { script, sectionIdx, points, stats, engine, screen } = state;
  const section = script.sections[sectionIdx];
  const nextSection = script.sections[sectionIdx + 1];
  const missed = missedPoints(state);
  const send = onCommand ?? (() => undefined);
  const can = Boolean(onCommand);

  return (
    <div className={`app ${stage ? "stage" : ""} ${compact ? "compact" : ""}`}>
      {banner && <div className="chip err banner">{banner}</div>}

      {section ? (
        <>
          <div>
            <div className="section-count">
              {t("stage.section", { n: sectionIdx + 1, total: script.sections.length })}
              {state.slide ? ` · ${t("stage.slide", { n: state.slide.index + 1, total: state.slide.total })}` : ""}
            </div>
            <h1 className="section-title">{section.title}</h1>
          </div>

          {screen && !compact && (
            <OnScreenStrip
              screen={screen}
              unmentioned={state.unmentioned}
              analysing={state.screenStats?.analysing}
              onLookNow={can ? () => send({ type: "lookNow" }) : undefined}
              onForget={can ? () => send({ type: "forgetScreen" }) : undefined}
            />
          )}

          <div className="points">
            {section.bullets.map((b, i) => {
              const st = points[b.id] ?? { status: "waiting", confidence: 0 };
              const started = st.status === "started";
              const hot = !started && (st.confidence >= 0.3 || st.active === true);
              return (
                <div
                  key={b.id}
                  className={`point ${i >= 10 && !compact ? "far" : ""} ${started ? "started" : ""} ${hot ? "hot" : ""}`}
                  onDoubleClick={can ? () => send(started ? { type: "reopen", id: b.id } : { type: "markStarted", id: b.id }) : undefined}
                  role={can ? "button" : undefined}
                  tabIndex={can ? 0 : undefined}
                  aria-pressed={can ? started : undefined}
                  title={started && st.evidence ? evidenceSummary(st.evidence, lang) : undefined}
                  aria-description={started && st.evidence ? evidenceSummary(st.evidence, lang) : undefined}
                  onKeyDown={can ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      send(started ? { type: "reopen", id: b.id } : { type: "markStarted", id: b.id });
                    }
                  } : undefined}
                >
                  <span className="mark">{started ? pointMark : null}</span>
                  <span className="status">
                    {t(`status.${st.status}`)}
                    {!started && <span className="pct">· {Math.round(st.confidence * 100)}%</span>}
                  </span>
                  <span className="text">{b.text}</span>
                </div>
              );
            })}
          </div>

          {nextSection && (
            <div className="strip preview">
              <div className="label">{t("stage.next", { title: nextSection.title })}</div>
              <div className="row">
                {nextSection.bullets.map((b) => (
                  <span key={b.id} className={`next-item ${points[b.id]?.status === "started" ? "done" : ""}`}>
                    {previewMark} {b.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {missed.length > 0 && !compact && (
            <div className="strip">
              <div className="label">{t("stage.missed", { n: missed.length })}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span key={b.id} className="missed-item" onClick={can ? () => send({ type: "reopen", id: b.id }) : undefined}
                    role={can ? "button" : undefined} tabIndex={can ? 0 : undefined}
                    onKeyDown={can ? (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); send({ type: "reopen", id: b.id }); }
                    } : undefined}>
                    {t("stage.missedItem", { text: b.text })}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="strip">
          <div className="label">{t("stage.noScript")}</div>
          <div>{t("stage.waitingEngine")}</div>
        </div>
      )}

      {can && !compact && (
        <div className="controls">
          <button className="btn" onClick={() => send({ type: "prevSection" })} disabled={sectionIdx === 0}>
            {t("ctl.prevShort")}
          </button>
          <button className="btn primary" onClick={() => send({ type: "nextSection" })} disabled={!nextSection}>
            {t("ctl.nextShort")}
          </button>
          <button className="btn" onClick={() => send({ type: "resetSection" })}>
            {t("ctl.resetShort")}
          </button>
          {engine.recording ? (
            <button className="btn danger" onClick={() => send({ type: "stopTake" })}>
              {t("ctl.stop")}
            </button>
          ) : (
            <button className="btn" onClick={() => send({ type: "startTake" })}>
              {t("ctl.start")}
            </button>
          )}
        </div>
      )}

      {!compact && (
      <div className="footer">
        <span>
          {engine.recording ? t("stage.live") : t("stage.idle")} ·{" "}
          {t("footer.stats", { calls: stats.calls, avg: stats.avgMs, cost: stats.costUsd === null ? "n/a" : `$${stats.costUsd.toFixed(4)}` })}
        </span>
        <span className="transcript">
          <span>{state.transcriptTail || "…"}</span>
        </span>
      </div>
      )}
    </div>
  );
}
