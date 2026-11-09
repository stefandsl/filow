"use client";
import { Icon } from "./icons";
import { MicrophoneSelect } from "./MicrophoneSelect";
import type { MicWarning } from "@filow/stt";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  missedPoints,
  notesToMarkdown,
  parseScript,
  SCREEN_MODE_LABELS,
  type DecisionProviderId,
  type ImportResponse,
  type ScreenMode,
  type ScreenNote,
  type Script,
  type SttBackendId,
  type SttStatus,
} from "@filow/core";
import { Wordmark, LangProvider, OnScreenStrip, useLang, useT } from "@filow/ui";
import { availableBackends, BACKEND_LABELS, browserSupported, createBackend, selectedWhisperModel, sherpaBridge, whisperCached, type SttBackend, preopenMic, releasePreopenedMic } from "@filow/stt";
import { getSpeechLang, getStartMode, setDecisionProvider, setStartMode } from "@/lib/prefs";
import { useEngine } from "./useEngine";
import { fetchPlan, type PlanResponse } from "@/lib/plan";
import { engineHeaders, ensureEngineToken, useSession } from "./useSession";
import { PairPanel } from "./PairPanel";
import { useScreenSense, type ScreenSource } from "./useScreenSense";
import { LangSwitch, ThemeSwitch, useUiLang, useUiTheme } from "./LangSwitch";
import { ResourcesPanel } from "./ResourcesPanel";
import { desktopBridge, type UpdateStatus } from "@/lib/sessionUrl";

import { SectionNav } from "./prompter/SectionNav";
import { sectionLabel } from "./prompter/sectionLabel";
import { PointsList } from "./prompter/PointsList";
import { NextSection } from "./prompter/NextSection";
import { Transcript } from "./prompter/Transcript";
import { ScreenSensePanel } from "./prompter/ScreenSensePanel";
import { ActionBar } from "./prompter/ActionBar";
import { StatusStrip } from "./prompter/StatusStrip";
import { OverflowMenu } from "./prompter/OverflowMenu";
import { Dialog } from "./prompter/Dialog";
import { ImportError } from "./prompter/ImportError";
import { LogPanel } from "./prompter/LogPanel";
import { pointState } from "@/lib/pointState";
import { CancelledStart, StartAttempts, type StartAttempt } from "@/lib/startAttempt";

type BackendChoice = "auto" | SttBackendId;

export default function Teleprompter() {
  const [lang, setLang] = useUiLang();
  const [theme, setTheme] = useUiTheme();
  return (
    <LangProvider lang={lang}>
      <TeleprompterInner onLang={setLang} theme={theme} onTheme={setTheme} />
    </LangProvider>
  );
}

