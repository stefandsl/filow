import { useT } from "@filow/ui";
import { Icon } from "../icons";
import type { MoveNotice } from "./useReanchor";

/**
 * After a move made by voice: which section Filow moved to and why, with a way back in case the
 * name only came up in passing. The live region is always present so the message is announced.
 */
export function ReanchorNotice({ notice, onUndo, onDismiss }: { notice: MoveNotice | null; onUndo(): void; onDismiss(): void }) {
  const t = useT();
  return <div className="reanchor-region" role="status" aria-live="polite">
    {notice && <div className="reanchor-notice">
      <span>{t("here.movedByVoice", { title: notice.title })}</span>
      <button type="button" className="btn small" onClick={onUndo}><Icon name="left" /> {t("here.goBack")}</button>
      <button type="button" className="btn small icon-only" onClick={onDismiss} aria-label={t("here.dismiss")} title={t("here.dismiss")}><Icon name="close" /></button>
    </div>}
  </div>;
}
