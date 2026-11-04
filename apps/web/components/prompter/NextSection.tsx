import { useT } from "@filow/ui";
import type { PrompterLayout } from "../../lib/layout";
export function NextSection({ title, points, completed = [] }: {title: string; points: string[]; layout: PrompterLayout; completed?: boolean[]}) {
  const t = useT();
  return <section className="next-section"><div className="label">{t("ctl.next")}</div><h2>{title}</h2>
    <ul>{points.map((text,i) => <li key={i} className={completed[i] ? "done" : undefined}>{text}</li>)}</ul>
  </section>;
}