function TeleprompterInner({ onLang, theme, onTheme }: { onLang: (l: "en" | "it") => void; theme: "system" | "light" | "dark"; onTheme: (t: "system" | "light" | "dark") => void }) {
  const t = useT();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const actionMenuRef = useRef<HTMLButtonElement>(null);
  const { engine, state } = useEngine();
  const sessionInfo = useSession(engine);
  const [scriptText, setScriptText] = useState("");
  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  // Resolved on the client only, so server and first client render agree.
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<BackendChoice>("auto");
  const [startDialog, setStartDialog] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastNotes, setLastNotes] = useState<ScreenNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [micWarning, setMicWarning] = useState<MicWarning | null>(null);
  const microphoneRef = useRef<HTMLSelectElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const [publicLink, setPublicLink] = useState(false);
  const [show, setShow] = useState<{ running: boolean; index: number; total: number } | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onUpdateStatus) return;
    void bridge.updateStatus?.().then(setUpdate);
    return bridge.onUpdateStatus(setUpdate);
  }, []);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onSlideshow) return;
    const apply = (st: { running: boolean; index: number; total: number; title: string }) => {
      setShow(st.running ? st : null);
      if (st.running && st.index >= 0) engine.dispatch({ type: "slideChanged", index: st.index, total: st.total, title: st.title || undefined });
    };
    void bridge.slideshowState?.().then(apply);
    return bridge.onSlideshow(apply);
  }, [engine]);
  useEffect(() => {
    setPublicLink(Boolean(desktopBridge()?.remoteShare));
  }, []);
  const startAttempts = useRef(new StartAttempts());
  const [pendingImport, setPendingImport] = useState<ImportResponse | null>(null);
  const backendRef = useRef<SttBackend | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Offline mode is owned by the desktop shell (menu toggle); the web deploy reads FILOW_OFFLINE.
  useEffect(() => {
    const bridge = (globalThis as { filow?: { offline?: boolean; onOffline?: (fn: (v: boolean) => void) => void } }).filow;
    if (bridge?.offline !== undefined) setOffline(bridge.offline);
    bridge?.onOffline?.(setOffline);
    if (!bridge) void fetch("/api/local/status").then((r) => r.json()).then((s: { offline?: boolean }) => setOffline(Boolean(s.offline))).catch(() => undefined);
  }, []);

  const { script, sectionIdx, points, stats, engine: eng } = state;
  const section = script.sections[sectionIdx];
  const nextSection = script.sections[sectionIdx + 1];
  const missed = missedPoints(state);
  const error = eng.error ?? null;

  const pushLog = useCallback((line: string) => {
    setLog((l) => {
      const next = [...l.slice(-30), `${new Date().toLocaleTimeString()}  ${line}`];
      desktopBridge()?.takeLog?.(next.join("\n")); // kept by the desktop shell for "Report a problem"
      return next;
    });
  }, []);

  // ---- Screen Sense (ARCHITECTURE.md §6) --------------------------------
  const screen = useScreenSense(engine, state, pushLog);

  const importDocument = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import", { method: "POST", headers: engineHeaders(), body: form });
      const out = (await res.json()) as ImportResponse & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `import failed (${res.status})`);
      setPendingImport(out);
      pushLog(`Imported ${file.name}: ${out.script.sections.length} sections from ${out.pages} ${out.kind === "pptx" ? "slides" : "pages"}`);
    } catch (err) {
      setImportError((err as Error).message);
      pushLog(`Import: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportNotes = () => {
    const md = notesToMarkdown(lastNotes, `Talk notes · ${new Date(lastNotes[0]?.at ?? Date.now()).toLocaleDateString()}`);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `filow-notes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---- script ----------------------------------------------------------
  const loadScript = useCallback(async () => {
    const res = await fetch("/api/script");
    const { text, script } = (await res.json()) as { text: string; script: Script };
    setScriptText(text);
    engine.loadScript(script);
  }, [engine]);

  useEffect(() => {
    setHasWebSpeech(browserSupported());
    setMounted(true);
    void loadScript();
    void fetch("/api/stt/status")
      .then((r) => r.json())
      .then((s: SttStatus) => setSttStatus(s));
  }, [loadScript]);

  const saveScript = async (text: string) => {
    await ensureEngineToken();
    const res = await fetch("/api/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...engineHeaders() },
      body: JSON.stringify({ text }),
    });
    const { script } = (await res.json()) as { script: Script };
    setScriptText(text);
    engine.loadScript(script);
    setEditing(false);
  };

  // ---- transcription ---------------------------------------------------
  const stopTake = useCallback(() => {
    setMicWarning(null);
    backendRef.current?.stop();
    backendRef.current = null;
    releasePreopenedMic(); // the check's stream, if no backend took it (Web Speech, or a failed start)
    engine.stop();
    // Live notes (§6.4) are offered for export until the next take starts.
    if (engine.getNotes().length) setLastNotes([...engine.getNotes()]);
  }, [engine]);

  /** Open the microphone once up front: a clear message beats five backends failing in a row. */
  const probeMic = async (attempt: StartAttempt): Promise<boolean> => {
    pushLog(t("mic.checking"));
    try {
      // The 0.9.6 probe opens and stops the stream before backend capture.
      const stream = await attempt.wait(preopenMic(pushLog));
      pushLog(`${t("mic.checking")} ${stream.getAudioTracks()[0]?.label || "ok"}`);
      return true;
    } catch (err) {
      if (err instanceof CancelledStart) throw err;
      const name = (err as DOMException).name;
      const msg = name === "NotFoundError" || name === "OverconstrainedError" ? t("mic.notFound") : name === "NotAllowedError" || name === "SecurityError" ? t("mic.denied") : `${t("mic.busy")} (${(err as Error).message})`;
      engine.setError(msg);
      pushLog(msg);
      return false;
    }
  };

  /** What each mode needs, read fresh every time the dialog opens. */
  const loadReadiness = async (): Promise<Readiness> => {
    const [stt, local, whisper, sherpa] = await Promise.all([
      fetch("/api/stt/status").then((r) => r.json()).catch(() => ({ elevenlabs: false, openai: false })) as Promise<SttStatus>,
      fetch("/api/local/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null) as Promise<{ openrouterKey?: boolean; ollama?: { ok: boolean }; models?: Array<{ name: string; installed: boolean }>; advice?: { local: boolean; reason: "gpu" | "ram" | "none" }; gpu?: { name: string } } | null>,
      whisperCached(selectedWhisperModel()).catch(() => false),
      sherpaBridge()
        ?.status()
        .then((s) => s.model === "ready")
        .catch(() => false) ?? Promise.resolve(false),
    ]);
    return {
      openrouterKey: Boolean(local?.openrouterKey),
      sttKey: Boolean(stt.elevenlabs || stt.openai),
      whisper: whisper || sherpa,
      sherpa,
      clef: Boolean(local?.ollama?.ok && local?.models?.some((m) => m.name.startsWith("clef") && m.installed)),
      stt,
      advice: local?.advice ?? { local: false, reason: "none" },
      gpuName: local?.gpu?.name ?? "",
    };
  };

  /** Start button: ask Cloud / Local unless a choice is remembered. */
  const [plan, setPlan] = useState<PlanResponse | null>(null);

  const requestStart = async () => {
    const attempt = startAttempts.current.begin();
    setStarting(true);
    try {
      let mode = getStartMode();
      const r = await attempt.wait(loadReadiness());
      setSttStatus(r.stt);
      setReadiness(r);
      if (mode === "auto") {
        // The router measures one call per candidate and picks the lowest-latency setup for each task.
        setStarting(true);
        try {
          const p = await attempt.wait(fetchPlan({ probe: true, apply: true }));
          setPlan(p);
          if (p.decision.provider && p.stt.backend) {
            pushLog(`auto: ${p.stt.backend} · ${p.decision.provider}${p.decision.measuredMs ? ` ${p.decision.measuredMs} ms` : ""} · ${p.generate.provider}${p.generate.model ? ` ${p.generate.model}` : ""}`);
            const m: "cloud" | "local" = p.decision.provider === "clef-local" ? "local" : "cloud";
            await attempt.wait(startTake(m, r, attempt, { provider: p.decision.provider, backend: p.stt.backend }));
            return;
          }
        } catch (err) {
          if (err instanceof CancelledStart) throw err;
          pushLog(`auto: router failed (${(err as Error).message}); asking`);
        }
        setStarting(false);
        mode = autoPick(r) ?? "ask";
      }
      if (mode === "ask" || (mode === "cloud" && !(r.openrouterKey && r.sttKey)) || (mode === "local" && !(r.whisper && r.clef))) {
        setStartDialog(true);
        return;
      }
      await attempt.wait(startTake(mode, r, attempt));
    } catch (err) {
      if (!(err instanceof CancelledStart)) {
        engine.setError((err as Error).message);
        pushLog(`could not start: ${(err as Error).message}`);
      }
    } finally {
      if (attempt.isCurrent()) setStarting(false);
    }
  };

  const startTake = async (mode: "cloud" | "local", r: Readiness, attempt: StartAttempt, pick?: { provider: DecisionProviderId; backend: SttBackendId }) => {
    if (!attempt.isCurrent()) return;
    let pendingBackend: SttBackend | null = null;
    try {
      engine.setError(undefined);
      setMicWarning(null);
      setLastNotes([]);
      setStarting(true);
      // The mode decides the provider and the transcription backend; no silent fallback to the other side.
      setDecisionProvider(pick?.provider ?? (mode === "local" ? "clef-local" : "openrouter"));
      if ((pick?.provider ?? (mode === "local" ? "clef-local" : "")) === "clef-local") void fetch("/api/local/warmup", { method: "POST" }).catch(() => undefined);
      let backend: BackendChoice = pick?.backend ?? choice;
      if (backend === "auto") {
        if (mode === "local") backend = r.sherpa ? "sherpa" : "whisper";
        else backend = r.stt.elevenlabs ? "elevenlabs" : r.stt.openai ? "openai" : hasWebSpeech ? "browser" : "auto";
      }
      if (backend === "auto") {
        engine.setError(t("start.notReadyCloud"));
        setStarting(false);
        return;
      }
      pushLog(`${mode === "local" ? t("start.local") : t("start.cloud")} · ${BACKEND_LABELS[backend]}`);
      // Web Speech owns its input and always uses the system default.
      if (backend !== "browser" && !(await attempt.wait(probeMic(attempt)))) {
        setStarting(false);
        return;
      }
      const handlers = {
        onTranscript: (e: { committed?: string; partial?: string }) => { if (attempt.isCurrent()) engine.feed(e); },
        onError: (m: string) => {
          if (!attempt.isCurrent()) return;
          pushLog(`error: ${m}`);
          engine.setError(m);
        },
        onReady: () => { if (attempt.isCurrent()) pushLog("transcription ready"); },
        onLog: (line: string) => { if (attempt.isCurrent()) pushLog(line); },
        onMicWarning: (warning: MicWarning | null) => { if (attempt.isCurrent()) setMicWarning(warning); },
      };
      {
        // Explicit backend from the chosen mode: never fall back silently.
        const b = createBackend(backend, { headers: engineHeaders(), language: backend === "whisper" && getSpeechLang() === "auto" ? lang : getSpeechLang() });
        pendingBackend = b;
        await attempt.wait(b.start(handlers));
        backendRef.current = b;
        engine.setBackend(b.id);
        pushLog(`${BACKEND_LABELS[backend]}: live`);
      }
      engine.start();
    } catch (err) {
      pendingBackend?.stop();
      if (attempt.isCurrent()) {
        engine.setError((err as Error).message);
        pushLog(`could not start transcription: ${(err as Error).message}`);
        stopTake();
      }
    } finally {
      if (attempt.isCurrent()) setStarting(false);
    }
  };

  const cancelStart = () => {
    startAttempts.current.cancel();
    stopTake();
    setStarting(false);
  };

  useEffect(() => () => { startAttempts.current.cancel(); backendRef.current?.stop(); }, []);

  // When the engine stops itself (cost cap), release the microphone too.
  useEffect(() => {
    if (!eng.recording && backendRef.current) {
      backendRef.current.stop();
      backendRef.current = null;
    }
  }, [eng.recording]);

  const tail = state.transcriptTail;
  const availability = availableBackends(sttStatus, { webSpeech: hasWebSpeech, whisper: mounted, sherpa: readiness?.sherpa ?? false, offline });
  const costLabel = stats.costUsd === null ? "n/a" : `$${stats.costUsd.toFixed(6)}`;
  const lang = useLang();

  return (
    <div className="app prompter">
      <header className="topbar">
        <div className="logo"><Wordmark height={28} /></div>
        <span className="subtitle">{t("app.tagline")}</span><span className="spacer" />
        <PairPanel prompter info={sessionInfo.info} status={sessionInfo.status} error={sessionInfo.error} onNewCode={() => void sessionInfo.newCode()} />
        <LangSwitch lang={lang} onChange={onLang} /><ThemeSwitch pref={theme} onChange={onTheme} />
        <a className="btn settings-link" href="/settings/local" aria-label={t("ctl.settings")} title={t("ctl.settingsTitle")}><Icon name="settings" /></a>
      </header>
      <SectionNav sections={script.sections} current={sectionIdx} onSelect={idx => engine.dispatch({type:"goToSection", idx})}
        importAction={<button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={importing} aria-label={t("ctl.import")} title={t("ctl.importTitle")}><Icon name="up" /><span className="action-label">{importing ? t("ctl.importing") : t("ctl.import")}</span></button>}
        reloadAction={<button type="button" className="btn" onClick={loadScript} aria-label={t("ctl.reload")}><Icon name="reload" /><span className="action-label">{t("ctl.reload")}</span></button>} />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.pptx,.docx,.txt,.md,.markdown"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && void importDocument(e.target.files[0])}
        />

      <div className="prompter-content">
      <main className="prompter-main">
      {update?.status === "downloaded" && !updateDismissed && (
        <div className="update-banner">
          <span><Icon name="up" /> {t("update.ready", { version: update.version })}</span>
          <button className="btn primary" onClick={() => desktopBridge()?.installUpdate?.()}>
            {t("update.restart")}
          </button>
          <button className="btn" onClick={() => setUpdateDismissed(true)}>
            {t("update.later")}
          </button>
        </div>
      )}
      {error && <div className="chip err banner">{error}</div>}
      {importError !== null && <ImportError error={importError} />}


        <div className="section-heading">
          {section ? <><div className="section-count">{t("section.counter", {n: sectionIdx + 1, m: script.sections.length})}</div>
            <h1 className="section-title">{sectionLabel(section.title).title}</h1><span className="label">{sectionLabel(section.title).label && `${sectionLabel(section.title).label} - `}{t("section.points", {n: section.bullets.length})}</span></>
            : <><h1 className="section-title">{t("stage.noScript")}</h1><p>{t("stage.noScriptHint")}</p></>}
          <button type="button" className="btn edit-points" onClick={() => setEditing(true)}><Icon name="edit" /> {t("ctl.edit")}</button>
        </div>
        {section && <PointsList points={section.bullets.map(b => {
          const st = points[b.id] ?? {status: "waiting", confidence: 0};
          return {id:b.id, text:b.text, confidence:st.confidence, evidence:st.evidence, state:pointState({started:st.status === "started",confidence:st.confidence},st.confidence >= 0.3 || st.active === true)};
        })} onToggle={id => engine.dispatch(points[id]?.status === "started" ? {type:"reopen",id} : {type:"markStarted",id})} />}
        {state.screen && <OnScreenStrip screen={state.screen} unmentioned={state.unmentioned} analysing={state.screenStats?.analysing} onLookNow={screen.lookNow} onForget={screen.forget} />}
          {missed.length > 0 && (
            <div className="strip">
              <div className="label">{t("stage.missed", { n: missed.length })}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span key={b.id} className="missed-item" title={t("stage.reopen")} onClick={() => engine.dispatch({ type: "reopen", id: b.id })}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); engine.dispatch({ type: "reopen", id: b.id }); }
                    }}>
                    {t("stage.missedItem", { text: b.text })}
                  </span>
                ))}
              </div>
            </div>
          )}

        <Transcript text={tail} open={transcriptOpen} />
      {logOpen && (
        <LogPanel triggerRef={actionMenuRef} onClose={() => setLogOpen(false)}>
          {desktopBridge()?.reportProblem && (
            <button type="button" className="btn small" style={{ float: "right" }} onClick={() => desktopBridge()?.reportProblem?.()}>
              {t("log.report")}
            </button>
          )}
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </LogPanel>
      )}

        {nextSection && <NextSection title={nextSection.title} points={nextSection.bullets.map(b => b.text)} completed={nextSection.bullets.map(b => points[b.id]?.status === "started")} />}
        {screen.status !== "unsupported" && <ScreenSensePanel active={screen.status === "watching"}>
            {screen.status === "watching" ? (
              <button className="btn primary" onClick={screen.stopWatching}>
                {t("screen.stopWatching")}
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => void screen.watchScreen()}
                disabled={offline || !screen.enabled}
                title={offline ? t("screen.watchOffline") : t("screen.watchTitle")}
              >
                {t("screen.watch")}
              </button>
            )}
            <select className="btn" value={screen.mode} onChange={(e) => screen.setMode(e.target.value as ScreenMode)} title={t(`mode.${screen.mode}`)} aria-label={t("screen.modeTitle")}>
              {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
                <option key={m} value={m} title={t(`mode.${m}`)}>
                  {t(`mode.${m}.short`)}
                </option>
              ))}
            </select>
            <OverflowMenu items={[
              ...(screen.desktop ? [{id:"region",label:t("screen.region"),onSelect:() => { if (!offline) void screen.captureRegion(); }}] : []),
              {id:"screenSettings",label:t("ctl.settings"),onSelect:() => { window.location.href = "/settings/local"; }},
              ...(state.screen ? [{id:"forget",label:t("screen.forget"),onSelect:screen.forget}] : []),
              ...(lastNotes.length > 0 ? [{id:"export",label:t("screen.exportNotes", {n:lastNotes.length}),onSelect:exportNotes}] : []),
            ]} />

            <button
              className="btn screen-scan"
              onClick={screen.lookNow}
              disabled={offline || (screen.status !== "watching" && !screen.desktop)}
              title={screen.desktop && screen.status !== "watching" ? t("screen.lookNowRegion") : t("screen.lookNowFrame")}
            >
              <Icon name="play" /> {t("screen.scan")}
            </button>
          {screen.status === "watching" && <span className="chip rec" title={t("screen.recTitle", {label:screen.label})}><Icon name="circle" /> {t("screen.rec")} {"\u00b7"} {state.screenStats?.analysing ? t("app.analysing") : screen.label}</span>}
        </ScreenSensePanel>}
      </main>
      </div>
      <ActionBar start={<>
        {eng.recording ? (
          <button className="btn primary" onClick={stopTake}>
            <Icon name="stop" /> {t("ctl.stop")}
          </button>
        ) : (
          <>
            <button ref={startButtonRef} className="btn primary" onClick={() => void requestStart()} disabled={starting || !section || availability.length === 0}>
              {starting ? t("ctl.starting") : <><Icon name="play" /> {t("ctl.start")}</>}
            </button>
            {starting && <button className="btn danger" onClick={cancelStart}>{t("ctl.cancel")}</button>}
          </>
        )}
</>} mode={<><label className="backend-choice"><span>{t("ctl.mode")}</span>
        <select className="btn" value={choice} disabled={eng.recording} onChange={(e) => setChoice(e.target.value as BackendChoice)} title={choice === "auto" ? t("ctl.auto") : BACKEND_LABELS[choice]} aria-label={t("ctl.backend")}>
          <option value="auto" title={t("ctl.auto")}>{t("ctl.auto.short")}</option>
          {availability.map((id) => (
            <option key={id} value={id} title={BACKEND_LABELS[id]}>
              {t(`ctl.backend.${id}.short`)}
            </option>
          ))}
        </select>
</label><MicrophoneSelect compact webSpeech={(eng.recording ? eng.backend : choice) === "browser"} selectRef={microphoneRef} /></>}
        warning={micWarning && <div className="mic-warning chip err" role="alert">
          <span>{t(micWarning.kind === "slow-context" ? "mic.slowContext" : "mic.noAudio", { label: micWarning.label || t("mic.systemDefault"), ms: micWarning.elapsedMs ?? 0 })}</span>
          <button type="button" className="btn" onClick={() => {
            const select = microphoneRef.current;
            select?.focus();
            try { select?.showPicker(); } catch { /* Keyboard focus works on older hosts. */ }
          }}>{t("mic.chooseAnother")}</button>
        </div>}
        prev={<button type="button" className="btn" onClick={() => engine.dispatch({type:"prevSection"})} disabled={sectionIdx === 0}><Icon name="left" /> {t("ctl.prev")}</button>}
        next={<button type="button" className="btn" onClick={() => engine.dispatch({type:"nextSection"})} disabled={!nextSection}>{t("ctl.next")} <Icon name="right" /></button>}
        transcriptToggle={<button type="button" className="btn" aria-expanded={transcriptOpen} aria-controls="prompter-transcript-text" onClick={() => setTranscriptOpen(v => !v)}>{t("footer.transcript")}</button>}
        overflow={<OverflowMenu triggerRef={actionMenuRef} items={[
          {id:"reset",label:t("ctl.reset"),onSelect:() => engine.dispatch({type:"resetSection"})},
          {id:"log",label:t("ctl.logReport"),onSelect:() => { setLogOpen(true); }},
          ...(desktopBridge()?.reportProblem ? [{id:"report",label:t("log.report"),onSelect:() => { desktopBridge()?.reportProblem?.(); }}] : []),
        ]} />} />
      <StatusStrip summary={t("status.thisComputer")} details={<><div className="status-metadata">
        {show && <span className="chip live"><Icon name="slides" /> {t("stage.slide", { n: show.index + 1, total: show.total })}</span>}
        {update?.status === "checking" && <span className="chip busy">{t("update.checking")}</span>}
        {update?.status === "downloading" && <span className="chip busy"><Icon name="down" /> {t("update.downloading", { version: update.version })}</span>}
        {update?.status === "downloaded" && <span className="chip live" title={t("update.ready", { version: update.version })}><Icon name="up" /> {update.version}</span>}
        {update?.status === "error" && <span className="chip err" title={update.error}>{t("update.error", { error: update.error.slice(0, 40) })}</span>}
        {publicLink && (
          <button className="chip live" title={t("pair.stopPublic")} onClick={() => desktopBridge()?.setRemoteShare?.(false)}>
            <Icon name="globe" /> {t("pair.publicChip")} <Icon name="close" />
          </button>
        )}
        {offline && <span className="chip err">{t("app.offline")}</span>}
        {eng.backend && <span className="chip live"><Icon name="circle" /> {BACKEND_LABELS[eng.backend]}</span>}
        {eng.slowMs && <span className="chip err" title={t("app.slowTitle")}><Icon name="clock" /> {t("app.slow", { ms: eng.slowMs })}</span>}
        {plan && eng.recording && (
          <span className="chip" title={t("plan.chipTitle")}>
            <Icon name="sliders" /> {t(`plan.stt.${plan.stt.backend ?? "none"}`)} · {t(`plan.decision.${plan.decision.provider ?? "none"}`)}
            {plan.decision.measuredMs ? ` ${plan.decision.measuredMs} ms` : ""}
          </span>
        )}
</div><ResourcesPanel compact embedded /></>} stats={<>
          {t("footer.stats", { calls: stats.calls, avg: stats.avgMs, cost: costLabel })}
          {stats.model ? ` · ${stats.model}` : ""}
          {state.screenStats?.frames
            ? ` · ${t("footer.screen", { n: state.screenStats.frames })}${state.screenStats.costUsd === null ? "" : ` $${state.screenStats.costUsd.toFixed(4)}`}`
            : ""}
</>} />
      {sessionInfo.pairRequests.length > 0 && (
        <div className="modal-bg">
          <div className="modal pairmodal">
            <div className="label">{t("pair.request")}</div>
            {sessionInfo.pairRequests.map((r) => (
              <div key={r.token} className="strip">
                <div className="label">{r.device || "phone"}</div>
                <div className="controls">
                  <button className="btn primary" onClick={() => sessionInfo.decidePair(r.token, "controller")}>
                    {t("pair.allowControl")}
                  </button>
                  <button className="btn" onClick={() => sessionInfo.decidePair(r.token, "viewer")}>
                    {t("pair.allowView")}
                  </button>
                  <button className="btn danger" onClick={() => sessionInfo.decidePair(r.token, "reject")}>
                    {t("pair.reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {startDialog && readiness && (
        <StartModeDialog
          readiness={readiness}
          returnFocusRef={startButtonRef}
          onCancel={() => { startAttempts.current.cancel(); setStartDialog(false); }}
          onPick={(mode, remember, auto) => {
            setStartDialog(false);
            setStartMode(remember ? (auto ? "auto" : mode) : "ask");
            void startTake(mode, readiness, startAttempts.current.begin());
          }}
        />
      )}
      {editing && <ScriptEditor initial={scriptText} onCancel={() => setEditing(false)} onSave={saveScript} />}
      {screen.sources && <SourceChooser sources={screen.sources} onPick={(s) => void screen.chooseSource(s)} />}
      {pendingImport && (
        <ScriptEditor
          initial={pendingImport.text}
          title={t("editor.imported", { n: pendingImport.script.sections.length })}
          warnings={pendingImport.warnings}
          onCancel={() => setPendingImport(null)}
          onSave={(txt) => {
            setPendingImport(null);
            void saveScript(txt);
          }}
        />
      )}
    </div>
  );
}

type Readiness = { openrouterKey: boolean; sttKey: boolean; whisper: boolean; sherpa: boolean; clef: boolean; stt: SttStatus; advice: { local: boolean; reason: "gpu" | "ram" | "none" }; gpuName: string };

/** Cloud or Local for this take, with what each needs and whether it is there. */
/** "Auto": local when the models are there and the machine can run them well (GPU first, else enough RAM), otherwise cloud. */
function autoPick(r: Readiness): "cloud" | "local" | null {
  if (r.whisper && r.clef && r.advice.local) return "local";
  if (r.openrouterKey && r.sttKey) return "cloud";
  if (r.whisper && r.clef) return "local";
  return null;
}

export function StartModeDialog({ readiness, onPick, onCancel, returnFocusRef }: { readiness: Readiness; onPick: (mode: "cloud" | "local", remember: boolean, auto?: boolean) => void; onCancel: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const cloudOk = readiness.openrouterKey && readiness.sttKey;
  const localOk = readiness.whisper && readiness.clef;
  const auto = autoPick(readiness);
  const autoWhy = auto === "local" ? t(readiness.advice.reason === "gpu" ? "start.autoGpu" : "start.autoRam", { gpu: readiness.gpuName }) : auto === "cloud" ? t("start.autoCloud") : "";
  const Line = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`check ${ok ? "ok" : "missing"}`}>
      <Icon name={ok ? "check" : "close"} /> {label} <span className="hint">· {ok ? t("start.ready") : t("start.missing")}</span>
    </div>
  );
  return (
    <Dialog title={t("start.title")} onClose={onCancel} className="startmode" returnFocusRef={returnFocusRef}>
        {auto && (
          <div className="strip autopick">
            <div>
              <strong>{t("start.autoTitle")}</strong> {t("start.autoPick", { mode: auto === "local" ? t("start.local") : t("start.cloud") })} <span className="hint">{autoWhy}</span>
            </div>
            <button className="btn primary" onClick={() => onPick(auto, remember, true)}>
              {t("ctl.start")} · {t("start.autoBtn")}
            </button>
          </div>
        )}
        <div className="modes">
          <div className={`mode ${cloudOk ? "" : "notready"}`}>
            <h3>☁ {t("start.cloud")}</h3>
            <p className="hint">{t("start.cloudHint")}</p>
            <Line ok={readiness.openrouterKey} label={t("start.keyOpenRouter")} />
            <Line ok={readiness.sttKey} label={t("start.keyStt")} />
            {!cloudOk && <p className="hint">{t("start.notReadyCloud")}</p>}
            <button className="btn primary" disabled={!cloudOk} onClick={() => onPick("cloud", remember)}>
              {t("ctl.start")} · {t("start.cloud")}
            </button>
          </div>
          <div className={`mode ${localOk ? "" : "notready"}`}>
            <h3>💻 {t("start.local")}</h3>
            <p className="hint">{t("start.localHint")}</p>
            <Line ok={readiness.whisper} label={t("start.whisper")} />
            <Line ok={readiness.clef} label={t("start.clef")} />
            {!localOk && <p className="hint">{t("start.notReadyLocal")}</p>}
            <button className="btn primary" disabled={!localOk} onClick={() => onPick("local", remember)}>
              {t("ctl.start")} · {t("start.local")}
            </button>
          </div>
        </div>
        <div className="controls">
          <label className="btn choice">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("start.remember")}
          </label>
          <a className="btn" href="/settings/local">
            {t("start.fix")}
          </a>
          <button className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
    </Dialog>
  );
}

/** Desktop-only chooser: screens and windows minus this app (ARCHITECTURE.md §6.2). */
export function SourceChooser({ sources, onPick }: { sources: ScreenSource[]; onPick: (s: ScreenSource | null) => void }) {
  const t = useT();
  return (
    <Dialog title={t("screen.chooserTitle")} onClose={() => onPick(null)}>
        <div className="hint">{t("screen.chooserHint")}</div>
        {sources.length === 0 && <div className="hint">{t("screen.chooserEmpty")}</div>}
        <div className="sources">
          {sources.map((s) => (
            <button key={s.id} className="source" onClick={() => onPick(s)}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div style={{ aspectRatio: "16/9", background: "#000" }} />}
              <span className="kind">{t(`screen.kind.${s.kind}`)}</span>
              <span className="name" title={s.name}>
                {s.name}
              </span>
            </button>
          ))}
        </div>
        <div className="controls">
          <button className="btn" onClick={() => onPick(null)}>
            {t("common.cancel")}
          </button>
        </div>
    </Dialog>
  );
}

