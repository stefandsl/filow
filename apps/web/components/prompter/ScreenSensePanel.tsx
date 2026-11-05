import type { ReactNode } from "react";
import { useT } from "@filow/ui";
import { Icon } from "../icons";
export function ScreenSensePanel({active, children}: {active: boolean; children: ReactNode}) {
 const t = useT();
 return <section className="screen-sense"><div className="screen-heading"><strong>{t("screen.label")}</strong>
   <span className={`chip ${active ? "live" : ""}`}><Icon name={active ? "circle" : "stop"} /> {t(active ? "screen.active" : "screen.inactive")}</span></div>
   <div className="screen-controls">{children}</div></section>;
}
