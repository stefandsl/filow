"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  missedPoints,
  notesToMarkdown,
  parseScript,
  SCREEN_MODE_LABELS,
  type ImportResponse,
  type ScreenMode,
  type ScreenNote,
  type Script,
  type SttBackendId,
  type SttStatus,
} from "@filow/core";
import { LangProvider, OnScreenStrip, useLang, useT } from "@filow/ui";
import { availableBackends, BACKEND_LABELS, browserSupported, createBackend, selectedWhisperModel, startAuto, whisperCached, type SttBackend } from "@filow/stt";
import { getStartMode, setDecisionProvider, setStartMode, type StartMode } from "@/lib/prefs";
import { useEngine } from "./useEngine";
import { engineHeaders, useSession } from "./useSession";
import { PairPanel } from "./PairPanel";
import { useScreenSense, type ScreenSource } from "./useScreenSense";
import { LangSwitch, ThemeSwitch, useUiLang, useUiTheme } from "./LangSwitch";
import { desktopBridge, type UpdateStatus } from "@/lib/sessionUrl";

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
  const [starting, setStarting] = useState(false);
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
  const cancelRef = useRef(false);
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
    setLog((l) => [...l.slice(-30), `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  // ---- Screen Sense (ARCHITECTURE.md §6) --------------------------------
  const screen = useScreenSense(engine, state, pushLog);

  const importDocument = async (file: File) => {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import", { method: "POST", headers: engineHeaders(), body: form });
      const out = (await res.json()) as ImportResponse & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `import failed (${res.status})`);
      setPendingImport(out);
      pushLog(`Imported ${file.name}: ${out.script.sections.length} sections from ${out.pages} ${out.kind === "pptx" ? "slides" : "pages"}`);
    } catch (err) {
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
    const res = await fetch("/api/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const { script } = (await res.json()) as { script: Script };
    setScriptText(text);
    engine.loadScript(script);
    setEditing(false);
  };

  // ---- transcription ---------------------------------------------------
  const stopTake = useCallback(() => {
    backendRef.current?.stop();
    backendRef.current = null;
    engine.stop();
    // Live notes (§6.4) are offered for export until the next take starts.
    if (engine.getNotes().length) setLastNotes([...engine.getNotes()]);
  }, [engine]);

  /** Open the microphone once up front: a clear message beats five backends failing in a row. */
  const probeMic = async (): Promise<boolean> => {
    pushLog(t("mic.checking"));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch (err) {
      const name = (err as DOMException).name;
      const msg = name === "NotFoundError" || name === "OverconstrainedError" ? t("mic.notFound") : name === "NotAllowedError" || name === "SecurityError" ? t("mic.denied") : `${t("mic.busy")} (${(err as Error).message})`;
      engine.setError(msg);
      pushLog(msg);
      return false;
    }
  };

  /** What each mode needs, read fresh every time the dialog opens. */
  const loadReadiness = async (): Promise<Readiness> => {
    const [stt, local, whisper] = await Promise.all([
      fetch("/api/stt/status").then((r) => r.json()).catch(() => ({ elevenlabs: false, openai: false })) as Promise<SttStatus>,
      fetch("/api/local/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null) as Promise<{ openrouterKey?: boolean; ollama?: { ok: boolean }; models?: Array<{ name: string; installed: boolean }> } | null>,
      whisperCached(selectedWhisperModel()).catch(() => false),
    ]);
    setSttStatus(stt);
    return {
      openrouterKey: Boolean(local?.openrouterKey),
      sttKey: Boolean(stt.elevenlabs || stt.openai),
      whisper,
      clef: Boolean(local?.ollama?.ok && local?.models?.some((m) => m.name.startsWith("clef") && m.installed)),
      stt,
    };
  };

  /** Start button: ask Cloud / Local unless a choice is remembered. */
  const requestStart = async () => {
    const mode = getStartMode();
    const r = await loadReadiness();
    setReadiness(r);
    if (mode === "ask" || (mode === "cloud" && !(r.openrouterKey && r.sttKey)) || (mode === "local" && !(r.whisper && r.clef))) {
      setStartDialog(true);
      return;
    }
    await startTake(mode, r);
  };

  const startTake = async (mode: "cloud" | "local", r: Readiness) => {
    engine.setError(undefined);
    setLastNotes([]);
    cancelRef.current = false;
    setStarting(true);
    // The mode decides the provider and the transcription backend; no silent fallback to the other side.
    setDecisionProvider(mode === "local" ? "clef-local" : "openrouter");
    let backend: BackendChoice = choice;
    if (backend === "auto") {
      if (mode === "local") backend = "whisper";
      else backend = r.stt.elevenlabs ? "elevenlabs" : r.stt.openai ? "openai" : hasWebSpeech ? "browser" : "auto";
    }
    if (backend === "auto") {
      engine.setError(t("start.notReadyCloud"));
      setStarting(false);
      return;
    }
    pushLog(`${mode === "local" ? t("start.local") : t("start.cloud")} · ${BACKEND_LABELS[backend]}`);
    if (!(await probeMic())) {
      setStarting(false);
      return;
    }
    const handlers = {
      onTranscript: (e: { committed?: string; partial?: string }) => engine.feed(e),
      onError: (m: string) => {
        pushLog(`error: ${m}`);
        engine.setError(m);
      },
      onReady: () => pushLog("transcription ready"),
    };
    try {
      {
        // Explicit backend from the chosen mode: never fall back silently.
        const b = createBackend(backend, { headers: engineHeaders() });
        await b.start(handlers);
        backendRef.current = b;
        engine.setBackend(b.id);
        pushLog(`${BACKEND_LABELS[backend]}: live`);
      }
      if (cancelRef.current) {
        stopTake();
        return;
      }
      engine.start();
    } catch (err) {
      if (!cancelRef.current) {
        engine.setError((err as Error).message);
        pushLog(`could not start transcription: ${(err as Error).message}`);
      }
      stopTake();
    } finally {
      setStarting(false);
    }
  };

  const cancelStart = () => {
    cancelRef.current = true;
    stopTake();
    setStarting(false);
  };

  useEffect(() => () => backendRef.current?.stop(), []);

  // When the engine stops itself (cost cap), release the microphone too.
  useEffect(() => {
    if (!eng.recording && backendRef.current) {
      backendRef.current.stop();
      backendRef.current = null;
    }
  }, [eng.recording]);

  const tail = state.transcriptTail;
  const availability = availableBackends(sttStatus, { webSpeech: hasWebSpeech, whisper: mounted, offline });
  const costLabel = stats.costUsd === null ? "n/a" : `$${stats.costUsd.toFixed(6)}`;
  const lang = useLang();

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> FILOW
        </div>
        <span className="subtitle">{t("app.tagline")}</span>
        <span className="spacer" />
        <PairPanel info={sessionInfo.info} status={sessionInfo.status} error={sessionInfo.error} onNewCode={() => void sessionInfo.newCode()} />
        {show && <span className="chip live">📽 {t("stage.slide", { n: show.index + 1, total: show.total })}</span>}
        {update?.status === "checking" && <span className="chip busy">{t("update.checking")}</span>}
        {update?.status === "downloading" && <span className="chip busy">⬇ {t("update.downloading", { version: update.version })}</span>}
        {update?.status === "downloaded" && <span className="chip live" title={t("update.ready", { version: update.version })}>⬆ {update.version}</span>}
        {update?.status === "error" && <span className="chip err" title={update.error}>{t("update.error", { error: update.error.slice(0, 40) })}</span>}
        {publicLink && (
          <button className="chip live" title={t("pair.stopPublic")} onClick={() => desktopBridge()?.setRemoteShare?.(false)}>
            🌐 {t("pair.publicChip")} ✕
          </button>
        )}
        {offline && <span className="chip err">{t("app.offline")}</span>}
        {eng.backend && <span className="chip live">● {BACKEND_LABELS[eng.backend]}</span>}
        {screen.status === "watching" && (
          <span className={`chip ${state.screenStats?.analysing ? "busy" : "live"}`}>👁 {state.screenStats?.analysing ? t("app.analysing") : screen.label}</span>
        )}
        {error && <span className="chip err">{error}</span>}
        <ThemeSwitch pref={theme} onChange={onTheme} />
        <LangSwitch lang={lang} onChange={onLang} />
      </header>

      {section ? (
        <>
          <div>
            <div className="eyebrow">{t("stage.eyebrow")}</div>
            <div className="section-count">{t("stage.section", { n: sectionIdx + 1, total: script.sections.length })}</div>
            <h1 className="section-title">{section.title}</h1>
          </div>

          {state.screen && (
            <OnScreenStrip screen={state.screen} unmentioned={state.unmentioned} analysing={state.screenStats?.analysing} onLookNow={screen.lookNow} onForget={screen.forget} />
          )}

          <div className="points">
            {section.bullets.map((b) => {
              const st = points[b.id] ?? { status: "waiting", confidence: 0 };
              const started = st.status === "started";
              const hot = !started && st.confidence >= 0.3;
              return (
                <div
                  key={b.id}
                  className={`point ${started ? "started" : ""} ${hot ? "hot" : ""}`}
                  onDoubleClick={() => engine.dispatch(started ? { type: "reopen", id: b.id } : { type: "markStarted", id: b.id })}
                  title={t("stage.toggle")}
                >
                  <span className="mark">{started ? "✓" : ""}</span>
                  <span className="status">
                    {t(`status.${st.status}`)}
                    {!started && <span className="pct">· {Math.round(st.confidence * 100)}%</span>}
                  </span>
                  <span className="text">{b.text}</span>
                </div>
              );
            })}
          </div>

          {nextSection && (
            <div className="strip">
              <div className="label">{t("stage.next", { title: nextSection.title })}</div>
              <div className="row">
                {nextSection.bullets.map((b) => (
                  <span key={b.id} className={`next-item ${points[b.id]?.status === "started" ? "done" : ""}`}>
                    ○ {b.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {missed.length > 0 && (
            <div className="strip">
              <div className="label">{t("stage.missed", { n: missed.length })}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span key={b.id} className="missed-item" title={t("stage.reopen")} onClick={() => engine.dispatch({ type: "reopen", id: b.id })}>
                    {t("stage.missedItem", { text: b.text })}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {state.screen && <OnScreenStrip screen={state.screen} unmentioned={state.unmentioned} analysing={state.screenStats?.analysing} onLookNow={screen.lookNow} onForget={screen.forget} />}
          <div className="strip">
            <div className="label">{t("stage.noScript")}</div>
            <div>{t("stage.noScriptHint")}</div>
          </div>
        </>
      )}

      <div className="controls">
        {eng.recording ? (
          <button className="btn danger" onClick={stopTake}>
            {t("ctl.stop")}
          </button>
        ) : starting ? (
          <>
            <button className="btn primary" disabled>
              {t("ctl.starting")}
            </button>
            <button className="btn danger" onClick={cancelStart}>
              {t("ctl.cancel")}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => void requestStart()} disabled={!section || availability.length === 0}>
            {t("ctl.start")}
          </button>
        )}
        <select className="btn" value={choice} disabled={eng.recording} onChange={(e) => setChoice(e.target.value as BackendChoice)} title={t("ctl.backend")}>
          <option value="auto">{t("ctl.auto")}</option>
          {availability.map((id) => (
            <option key={id} value={id}>
              {BACKEND_LABELS[id]}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setEditing(true)}>
          {t("ctl.edit")}
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "prevSection" })} disabled={sectionIdx === 0}>
          {t("ctl.prev")}
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "nextSection" })} disabled={!nextSection}>
          {t("ctl.next")}
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "resetSection" })}>
          {t("ctl.reset")}
        </button>
        <button className="btn" onClick={loadScript}>
          {t("ctl.reload")}
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing} title={t("ctl.importTitle")}>
          {importing ? t("ctl.importing") : t("ctl.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.pptx,.docx,.txt,.md,.markdown"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && void importDocument(e.target.files[0])}
        />
        <a className="btn" href="/settings/local" title={t("ctl.settingsTitle")}>
          {t("ctl.settings")}
        </a>
      </div>

      {update?.status === "downloaded" && !updateDismissed && (
        <div className="update-banner">
          <span>⬆ {t("update.ready", { version: update.version })}</span>
          <button className="btn primary" onClick={() => desktopBridge()?.installUpdate?.()}>
            {t("update.restart")}
          </button>
          <button className="btn" onClick={() => setUpdateDismissed(true)}>
            {t("update.later")}
          </button>
        </div>
      )}
      {error && !eng.recording && <div className="chip err banner">{error}</div>}

      {screen.status !== "unsupported" && (
        <div className="controls">
          <div className="group">
            <span className="label">{t("screen.label")}</span>
            {screen.status === "watching" ? (
              <button className="btn danger" onClick={screen.stopWatching}>
                {t("screen.stopWatching")}
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => void screen.watchScreen()}
                disabled={offline || !screen.enabled}
                title={offline ? t("screen.watchOffline") : t("screen.watchTitle")}
              >
                {t("screen.watch")}
              </button>
            )}
            <select className="btn" value={screen.mode} onChange={(e) => screen.setMode(e.target.value as ScreenMode)} title={t("screen.modeTitle")}>
              {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
                <option key={m} value={m}>
                  {t(`mode.${m}`)}
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={screen.lookNow}
              disabled={offline || (screen.status !== "watching" && !screen.desktop)}
              title={screen.desktop && screen.status !== "watching" ? t("screen.lookNowRegion") : t("screen.lookNowFrame")}
            >
              {t("screen.lookNow")}
            </button>
            {screen.desktop && (
              <button className="btn" onClick={() => void screen.captureRegion()} disabled={offline} title={t("screen.regionTitle")}>
                {t("screen.region")}
              </button>
            )}
            {state.screen && (
              <button className="btn" onClick={screen.forget}>
                {t("screen.forget")}
              </button>
            )}
            {lastNotes.length > 0 && (
              <button className="btn" onClick={exportNotes} title={t("screen.exportTitle")}>
                {t("screen.exportNotes", { n: lastNotes.length })}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="footer">
        <span>
          {t("footer.stats", { calls: stats.calls, avg: stats.avgMs, cost: costLabel })}
          {stats.model ? ` · ${stats.model}` : ""}
          {state.screenStats?.frames
            ? ` · ${t("footer.screen", { n: state.screenStats.frames })}${state.screenStats.costUsd === null ? "" : ` $${state.screenStats.costUsd.toFixed(4)}`}`
            : ""}
        </span>
        <span className="transcript">
          <span>
            {t("footer.transcript")} {tail || "…"}
          </span>
        </span>
      </div>

      {log.length > 0 && (
        <div className="log">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {sessionInfo.pairRequests.length > 0 && (
        <div className="modal-bg">
          <div className="modal pairmodal">
            <div className="eyebrow">{t("pair.request")}</div>
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
          onCancel={() => setStartDialog(false)}
          onPick={(mode, remember) => {
            setStartDialog(false);
            setStartMode(remember ? mode : "ask");
            void startTake(mode, readiness);
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

type Readiness = { openrouterKey: boolean; sttKey: boolean; whisper: boolean; clef: boolean; stt: SttStatus };

/** Cloud or Local for this take, with what each needs and whether it is there. */
function StartModeDialog({ readiness, onPick, onCancel }: { readiness: Readiness; onPick: (mode: "cloud" | "local", remember: boolean) => void; onCancel: () => void }) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const cloudOk = readiness.openrouterKey && readiness.sttKey;
  const localOk = readiness.whisper && readiness.clef;
  const Line = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`check ${ok ? "ok" : "missing"}`}>
      {ok ? "✓" : "✗"} {label} <span className="hint">· {ok ? t("start.ready") : t("start.missing")}</span>
    </div>
  );
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal startmode" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">{t("start.title")}</div>
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
      </div>
    </div>
  );
}

/** Desktop-only chooser: screens and windows minus this app (ARCHITECTURE.md §6.2). */
function SourceChooser({ sources, onPick }: { sources: ScreenSource[]; onPick: (s: ScreenSource | null) => void }) {
  const t = useT();
  return (
    <div className="modal-bg" onClick={() => onPick(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">{t("screen.chooserTitle")}</div>
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
      </div>
    </div>
  );
}

function ScriptEditor({
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
  const preview = parseScript(text);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">{title ?? t("editor.title")}</div>
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
        </div>
      </div>
    </div>
  );
}
