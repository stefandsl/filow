import { useState } from "react";
import { evidenceSummary, explainEvidence, type Evidence } from "@filow/core";
import { useLang, useT } from "@filow/ui";
import { Icon } from "../icons";
import type { PointState } from "../../lib/pointState";

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

export function WhyDone({ evidence, id }: { evidence: Evidence; id?: string }) {
  const { title, quote, lines } = explainEvidence(evidence, useLang());
  return <div className="point-why" id={id} role="note">
    <strong>{title}</strong>
    {quote && <q>{quote}</q>}
    {lines.map(l => <span key={l}>{l}</span>)}
  </div>;
}

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
    const summary = why ? evidenceSummary(why, lang) : undefined;
    const whyId = `why-${point.id}`;
    return <div key={point.id} className={`point point-row ${point.state}`} data-state={point.state}
      role={onToggle ? "button" : undefined} aria-pressed={onToggle ? point.state === "done" : undefined} tabIndex={onToggle ? 0 : undefined}
      title={onToggle ? t("stage.toggle") : undefined}
      onDoubleClick={onToggle ? () => onToggle(point.id) : undefined}
      onKeyDown={onToggle ? e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(point.id); } } : undefined}>
      <span className="point-number">{String(i + 1).padStart(2, "0")}</span>
      <span className="point-text">{point.text}</span>
      <span className="point-state"><span data-icon={icon}><Icon name={icon} /> {label}</span>
        <span className="point-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width: `${percent}%`}} /></span>
        <span className="point-percent">{percent}%</span>
        {why && <button type="button" className="point-why-btn" title={summary} aria-expanded={open === point.id} aria-controls={whyId}
          onClick={e => { e.stopPropagation(); setOpen(open === point.id ? null : point.id); }}
          onDoubleClick={e => e.stopPropagation()}>{t("why.button")}</button>}
      </span>
      {why && open === point.id && <WhyDone evidence={why} id={whyId} />}
    </div>;
  })}</div>;
}
