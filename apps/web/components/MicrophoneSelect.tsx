"use client";
import { useEffect, useId, useState, type RefObject } from "react";
import { useT } from "@filow/ui";
import { getSelectedMic, listMicrophones, preopenMic, setSelectedMic, type Microphone } from "@filow/stt";

/** Shared by Settings and the take action bar. Selection is only read when capture opens. */
export function MicrophoneSelect({ compact = false, webSpeech = false, selectRef }: {
  compact?: boolean; webSpeech?: boolean; selectRef?: RefObject<HTMLSelectElement | null>;
}) {
  const t = useT();
  const id = useId();
  const [devices, setDevices] = useState<Microphone[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(false);
  const [granting, setGranting] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listMicrophones().then(items => {
        if (!active) return;
        setDevices(items);
        setError(false);
        setSelected(getSelectedMic() || "");
      }).catch(() => { if (active) setError(true); });
    };
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const grant = async () => {
    setGranting(true);
    setError(false);
    try { await preopenMic(); setDevices(await listMicrophones()); }
    catch { setError(true); }
    finally { setGranting(false); }
  };
  const missing = !!selected && !devices.some(d => d.deviceId === selected);
  return <div className={`microphone-picker${compact ? " compact" : ""}`}>
    <label htmlFor={id}>{t("mic.label")}</label>
    <select ref={selectRef} id={id} className="btn" value={missing ? "" : selected}
      title={t("mic.nextStart")} aria-describedby={webSpeech ? `${id}-note` : undefined}
      onChange={e => { setSelected(e.target.value); setSelectedMic(e.target.value || null); }}>
      <option value="" title={t("mic.nextStart")}>{t("mic.systemDefault")}</option>
      {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId} title={t("mic.nextStart")}>
        {d.label || t("mic.unnamed", { n: i + 1 })}{d.isDefault ? ` (${t("mic.defaultSuffix")})` : ""}
      </option>)}
    </select>
    {(!devices.length || devices.some(d => !d.label)) && <button type="button" className="btn" disabled={granting} onClick={() => void grant()}>{t("mic.showDevices")}</button>}
    {webSpeech && <span id={`${id}-note`} className="hint microphone-note">{t("mic.webSpeech")}</span>}
    {missing && <span className="hint microphone-note">{t("mic.fallback")}</span>}
    {error && <span className="hint microphone-note" role="alert">{t("mic.listError")}</span>}
  </div>;
}
