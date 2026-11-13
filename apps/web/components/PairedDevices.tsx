"use client";
// The presenter's list of every paired device (the session server tells the engine about each one,
// apps/server/src/server.ts): where it came from, its pairing's short code (the same one OK Filow shows
// with that device's questions), what it may do, whether it is connected, the separate right to ask OK
// Filow (off by default, given here only) and Revoke, which disconnects it at once. A phone that joined
// on the Wi-Fi without the presenter's accept only moves between sections and marks points until
// "Allow full control" is pressed here.
import type { PairedDevice } from "@filow/client";
import { useT } from "@filow/ui";
import { pairingFingerprint } from "@/lib/buddy/phoneAsk";

export function PairedDevices({ devices, onRevoke, onAllowAsk, onApprove }: { devices: PairedDevice[]; onRevoke: (id: string) => void; onAllowAsk: (id: string, allow: boolean) => void; onApprove?: (id: string) => void }) {
  const t = useT();
  return (
    <section className="paired-devices" aria-label={t("pair.devices")} data-testid="paired-devices">
      <div className="label">{t("pair.devices")}</div>
      {devices.length === 0 && <p className="hint">{t("pair.devicesNone")}</p>}
      <ul>
        {devices.map((d) => {
          const peer = t(d.peer === "app" ? "pair.peerApp" : d.peer === "lan" ? "pair.peerLan" : "pair.peerRemote");
          // Auto-accepted on the Wi-Fi, not accepted here yet: it moves and marks only (server REMOTE_BEFORE_APPROVAL).
          const limited = d.role === "controller" && d.peer !== "app" && d.approved === false;
          const role = limited ? t("pair.limited") : t(d.role === "controller" ? "pair.roleController" : d.role === "viewer" ? "pair.roleViewer" : "pair.rolePending");
          // Asking is for a phone that controls; the app's own windows never ask.
          const askable = d.role === "controller" && d.peer !== "app";
          return (
            <li key={d.id} className="paired-device" data-device={d.id} data-approved={d.approved === false ? "no" : "yes"}>
              <div className="paired-device-head">
                <span className={`dot ${d.connected ? "live" : ""}`} aria-hidden="true" />
                <span className="paired-device-name">{d.device}</span>
                {d.peer !== "app" && <code className="paired-device-fp" title={t("pair.fingerprintTitle")}>{pairingFingerprint(d.id)}</code>}
                <span className="hint">{peer} · {role} · {t(d.connected ? "pair.connected" : "pair.away")}</span>
              </div>
              <div className="paired-device-actions">
                {limited && onApprove && (
                  <button type="button" className="btn" data-testid="approve-device" onClick={() => onApprove(d.id)} title={t("pair.approveTitle", { device: d.device })}>
                    {t("pair.approve")}
                  </button>
                )}
                {askable && (
                  <label className="paired-device-ask" title={t("pair.canAskHint")}>
                    <input type="checkbox" checked={d.canAsk} onChange={(e) => onAllowAsk(d.id, e.target.checked)} />
                    <span>{t("pair.canAsk")}</span>
                  </label>
                )}
                {d.peer !== "app" && (
                  <button type="button" className="btn danger" onClick={() => onRevoke(d.id)} title={t("pair.revokeTitle", { device: d.device })}>
                    {t("pair.revoke")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {devices.some((d) => d.role === "controller" && d.peer !== "app") && <p className="hint">{t("pair.canAskHint")}</p>}
    </section>
  );
}
