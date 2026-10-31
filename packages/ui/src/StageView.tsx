"use client";

import type { Command, SessionState } from "@intelliprompter/core";
import { missedPoints } from "@intelliprompter/core";

export type StageViewProps = {
  state: SessionState;
  /** Omit to render a read-only view. */
  onCommand?: (cmd: Command) => void;
  /** "engine offline" and similar, rendered as a banner. */
  banner?: string | null;
  /** Big-type stage mode (phone / mirror). */
  stage?: boolean;
};

/** The live view: section, points, next strip, missed tray, on-screen strip, remote buttons. Uses the app's CSS classes. */
export function StageView({ state, onCommand, banner, stage }: StageViewProps) {
  const { script, sectionIdx, points, stats, engine, screen } = state;
  const section = script.sections[sectionIdx];
  const nextSection = script.sections[sectionIdx + 1];
  const missed = missedPoints(state);
  const send = onCommand ?? (() => undefined);
  const can = Boolean(onCommand);

  return (
    <div className={`app ${stage ? "stage" : ""}`}>
      {banner && <div className="chip err banner">{banner}</div>}

      {section ? (
        <>
          <div>
            <div className="section-count">
              Section {sectionIdx + 1} / {script.sections.length}
              {state.slide ? ` · slide ${state.slide.index + 1}/${state.slide.total}` : ""}
            </div>
            <h1 className="section-title">{section.title}</h1>
          </div>

          {screen && (
            <div className="strip onscreen">
              <div className="label">On screen{screen.title ? ` / ${screen.title}` : ""}</div>
              {screen.unavailable ? (
                <div className="hint">{screenUnavailable(screen.unavailable)}</div>
              ) : (
                <>
                  <div className="hint">{screen.shows}</div>
                  <div className="row">
                    {screen.pointsToMake.map((p, i) => (
                      <span key={i} className="next-item">▸ {p}</span>
                    ))}
                  </div>
                  {screen.facts.length > 0 && (
                    <div className="row">
                      {screen.facts.map((f, i) => (
                        <span key={i} className="missed-item">{f}</span>
                      ))}
                    </div>
                  )}
                  {screen.mismatch && <div className="chip err">{screen.mismatch}</div>}
                </>
              )}
            </div>
          )}

          <div className="points">
            {section.bullets.map((b) => {
              const st = points[b.id] ?? { status: "waiting", confidence: 0 };
              const started = st.status === "started";
              const hot = !started && st.confidence >= 0.3;
              return (
                <div
                  key={b.id}
                  className={`point ${started ? "started" : ""} ${hot ? "hot" : ""}`}
                  onDoubleClick={can ? () => send(started ? { type: "reopen", id: b.id } : { type: "markStarted", id: b.id }) : undefined}
                >
                  <span className="mark">{started ? "✓" : ""}</span>
                  <span className="status">
                    {st.status}
                    {!started && <span className="pct">· {Math.round(st.confidence * 100)}%</span>}
                  </span>
                  <span className="text">{b.text}</span>
                </div>
              );
            })}
          </div>

          {nextSection && (
            <div className="strip">
              <div className="label">Next / {nextSection.title}</div>
              <div className="row">
                {nextSection.bullets.map((b) => (
                  <span key={b.id} className={`next-item ${points[b.id]?.status === "started" ? "done" : ""}`}>
                    ○ {b.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {missed.length > 0 && (
            <div className="strip">
              <div className="label">▾ ! Missed {missed.length}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span key={b.id} className="missed-item" onClick={can ? () => send({ type: "reopen", id: b.id }) : undefined}>
                    ! MISSED · {b.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="strip">
          <div className="label">No script</div>
          <div>Waiting for the engine to load a script.</div>
        </div>
      )}

      {can && (
        <div className="controls">
          <button className="btn" onClick={() => send({ type: "prevSection" })} disabled={sectionIdx === 0}>
            ← Prev
          </button>
          <button className="btn primary" onClick={() => send({ type: "nextSection" })} disabled={!nextSection}>
            Next →
          </button>
          <button className="btn" onClick={() => send({ type: "resetSection" })}>
            Reset
          </button>
          {engine.recording ? (
            <button className="btn danger" onClick={() => send({ type: "stopTake" })}>
              Stop take
            </button>
          ) : (
            <button className="btn" onClick={() => send({ type: "startTake" })}>
              Start take
            </button>
          )}
        </div>
      )}

      <div className="footer">
        <span>
          {engine.recording ? "● live" : "○ idle"} · Calls {stats.calls} · Avg {stats.avgMs} ms · Cost{" "}
          {stats.costUsd === null ? "n/a" : `$${stats.costUsd.toFixed(4)}`}
        </span>
        <span className="transcript">
          <span>{state.transcriptTail || "…"}</span>
        </span>
      </div>
    </div>
  );
}

function screenUnavailable(reason: NonNullable<SessionState["screen"]>["unavailable"]) {
  switch (reason) {
    case "no-screen-selected":
      return "No screen selected. Pick a screen, window or region to watch.";
    case "could-not-read":
      return "Could not read the slide.";
    case "capped":
      return "Frame cap reached for this minute.";
    case "disabled":
      return "Screen Sense is off.";
    default:
      return "";
  }
}
