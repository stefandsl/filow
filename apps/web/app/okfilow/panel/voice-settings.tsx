"use client";
// The voice rows of the OK Filow settings: which voice speaks, the one-time download of the
// natural voice (size shown, resumable), who speaks, and a button to hear it.
// What to show is decided by voicePanel() in lib/buddy/voice.ts, which is unit tested.
import { useEffect, useRef, useState } from "react";
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsStatus } from "@/lib/buddy/bridge";
import type { OkfKey } from "@/lib/buddy/text";
import { voicePanel } from "@/lib/buddy/voice";

type Props = {
  bridge: OkFilowBridge;
  status: OkFilowStatus;
  t: (k: OkfKey) => string;
  configure: (patch: Partial<OkFilowStatus>) => Promise<void>;
  /** Says the sample sentence with the natural voice. */
  preview: () => void;
};

export function VoiceSettings({ bridge, status, t, configure, preview }: Props) {
  const [tts, setTts] = useState<OkFilowTtsStatus | null>(null);
  const api = bridge.tts;

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.status().then((s) => { if (live) setTts(s); }).catch(() => {});
    const off = api.onStatus(setTts);
    return () => { live = false; off(); };
  }, [api]);

  // Picking who speaks lets you hear them at once (after the new choice has reached the panel).
  const picked = useRef(false);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    previewRef.current();
  }, [status.naturalVoice]);

  const panel = voicePanel(api ? tts : null);
  const voice = status.offline && status.voice === "cloud" ? "system" : status.voice;
  // The voices that speak on this PC: the download offer and the reasons belong next to them.
  const onThisPc = voice === "natural" || voice === "system";
  const offerNatural = !!api && (panel.show !== "blocked" || voice === "natural");

  const download = async () => {
    if (!api) return;
    // Asking for the natural voice is choosing it: it speaks as soon as the download is done.
    if (status.voice !== "natural") void configure({ voice: "natural" });
    try {
      const reply = await api.download();
      // Progress arrives on its own channel; never step back to an older figure.
      setTts((now) => (reply.state === "downloading" && now?.state === "downloading" && now.pct > reply.pct ? now : reply));
    } catch { /* the desktop reports the failure through the status channel */ }
  };
  const remove = async () => {
    if (!api) return;
    try { setTts(await api.remove()); } catch { /* still installed: the row stays as it is */ }
  };

  const who = Math.max(0, Math.min((panel.show === "ready" ? panel.voices : 10) - 1, status.naturalVoice ?? 0));
  const half = panel.show === "ready" ? Math.ceil(panel.voices / 2) : 5;

  return (
    <>
      <label className="okf-row">
        <span>{t("voice")}</span>
        <select className="okf-select-wide" value={voice} onChange={(e) => void configure({ voice: e.target.value as OkFilowStatus["voice"] })}>
          {offerNatural && <option value="natural">{t("voiceNatural")}</option>}
          <option value="system">{t("voiceSystem")}</option>
          {!status.offline && <option value="cloud">{t("voiceCloud")}</option>}
          <option value="off">{t("voiceOff")}</option>
        </select>
      </label>

      {onThisPc && panel.show === "blocked" && <p className="okf-hint">{t(`voiceWhy_${panel.reason}`)}</p>}

      {onThisPc && panel.show === "get" && (
        <>
          {panel.busy
            ? <p className="okf-note" role="status">{panel.busy === "extracting" ? t("voiceExtracting") : t("voiceDownloading").replace("{pct}", String(panel.pct))}</p>
            : status.offline || panel.problem === "offline"
              ? <p className="okf-warn" role="status">{t("voiceOfflineGet")}</p>
              : (
                <button type="button" className="okf-link" onClick={() => void download()}>
                  {panel.resume ? t("voiceResume").replace("{pct}", String(panel.pct)) : t("voiceGet").replace("{size}", `${panel.sizeMb} MB`)}
                </button>
              )}
          {panel.problem === "failed" && !panel.busy && <p className="okf-warn" role="alert">{t("voiceGetFailed")}</p>}
          <p className="okf-hint">{t("voiceGetNote")}</p>
        </>
      )}

      {voice === "natural" && panel.show === "ready" && (
        <>
          <label className="okf-row">
            <span>{t("voiceWho")}</span>
            <select value={String(who)} onChange={(e) => { picked.current = true; void configure({ naturalVoice: Number(e.target.value) }); }}>
              {Array.from({ length: panel.voices }, (_, i) => (
                <option key={i} value={i}>
                  {(i < half ? t("voiceFemale") : t("voiceMale")).replace("{n}", String(i < half ? i + 1 : i - half + 1))}
                </option>
              ))}
            </select>
          </label>
          <div className="okf-row">
            <button type="button" className="okf-link" onClick={preview}>{t("voicePreview")}</button>
            <button type="button" className="okf-link" onClick={() => void remove()}>{t("voiceRemove")}</button>
          </div>
          {panel.light && <p className="okf-hint">{t("voiceLight")}</p>}
        </>
      )}
    </>
  );
}
