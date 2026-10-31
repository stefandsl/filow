"use client";

import { useEffect, useState } from "react";
import { useT } from "@intelliprompter/ui";
import type { SessionInfo } from "./useSession";
import { desktopBridge } from "@/lib/sessionUrl";

/** Shows the pairing code and a QR for the mirror URL. */
export function PairPanel({ info, status, error }: { info: SessionInfo | null; status: string; error: string | null }) {
  const t = useT();
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const bridge = desktopBridge();
  const publicLink = Boolean(bridge?.remoteShare);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    import("qrcode").then((QR) =>
      QR.toDataURL(info.mirrorUrl, { margin: 1, width: 220, color: { dark: "#f2f2f4", light: "#141418" } }).then((u) => {
        if (alive) setQr(u);
      }),
    );
    return () => {
      alive = false;
    };
  }, [info]);

  if (error)
    return (
      <span className="chip err" title={error}>
        {t("app.mirrorOff")}
      </span>
    );
  if (!info) return <span className="chip">{t("app.session")}</span>;

  return (
    <>
      <button className="chip code" onClick={() => setOpen((o) => !o)} title={t("pair.showQr")}>
        {t("app.pair")} {info.code} {status === "open" ? "●" : "○"}
      </button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal pairmodal" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t("pair.title")}</div>
            <div className="bigcode">{info.code}</div>
            {qr && <img src={qr} alt="QR" width={220} height={220} />}
            <div className="hint">
              {t("pair.hint", { url: info.mirrorUrl })}
              {status !== "open" && <> {t("pair.relay", { status })}</>}
            </div>
            <div className={`chip ${publicLink ? "live" : ""}`}>{bridge ? (publicLink ? t("pair.reachPublic") : t("pair.reachLan")) : t("pair.webHint")}</div>
            {bridge?.setRemoteShare && (
              <div className="hint">
                <button
                  className={`btn ${publicLink ? "" : "primary"}`}
                  disabled={switching}
                  title={publicLink ? "" : t("pair.enablePublicHint")}
                  onClick={() => {
                    setSwitching(true);
                    bridge.setRemoteShare?.(!publicLink);
                  }}
                >
                  {switching ? "…" : publicLink ? t("pair.disablePublic") : t("pair.enablePublic")}
                </button>
                {!publicLink && <> {t("pair.enablePublicHint")}</>}
              </div>
            )}
            <button className="btn" onClick={() => setOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