export function ScriptEditor({
  initial,
  onSave,
  onCancel,
  title,
  warnings = [],
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  title?: string;
  warnings?: string[];
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [to, setTo] = useState("en");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const preview = parseScript(text);
  const translate = async () => {
    setBusy(true);
    setNote(t("editor.translating"));
    try {
      await ensureEngineToken();
      const res = await fetch("/api/script/translate", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ text, to }) });
      const j = (await res.json()) as { text?: string; model?: string; structureKept?: boolean; expected?: { points: number }; got?: { sections: number; points: number }; error?: string };
      if (!res.ok || !j.text) throw new Error(j.error ?? `HTTP ${res.status}`);
      setText(j.text);
      setNote(
        j.structureKept
          ? t("editor.translated", { model: j.model ?? "", sections: j.got?.sections ?? 0, points: j.got?.points ?? 0 })
          : t("editor.translateMismatch", { got: j.got?.points ?? 0, expected: j.expected?.points ?? 0 }),
      );
    } catch (err) {
      setNote(t("editor.translateFailed", { error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={title ?? t("editor.title")} onClose={onCancel}>
        {warnings.map((w, i) => (
          <span key={i} className="chip err">
            {w}
          </span>
        ))}
        <div className="hint">{t("editor.hint", { sections: preview.sections.length, points: preview.sections.reduce((n, s) => n + s.bullets.length, 0) })}</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="controls">
          <button className="btn primary" onClick={() => onSave(text)}>
            {t("common.save")}
          </button>
          <button className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <span className="hint" style={{ marginLeft: "auto" }}>{t("editor.translateTo")}</span>
          <select className="btn" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
            {[["en", "English"], ["it", "Italiano"], ["ro", "Română"], ["ru", "Русский"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"]].map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn" disabled={busy || !text.trim()} onClick={() => void translate()}>
            {busy ? t("editor.translating") : t("editor.translate")}
          </button>
        </div>
        {note && <div className="hint">{note}</div>}
    </Dialog>
  );
}
