"use client";
import { Icon } from "./icons";

import { useEffect, useState } from "react";
import { useT } from "@filow/ui";
import type { SessionInfo } from "./useSession";
import { desktopBridge, type NetStatus } from "@/lib/sessionUrl";
import { consumeReopenPairing, markReopenPairing } from "@/lib/pairReopen";
import { publicLinkOn, useRemoteStatus } from "@/lib/useRemoteStatus";
import type { PairedDevice } from "@filow/client";
import { PairedDevices } from "./PairedDevices";

/** Tell the desktop shell the pairing panel is open, so it brings the phone link up (a shell without it started the link at launch). */
export function announcePairing(bridge: Pick<NonNullable<ReturnType<typeof desktopBridge>>, "pairingOpened"> | null | undefined): void {
  bridge?.pairingOpened?.();
}

/** Shows the pairing code and a QR for the mirror URL. */
export function PairPanel({ info, status, error, onNewCode, prompter = false, devices, onRevoke, onAllowAsk, onApprove }: { info: SessionInfo | null; status: string; error: string | null; onNewCode?: () => void; prompter?: boolean; devices?: PairedDevice[]; onRevoke?: (id: string) => void; onAllowAsk?: (id: string, allow: boolean) => void; onApprove?: (id: string) => void }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Reopen after the reload that switching the public link triggers.
  useEffect(() => {
    if (consumeReopenPairing()) setOpen(true);
  }, []);
  const [switching, setSwitching] = useState(false);
  const [net, setNet] = useState<NetStatus | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const bridge = desktopBridge();
  // Live: the link comes up after the window opens, and the panel follows it without a reload.
  const remote = useRemoteStatus();
  const publicLink = publicLinkOn(remote);
  useEffect(() => {
    if (!open || !bridge?.net) return;
    void bridge.net.status().then(setNet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The link for a phone on another network starts when this panel opens, never at launch.
  useEffect(() => {
    if (open) announcePairing(bridge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const pending = remote?.state === "downloading" || remote?.state === "connecting";

  // The QR carries the current code; it is rebuilt whenever the code changes.
  const mirrorUrl = info ? info.mirrorUrl.replace(/code=[A-Za-z0-9]+/, `code=${info.code}`) : "";
  // Paired phones and other devices (not the app's own windows): counted on the button, listed in the panel.
  const others = (devices ?? []).filter((d) => d.peer !== "app");
  useEffect(() => {
    if (!info) return;
    let alive = true;
    import("qrcode").then((QR) =>
      QR.toDataURL(mirrorUrl, { margin: 1, width: 220, color: { dark: "#f7f7f5", light: "#13151a" } }).then((u) => {
        if (alive) setQr(u);
      }),
    );
    return () => {
      alive = false;
    };
  }, [info, mirrorUrl]);

  // Countdown while the dialog is open; a fresh code when the old one runs out.
  // Escape closes the pairing panel, like every other dialog of the prompter.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [open]);
  const left = info?.codeExpiresAt ? Math.max(0, Math.floor((info.codeExpiresAt - now) / 1000)) : null;
  useEffect(() => {
    if (open && left === 0) onNewCode?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, left === 0]);

  if (error && !prompter)
    return (
      <span className="chip err" title={error}>
        {t("app.mirrorOff")}
      </span>
    );
  if (!info && !prompter) return <span className="chip">{t("app.session")}</span>;

  return (
    <>
      <button className={`${prompter ? "btn" : "chip code"} ${pending ? "busy" : ""}`} onClick={() => setOpen((o) => !o)} title={t("pair.showQr")}>
        {prompter && <Icon name="system" />} {t(prompter ? "pair.device" : "app.pair")} {!prompter && info && <span className="pair-code">{info.code}</span>} {pending ? "\u2026" : !prompter && <Icon name="circle" />}
      </button>
      {prompter && info && <button className="chip code" onClick={() => setOpen(true)} title={t("pair.showQr")}>{info.code}</button>}
      {others.length > 0 && <button className="chip live" onClick={() => setOpen(true)} title={t("pair.devices")}>{t("pair.devicesCount", { n: others.length })}</button>}
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal pairmodal" role="dialog" aria-label={t("pair.title")} onClick={(e) => e.stopPropagation()}>
            <div className="label">{t("pair.title")}</div>
            {error && <p className="hint" role="status">{t("app.mirrorOff")}: {error}</p>}
            {info && <div className="bigcode">{info.code}</div>}
            {info && qr && <img src={qr} alt="QR" width={220} height={220} />}
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
            {/* Every paired device, right under the code: who is connected and what each may do, with Revoke. */}
            {devices && onRevoke && onAllowAsk && <PairedDevices devices={devices} onRevoke={onRevoke} onAllowAsk={onAllowAsk} onApprove={onApprove} />}
            <div className="hint">
              {info && <>{t("pair.hint", { url: mirrorUrl })} {t("pair.singleUse")}</>}
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
            {net && !publicLink && (
              <div className="hint netline">
                <div>
                  {t("pair.netIface", { ip: net.ip, iface: net.iface || "?" })}
                  {net.virtual && <span className="chip err"> {t("pair.netVirtual")}</span>}
                  {net.firewall === "missing" && <span className="chip err"> {t("pair.firewallMissing")}</span>}
                  {net.firewall === "ok" && <span className="chip live"> {t("pair.firewallOk")}</span>}
                </div>
                <div className="row">
                  {net.interfaces.length > 1 && (
                    <select
                      className="btn"
                      value={net.ip}
                      onChange={(e) => {
                        void bridge?.net?.useInterface(e.target.value);
                      }}
                      title={t("pair.netPickTitle")}
                    >
                      {net.interfaces.map((i) => (
                        <option key={i.address} value={i.address}>
                          {i.address} · {i.name}
                          {i.virtual ? ` · ${t("pair.netVirtual")}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {net.firewall === "missing" && (
                    <button
                      className="btn primary"
                      disabled={netBusy}
                      onClick={() => {
                        setNetBusy(true);
                        void bridge?.net?.allowFirewall().then(() => bridge?.net?.status().then(setNet)).finally(() => setNetBusy(false));
                      }}
                    >
                      {netBusy ? "…" : t("pair.firewallAllow")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {bridge?.setRemoteShare && !pending && (
              <div className="hint">
                <button
                  className={`btn ${publicLink ? "" : "primary"}`}
                  disabled={switching}
                  title={publicLink ? "" : t("pair.enablePublicHint")}
                  onClick={() => {
                    setSwitching(true);
                    markReopenPairing();
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
