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
  /** The one question before the voice is deleted (the browser's own dialog; a test passes its own). */
  confirmRemove?: (question: string) => boolean;
  /** The voice's status before the desktop app has answered (tests; the panel reads it from the bridge). */
  initial?: OkFilowTtsStatus | null;
};

export function VoiceSettings({ bridge, status, t, configure, preview, confirmRemove = (q) => window.confirm(q), initial = null }: Props) {
  const [tts, setTts] = useState<OkFilowTtsStatus | null>(initial);
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
  // The same rule as Filow Settings (apps/desktop/model-use.js): OK Filow on, the natural voice chosen, and this PC able to carry it.
  const inUse = status.enabled !== false && voice === "natural" && panel.show === "ready";

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
  const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const [removed, setRemoved] = useState("");
  /** Stop: the desktop app ends the download and deletes what it fetched; the row goes back to "Download". */
  const stop = async () => {
    if (!api?.stopDownload) return;
    try { setTts(await api.stopDownload()); } catch { /* the status channel shows what happened */ }
  };
  /** Delete, after one question that names the voice and its size and says what speaks instead. */
  const remove = async () => {
    if (!api || !tts) return;
    const question = t("voiceRemoveConfirm").replace("{size}", size(tts.sizeBytes));
    if (!confirmRemove(inUse ? `${question}\n\n${t("voiceRemoveInUse")}` : question)) return;
    try {
      const reply = await api.remove();
      setTts(reply);
      if (!reply.installed) setRemoved(t("voiceRemoved").replace("{size}", size(reply.freedBytes ?? tts.sizeBytes)));
    } catch { /* still installed: the row stays as it is */ }
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
            ? (
              <div className="okf-row">
                <p className="okf-note okf-progress" role="status">{panel.busy === "extracting" ? t("voiceExtracting") : t("voiceDownloading").replace("{pct}", String(panel.pct))}</p>
                {api?.stopDownload && <button type="button" className="okf-link" data-testid="voice-stop" aria-label={t("voiceStopLabel")} onClick={() => void stop()}>{t("voiceStop")}</button>}
              </div>
            )
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
          {panel.light && <p className="okf-hint">{t("voiceLight")}</p>}
        </>
      )}

      {/* The voice on disk, whichever voice speaks: its size, whether it is the one in use, and Delete. */}
      {tts?.installed && (
        <>
          <p className="okf-hint" data-testid="voice-installed">
            {t("voiceInstalled").replace("{size}", size(tts.sizeBytes))}
            {inUse && <> · <strong data-testid="voice-in-use">{t("voiceInUse")}</strong></>}
          </p>
          <div className="okf-row">
            {voice === "natural" && panel.show === "ready" ? <button type="button" className="okf-link" onClick={preview}>{t("voicePreview")}</button> : <span />}
            <button type="button" className="okf-link" data-testid="voice-remove" onClick={() => void remove()}>{t("voiceRemove")}</button>
          </div>
        </>
      )}
      {!tts?.installed && removed && <p className="okf-hint" role="status">{removed}</p>}
    </>
  );
}
