import { useState } from "react";
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
 * The points of the current section. Each point is an item: the row (which toggles the point, so it
 * holds no other control), then, for a done point with evidence, the "Why?" link and its panel as
 * siblings of the row.
 */
export function PointsList({ points, onToggle }: {
  points: {id: string; text: string; state: PointState; confidence: number; evidence?: Evidence}[];
  onToggle?(id: string): void;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState<string | null>(null);
  return <div className="points prompter-points">{points.map((point, i) => {
    const percent = point.state === "done" ? 100 : point.state === "waiting" ? 0 : pct(point.confidence);
    const icon = point.state === "done" ? "check" : point.state === "active" ? "circle" : "clock";
    const label = t(`state.${point.state}`);
    const why = point.state === "done" && point.evidence ? point.evidence : null;
    const whyId = `why-${point.id}`;
    const isOpen = open === point.id;
    return <div key={point.id} className={`point-item ${point.state}${why ? " has-why" : ""}`}>
      <div className={`point point-row ${point.state}`} data-state={point.state}
        role={onToggle ? "button" : undefined} aria-pressed={onToggle ? point.state === "done" : undefined} tabIndex={onToggle ? 0 : undefined}
        title={onToggle ? t("stage.toggle") : undefined}
        onDoubleClick={onToggle ? () => onToggle(point.id) : undefined}
        onKeyDown={onToggle ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(point.id); } } : undefined}>
        <span className="point-number">{String(i + 1).padStart(2, "0")}</span>
        <span className="point-text">{point.text}</span>
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
