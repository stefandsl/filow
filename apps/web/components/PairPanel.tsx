"use client";

import { useEffect, useState } from "react";
import { useT } from "@intelliprompter/ui";
import type { SessionInfo } from "./useSession";
import { desktopBridge, type RemoteStatus } from "@/lib/sessionUrl";

/** Shows the pairing code and a QR for the mirror URL. */
export function PairPanel({ info, status, error, onNewCode }: { info: SessionInfo | null; status: string; error: string | null; onNewCode?: () => void }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const bridge = desktopBridge();
  const publicLink = Boolean(bridge?.remoteShare);

  useEffect(() => {
    if (!bridge?.remoteStatus) return;
    void bridge.remoteStatus().then(setRemote);
    return bridge.onRemoteStatus?.(setRemote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pending = remote?.state === "downloading" || remote?.state === "connecting";

  // The QR carries the current code; it is rebuilt whenever the code changes.
  const mirrorUrl = info ? info.mirrorUrl.replace(/code=\d{6}/, `code=${info.code}`) : "";
  useEffect(() => {
    if (!info) return;
    let alive = true;
    import("qrcode").then((QR) =>
      QR.toDataURL(mirrorUrl, { margin: 1, width: 220, color: { dark: "#f2f2f4", light: "#141418" } }).then((u) => {
        if (alive) setQr(u);
      }),
    );
    return () => {
      alive = false;
    };
  }, [info, mirrorUrl]);

  // Countdown while the dialog is open; a fresh code when the old one runs out.
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [open]);
  const left = info?.codeExpiresAt ? Math.max(0, Math.floor((info.codeExpiresAt - now) / 1000)) : null;
  useEffect(() => {
    if (open && left === 0) onNewCode?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, left === 0]);
  useEffect(() => {
    if (open && info?.codeExpiresAt && info.codeExpiresAt < Date.now()) onNewCode?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (error)
    return (
      <span className="chip err" title={error}>
        {t("app.mirrorOff")}
      </span>
    );
  if (!info) return <span className="chip">{t("app.session")}</span>;

  return (
    <>
      <button className={`chip code ${pending ? "busy" : ""}`} onClick={() => setOpen((o) => !o)} title={t("pair.showQr")}>
        {t("app.pair")} {info.code} {pending ? "…" : status === "open" ? "●" : "○"}
      </button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal pairmodal" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t("pair.title")}</div>
            <div className="bigcode">{info.code}</div>
            {qr && <img src={qr} alt="QR" width={220} height={220} />}
            <div className="row">
              {left !== null && (
                <span className={`chip ${left === 0 ? "err" : ""}`}>{left === 0 ? t("pair.expired") : t("pair.expires", { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</span>
              )}
              {onNewCode && (
                <button className="btn" onClick={onNewCode}>
                  {t("pair.newCode")}
                </button>
              )}
            </div>
            <div className="hint">
              {t("pair.hint", { url: mirrorUrl })} {t("pair.singleUse")}
              {status !== "open" && <> {t("pair.relay", { status })}</>}
            </div>
            <div className={`chip ${publicLink ? "live" : pending ? "busy" : remote?.state === "error" ? "err" : ""}`}>
              {!bridge
                ? t("pair.webHint")
                : publicLink
                  ? t("pair.reachPublic")
                  : remote?.state === "downloading"
                    ? t("pair.downloading")
                    : remote?.state === "connecting"
                      ? t("pair.connecting")
                      : remote?.state === "error"
                        ? t("pair.linkError", { error: remote.error })
                        : t("pair.reachLan")}
            </div>
            {bridge?.setRemoteShare && !pending && (
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
                  {switching ? "…" : publicLink ? t("pair.disablePublic") : remote?.state === "error" ? t("pair.retry") : t("pair.enablePublic")}
                </button>
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
