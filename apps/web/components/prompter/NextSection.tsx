import { useId } from "react";
import { NextSectionResize } from "./NextSectionResize";
import { useT } from "@filow/ui";
import { sectionLabel } from "./sectionLabel";
export function NextSection({ title, points, completed = [] }: {title: string; points: string[]; completed?: boolean[]}) {
  const t = useT();
  const id = useId();
  const heading = sectionLabel(title);
  return <section className="next-section"><div className="next-section-content" id={id} tabIndex={0} role="group" aria-label={t("next.label")}><div className="label">{t("next.label")}{heading.label && ` · ${heading.label}`}</div><h2>{heading.title}</h2>
    <ul>{points.map((text,i) => <li key={i} className={completed[i] ? "done" : undefined}>{text}</li>)}</ul>
    </div><NextSectionResize controls={id} />
  </section>;
}
