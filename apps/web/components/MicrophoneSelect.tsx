"use client";
import { useEffect, useId, useState, type RefObject } from "react";
import { useT } from "@filow/ui";
import { getSelectedMic, hasMicrophone, listMicrophones, micPickerState, preopenMic, setSelectedMic, type Microphone } from "@filow/stt";

/** Shared by Settings and the take action bar. Selection is only read when capture opens. */
export function MicrophoneSelect({ compact = false, webSpeech = false, selectRef }: {
  compact?: boolean; webSpeech?: boolean; selectRef?: RefObject<HTMLSelectElement | null>;
}) {
  const t = useT();
  const id = useId();
  const [devices, setDevices] = useState<Microphone[]>([]);
  // Assume a microphone until the list says otherwise, so "none" never flashes on a PC that has one.
  const [anyInput, setAnyInput] = useState(true);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(false);
  const [granting, setGranting] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([listMicrophones(), hasMicrophone()]).then(([items, any]) => {
        if (!active) return;
        setDevices(items);
        setAnyInput(any);
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
  const state = micPickerState(anyInput, devices);
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
    {state === "ask" && <button type="button" className="btn" disabled={granting} onClick={() => void grant()}>{t("mic.showDevices")}</button>}
    {/* Same state as the welcome's microphone step; plugging one in refreshes the list (devicechange). */}
    {state === "none" && <span className="hint microphone-note" role="status">{t("mic.notFound")}</span>}
    {webSpeech && <span id={`${id}-note`} className="hint microphone-note">{t("mic.webSpeech")}</span>}
    {missing && <span className="hint microphone-note">{t("mic.fallback")}</span>}
    {error && <span className="hint microphone-note" role="alert">{t("mic.listError")}</span>}
  </div>;
}
