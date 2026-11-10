import { useEffect, useRef, useState } from "react";
import { evidenceSummary, explainEvidence, type Evidence } from "@filow/core";
import { useLang, useT } from "@filow/ui";
import { Icon } from "../icons";
import type { PointState } from "../../lib/pointState";

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

export function WhyDone({ evidence, id, hidden }: { evidence: Evidence; id?: string; hidden?: boolean }) {
  const { title, quote, lines } = explainEvidence(evidence, useLang());
  return <div className="point-why" id={id} role="note" hidden={hidden}>
    <strong>{title}</strong>
    {quote && <q>{quote}</q>}
    {lines.map(l => <span key={l}>{l}</span>)}
  </div>;
}

/**
 * What a screen reader should hear after the list changed (A11Y-05, WCAG 4.1.3): the points that
 * turned done, as "Said: <point>". A point that was not on screen before (another section) is not
 * news. Returns "" when a point was reopened (a region whose text does not change is not read again,
 * so the same point ticked a second time would stay silent), and
 * null when nothing changed.
 */
export function saidAnnouncement(
  before: ReadonlyMap<string, PointState> | null,
  points: readonly { id: string; text: string; state: PointState }[],
  saidLabel: string,
): string | null {
  if (!before) return null;
  const fresh = points.filter(p => p.state === "done" && before.has(p.id) && before.get(p.id) !== "done");
  if (fresh.length) return fresh.map(p => `${saidLabel}: ${p.text}`).join(". ");
  return points.some(p => p.state !== "done" && before.get(p.id) === "done") ? "" : null;
}

/**
 * The points of the current section. Each point is an item: the row (which toggles the point, so it
 * holds no other control), then, for a done point with evidence, the "Why?" link and its panel as
 * siblings of the row. A polite live region, hidden from sight, tells a screen reader which point
 * was just ticked. With `onHere`, one click (or H on the focused row) says "I am on this point" and
 * `current` marks the point the presenter is on.
 */
export function PointsList({ points, onToggle, onHere, current }: {
  points: {id: string; text: string; state: PointState; confidence: number; evidence?: Evidence}[];
  onToggle?(id: string): void;
  onHere?(id: string): void;
  current?: string | null;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const before = useRef<Map<string, PointState> | null>(null);
  const saidLabel = t("state.done");
  useEffect(() => {
    const next = saidAnnouncement(before.current, points, saidLabel);
    before.current = new Map(points.map(p => [p.id, p.state]));
    if (next !== null) setSaid(next);
  }, [points, saidLabel]);
  return <div className="points prompter-points"><div className="sr-only" role="status" aria-live="polite">{said}</div>{points.map((point, i) => {
    const percent = point.state === "done" ? 100 : point.state === "waiting" ? 0 : pct(point.confidence);
    const icon = point.state === "done" ? "check" : point.state === "active" ? "circle" : "clock";
    const label = t(`state.${point.state}`);
    const why = point.state === "done" && point.evidence ? point.evidence : null;
    const whyId = `why-${point.id}`;
    const isOpen = open === point.id;
    const here = current === point.id;
    return <div key={point.id} className={`point-item ${point.state}${why ? " has-why" : ""}${here ? " here" : ""}`}>
      <div className={`point point-row ${point.state}${here ? " here" : ""}`} data-state={point.state} data-point-id={point.id}
        role={onToggle ? "button" : undefined} aria-pressed={onToggle ? point.state === "done" : undefined} tabIndex={onToggle ? 0 : undefined}
        aria-current={here ? "step" : undefined}
        title={onToggle ? t(onHere ? "here.pointHelp" : "stage.toggle") : undefined}
        aria-keyshortcuts={onHere ? "H" : undefined}
        onClick={onHere ? () => onHere(point.id) : undefined}
        onDoubleClick={onToggle ? () => onToggle(point.id) : undefined}
        onKeyDown={onToggle || onHere ? e => {
          if (onToggle && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(point.id); }
          else if (onHere && (e.key === "h" || e.key === "H") && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); onHere(point.id); }
        } : undefined}>
        <span className="point-number">{String(i + 1).padStart(2, "0")}</span>        <span className="point-text">{point.text}</span>
        <span className="point-state"><span data-icon={icon}><Icon name={icon} /> {label}</span>
          <span className="point-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width: `${percent}%`}} /></span>
          <span className="point-percent">{percent}%</span>
        </span>
      </div>
      {why && <div className="point-why-bar">
        <button type="button" className="point-why-btn" title={evidenceSummary(why, lang)} aria-expanded={isOpen} aria-controls={whyId}
          onClick={() => setOpen(isOpen ? null : point.id)}>{t("why.button")}</button>
      </div>}
      {why && <WhyDone evidence={why} id={whyId} hidden={!isOpen} />}
    </div>;
  })}</div>;
}
