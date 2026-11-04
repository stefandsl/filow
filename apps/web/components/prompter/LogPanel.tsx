import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useT } from "@filow/ui";
import { Icon } from "../icons";

export function closeLogPanel(trigger: Pick<HTMLElement, "focus"> | null, onClose: () => void) {
  trigger?.focus();
  onClose();
}

export function LogPanel({ triggerRef, onClose, children }: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div className="log" ref={ref} tabIndex={-1} aria-label={t("ctl.logReport")}>
    <button type="button" className="btn small" onClick={() => closeLogPanel(triggerRef.current, onClose)} aria-label={t("common.close")}><Icon name="close" /></button>
    {children}
  </div>;
}
