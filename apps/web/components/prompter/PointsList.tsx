import { useT } from "@filow/ui";
import { Icon } from "../icons";
import type { PrompterLayout } from "../../lib/layout";
import type { PointState } from "../../lib/pointState";
export function PointsList({ points, onToggle }: {
  points: {id: string; text: string; state: PointState; confidence: number}[];
  layout: PrompterLayout; onToggle?(id: string): void;
}) {
  const t = useT();
  return <div className="points prompter-points">{points.map((point, i) => {
    const percent = point.state === "done" ? 100 : point.state === "waiting" ? 0 : Math.round(Math.max(0, Math.min(1, point.confidence)) * 100);
    const icon = point.state === "done" ? "check" : point.state === "active" ? "circle" : "clock";
    const label = t(`state.${point.state}`);
    return <div key={point.id} className={`point point-row ${point.state}`} data-state={point.state}
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
    </div>;
  })}</div>;
}
