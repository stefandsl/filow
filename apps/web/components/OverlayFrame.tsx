"use client";

import type { ReactNode } from "react";
import { useT } from "@filow/ui";
import { Icon } from "./icons";

/**
 * The presenter overlay is a frameless, always-on-top window: without this bar it has no title bar,
 * no Windows close button and nothing to drag. Every state of the mirror page renders through it, so
 * the code-entry and waiting screens can be moved and closed too, not only the connected view.
 */
export function OverlayFrame({ overlay, onClose, children }: { overlay: boolean; onClose: () => void; children: ReactNode }) {
  const t = useT();
  if (!overlay) return <>{children}</>;
  return (
    <div className="overlay">
      <div className="overlay-bar">
        <span className="drag"><Icon name="grip" /> Filow</span>
        <button type="button" className="chip" onClick={onClose} title={t("overlay.close")} aria-label={t("overlay.close")}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </div>
  );
}
