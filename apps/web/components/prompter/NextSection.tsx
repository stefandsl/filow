import { useT } from "@filow/ui";
import type { PrompterLayout } from "../../lib/layout";
import { sectionLabel } from "./sectionLabel";
export function NextSection({ title, points, completed = [] }: {title: string; points: string[]; layout: PrompterLayout; completed?: boolean[]}) {
  const t = useT();
  const heading = sectionLabel(title);
  return <section className="next-section"><div className="label">{t("next.label")}{heading.label && ` · ${heading.label}`}</div><h2>{heading.title}</h2>
    <ul>{points.map((text,i) => <li key={i} className={completed[i] ? "done" : undefined}>{text}</li>)}</ul>
  </section>;
}
