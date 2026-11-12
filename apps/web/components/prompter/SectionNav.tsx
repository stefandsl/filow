import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "@filow/ui";
import { sectionLabel } from "./sectionLabel";
/** `toolActions` (Display, Whiteboard) sit first in the block of buttons at the foot of the sidebar, above Import and Reload. */
export function SectionNav({ sections, current, onSelect, toolActions, importAction, reloadAction }: {
  sections: { id: string; title: string }[]; current: number; onSelect(index: number): void;
  toolActions?: ReactNode; importAction: ReactNode; reloadAction?: ReactNode;
}) {
  const t = useT();
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [current]);
  return <nav className="section-nav" aria-label={t("nav.scriptTitle")}>
    <div className="nav-heading"><strong>{t("nav.scriptTitle")}</strong><span>{t("nav.sections", {n: sections.length})}</span></div>
    <div className="section-nav-list">
      {sections.map((section, index) => <button type="button" key={section.id} data-section-index={index}
        ref={index === current ? active : undefined} aria-current={index === current ? "true" : undefined}
        className="section-link" title={section.title} onClick={() => onSelect(index)}>
        <span className="section-number">{String(index + 1).padStart(2, "0")}</span><span className="section-name">{sectionLabel(section.title).label || section.title}</span>
      </button>)}
    </div>
    <div className="nav-actions">{toolActions}{importAction}{reloadAction}</div>
  </nav>;
}
