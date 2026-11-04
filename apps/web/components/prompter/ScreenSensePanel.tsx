import type { ReactNode } from "react";
import { useT } from "@filow/ui";
import { Icon } from "../icons";
import type { PrompterLayout } from "../../lib/layout";
export function ScreenSensePanel({active, children}: {layout: PrompterLayout; active: boolean; children: ReactNode}) {
 const t = useT();
 return <section className="screen-sense"><div className="screen-heading"><strong>{t("screen.label")}</strong>
   <span className={`chip ${active ? "live" : ""}`}><Icon name={active ? "circle" : "stop"} /> {t(active ? "stage.live" : "stage.idle")}</span></div>
   <div className="screen-controls">{children}</div></section>;
}
