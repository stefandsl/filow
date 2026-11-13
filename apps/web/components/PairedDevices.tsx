"use client";
// The presenter's list of every paired device (the session server tells the engine about each one,
// apps/server/src/server.ts): where it came from, what it may do, whether it is connected, the separate
// right to ask OK Filow (off by default, given here only) and Revoke, which disconnects it at once.
import type { PairedDevice } from "@filow/client";
import { useT } from "@filow/ui";

export function PairedDevices({ devices, onRevoke, onAllowAsk }: { devices: PairedDevice[]; onRevoke: (id: string) => void; onAllowAsk: (id: string, allow: boolean) => void }) {
  const t = useT();
  return (
    <section className="paired-devices" aria-label={t("pair.devices")} data-testid="paired-devices">
      <div className="label">{t("pair.devices")}</div>
      {devices.length === 0 && <p className="hint">{t("pair.devicesNone")}</p>}
      <ul>
        {devices.map((d) => {
          const peer = t(d.peer === "app" ? "pair.peerApp" : d.peer === "lan" ? "pair.peerLan" : "pair.peerRemote");
          const role = t(d.role === "controller" ? "pair.roleController" : d.role === "viewer" ? "pair.roleViewer" : "pair.rolePending");
          // Asking is for a phone that controls; the app's own windows never ask.
          const askable = d.role === "controller" && d.peer !== "app";
          return (
            <li key={d.id} className="paired-device" data-device={d.id}>
              <div className="paired-device-head">
                <span className={`dot ${d.connected ? "live" : ""}`} aria-hidden="true" />
                <span className="paired-device-name">{d.device}</span>
                <span className="hint">{peer} · {role} · {t(d.connected ? "pair.connected" : "pair.away")}</span>
              </div>
              <div className="paired-device-actions">
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
