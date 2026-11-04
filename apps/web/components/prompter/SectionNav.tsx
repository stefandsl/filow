import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "@filow/ui";
import type { PrompterLayout } from "../../lib/layout";
export function SectionNav({ sections, current, onSelect, layout, importAction, reloadAction }: {
  sections: { id: string; title: string }[]; current: number; onSelect(index: number): void;
  layout: PrompterLayout; importAction: ReactNode; reloadAction?: ReactNode;
}) {
  const t = useT();
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [current, layout]);
  return <nav className="section-nav" aria-label={t("editor.title")}>
    <div className="nav-heading"><strong>{t("editor.title")}</strong><span>{t("stage.section", {n: current + 1, total: sections.length})}</span></div>
    <div className="section-nav-list">
      {sections.map((section, index) => <button type="button" key={section.id} data-section-index={index}
        ref={index === current ? active : undefined} aria-current={index === current ? "true" : undefined}
        className="section-link" title={section.title} onClick={() => onSelect(index)}>
        <span className="section-number">{String(index + 1).padStart(2, "0")}</span><span className="section-name">{section.title}</span>
      </button>)}
    </div>
    <div className="nav-actions">{importAction}<span className="sidebar-only">{reloadAction}</span></div>
  </nav>;
}
