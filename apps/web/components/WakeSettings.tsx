"use client";
import { useEffect, useRef, useState } from "react";
import { startMic } from "@filow/stt";
import { okFilowSettingsBridge, type WakeAction, type WakeStatus } from "@/lib/buddy/bridge";
import { okfText } from "@/lib/buddy/text";

export function WakeSettings({ lang }: { lang: string }) {
  const t = okfText(lang);
  const [status, setStatus] = useState<WakeStatus | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [index, setIndex] = useState(0);
  const [negative, setNegative] = useState(false);
  const [draft, setDraft] = useState<Float32Array | null>(null);
  const [error, setError] = useState("");
  const [playback, setPlayback] = useState("");
  const [sensitivity, setSensitivity] = useState("balanced");
  const capture = useRef<{ stop(): void } | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const testing = useRef(false);
  useEffect(() => {
    if (!draft) { setPlayback(""); return; }
    const data = new ArrayBuffer(44 + draft.length * 2), view = new DataView(data);
    const word = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
    word(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); word(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, draft.length * 2, true);
    draft.forEach((v, i) => view.setInt16(44 + 2 * i, Math.round(v * 32767), true));
    const url = URL.createObjectURL(new Blob([data], { type: "audio/wav" })); setPlayback(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);
  useEffect(() => {
    mounted.current = true;
    void okFilowSettingsBridge()?.status().then((s) => { if (mounted.current) setSensitivity(s.wakeSensitivity ?? "balanced"); });
    const sessionGeneration = generation;
    const refresh = () => { void okFilowSettingsBridge()?.wakeAction?.("status").then((s) => { if (mounted.current) setStatus(s); }).catch(() => {}); };
    refresh(); const poll = setInterval(refresh, 500);
    return () => { mounted.current = false; sessionGeneration.current++; clearInterval(poll); if (timer.current) clearTimeout(timer.current); capture.current?.stop(); if (testing.current) void okFilowSettingsBridge()?.wakeAction?.("off"); };
  }, []);
  async function action(name: WakeAction, data?: unknown) {
    if (name === "test") testing.current = data === true;
    if (name === "delete") { setDraft(null); setIndex(0); }
    setBusy(true); setError("");
    try { const got = await okFilowSettingsBridge()?.wakeAction?.(name, data); if (got && mounted.current) setStatus(got); return got; }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function stopRecording() {
    generation.current++; capture.current?.stop(); capture.current = null;
    if (timer.current) clearTimeout(timer.current);
    const pcm = new Float32Array(chunks.current.reduce((n, c) => n + c.length, 0));
    let at = 0; for (const c of chunks.current) { pcm.set(c, at); at += c.length; }
    chunks.current = []; setDraft(pcm); setRecording(false); setLevel(0);
  }
  async function record() {
    await action("off");
    if (!mounted.current) return;
    setDraft(null); setError(""); setRecording(true); chunks.current = [];
    const id = ++generation.current;
    try {
      const got = await startMic(16000, (pcm) => {
        if (id !== generation.current) return;
        const x = Float32Array.from(new Int16Array(pcm), (v) => v / 32768);
        chunks.current.push(x); let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v)); setLevel(peak);
      });
      if (id !== generation.current) got.stop();
      else { capture.current = got; timer.current = setTimeout(stopRecording, 3000); }
    } catch (e) { if (id === generation.current) { stopRecording(); setError(e instanceof Error ? e.message : String(e)); } }
  }
  if (!okFilowSettingsBridge()?.wakeAction) return null;
  const rawError = (status?.error || error).startsWith("Replay check required") ? t("wakeVerifyFirst") : status?.error || error;
  const check = status?.verification?.[sensitivity];
  const verified = check?.total === 5 && check.recognised >= 4 && check.negativeAccepts === 0;
  const reason = rawError.match(/(?:^|: )(short|quiet|clipped)$/)?.[1];
  const shownError = reason === "short" ? t("wakeShort") : reason === "quiet" ? t("wakeQuiet") : reason === "clipped" ? t("wakeClipped") : rawError;
  return <fieldset className="strip" aria-label={t("wakeLabel")}>
    <legend>{t("wakeLabel")}</legend>
    <label className="row"><input type="checkbox" checked={status?.enabled === true} disabled={busy || recording} onChange={(e) => { if (e.target.checked) setNotice(true); else void action("off"); }} />{t("wakeEnable")}</label>
    {notice && <div role="region" aria-label={t("wakeLabel")}>
      <p>{t("wakeNotice")}</p>
      <button className="btn" disabled={busy} onClick={() => { setNotice(false); void action("setup", true); }}>{t("wakeDownload")}</button>
      <button className="btn" onClick={() => setNotice(false)}>{t("wakeCancel")}</button>
    </div>}
    <p role="status">{shownError || (status?.phase === "training" ? t("wakeTraining") : busy ? t("wakeWorking") : status?.listening ? t("wakeListening") : status?.enabled ? t("wakePaused") : t("wakeReady"))}</p>
    {status?.legacyPhrase && <p>{t("wakeLegacy")}</p>}
    <p>{index + 1} / {negative ? 2 : 5} · {t(negative ? "wakeNegative" : "wakeRecord")}</p>
    <p>{t("wakeNegativeHelp")}</p>
    <button className="btn" disabled={recording || busy} onClick={() => { setNegative(!negative); setIndex(0); setDraft(null); }}>{t(negative ? "wakeRecord" : "wakeNegative")}</button>
    {negative && <button className="btn" disabled={recording || busy} onClick={async () => { await action("negative", {index:0,samples:null}); await action("negative", {index:1,samples:null}); setNegative(false); setIndex(0); setDraft(null); }}>{t("wakeSkipNegatives")}</button>}
    <meter min={0} max={1} value={level} aria-label={t("wakeRecord")} />
    {playback && <div><p>{t("wakeAcceptHint")}</p><audio controls src={playback} aria-label={t("wakeRecord")} /></div>}
    <div className="row">
      <button className="btn" disabled={busy} onClick={() => recording ? stopRecording() : void record()}>{t(recording ? "wakeStop" : "wakeRecord")}</button>
      {draft && <button className="btn" disabled={busy} onClick={async () => { const s = await action(negative ? "negative" : "sample", { index, samples: draft }); if (s && !s.error) { setDraft(null); setIndex(Math.min(negative ? 1 : 4, index + 1)); } }}>{t("wakeAccept")}</button>}
      <button className="btn" disabled={recording || busy} onClick={() => { setIndex(0); setDraft(null); }}>{t("wakeRedo")}</button>
    </div>
    <button className="btn" disabled={busy || recording || status?.recordings !== 5} onClick={() => void action("train")}>{t("wakeTrain")}</button>
    <label className="row">{t("wakeLabel")}<select className="btn" value={sensitivity} disabled={busy || recording} onChange={async (e) => {
      const value = e.target.value as "strict" | "balanced" | "sensitive"; setSensitivity(value);
      await action("off"); await okFilowSettingsBridge()?.configure({ wakeSensitivity: value });
    }}>
      <option value="strict">{t("wakeStrict")}</option><option value="balanced">{t("wakeBalanced")}</option><option value="sensitive">{t("wakeSensitive")}</option>
    </select></label>
    <p>{t("wakeTradeoff")}</p>
    <p role="status">{check ? t("wakeRecognised").replace("{n}", String(check.recognised)).replace("{a}", String(check.negativeAccepts)).replace("{b}", String(check.negatives)) : t("wakeVerifyFirst")}</p>
    <div className="row">
      <button className="btn" disabled={busy || recording || !verified} onClick={async () => { await action("test", true); await action("enable"); }}>{t("wakeTry")}</button>
      <button className="btn" disabled={busy || recording || !verified} onClick={async () => { await action("test", false); await action("enable"); }}>{t("wakeEnable")}</button>
      <button className="btn" disabled={recording} onClick={() => void action("delete")}>{t("wakeDelete")}</button>
      <button className="btn" onClick={() => { if (recording) stopRecording(); void action("off"); }}>{t("wakeOff")}</button>
    </div>
    <p aria-live="polite">{t("wakeCount")}: {status?.count ?? 0}</p>
  </fieldset>;
}
