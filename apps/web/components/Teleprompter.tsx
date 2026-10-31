"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { missedPoints, notesToMarkdown, parseScript, SCREEN_MODE_LABELS, type ImportResponse, type ScreenMode, type ScreenNote, type Script, type SttBackendId, type SttStatus } from "@intelliprompter/core";
import { OnScreenStrip } from "@intelliprompter/ui";
import {
  availableBackends,
  BACKEND_LABELS,
  browserSupported,
  createBackend,
  startAuto,
  type SttBackend,
} from "@intelliprompter/stt";
import { useEngine } from "./useEngine";
import { engineHeaders, useSession } from "./useSession";
import { PairPanel } from "./PairPanel";
import { useScreenSense, type ScreenSource } from "./useScreenSense";

type BackendChoice = "auto" | SttBackendId;

export default function Teleprompter() {
  const { engine, state } = useEngine();
  const sessionInfo = useSession(engine);
  const [scriptText, setScriptText] = useState("");
  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  // Resolved on the client only, so server and first client render agree.
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<BackendChoice>("auto");
  const [log, setLog] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastNotes, setLastNotes] = useState<ScreenNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportResponse | null>(null);
  const backendRef = useRef<SttBackend | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Offline mode is owned by the desktop shell (menu toggle); the web deploy reads INTELLIPROMPTER_OFFLINE.
  useEffect(() => {
    const bridge = (globalThis as { intelliprompter?: { offline?: boolean; onOffline?: (fn: (v: boolean) => void) => void } }).intelliprompter;
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
    a.download = `intelliprompter-notes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
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

  const startTake = async () => {
    engine.setError(undefined);
    setLastNotes([]);
    const handlers = {
      onTranscript: (e: { committed?: string; partial?: string }) => engine.feed(e),
      onError: (m: string) => {
        pushLog(`error: ${m}`);
        engine.setError(m);
      },
      onReady: () => pushLog("transcription ready"),
    };
    try {
      if (choice === "auto") {
        const candidates = availableBackends(sttStatus, { webSpeech: hasWebSpeech, offline });
        const { backend } = await startAuto(
          candidates,
          handlers,
          (id, note) => pushLog(`${BACKEND_LABELS[id]}: ${note}`),
          { headers: engineHeaders() },
        );
        backendRef.current = backend;
        engine.setBackend(backend.id);
      } else {
        // Explicit choice: never fall back silently.
        const backend = createBackend(choice, { headers: engineHeaders() });
        await backend.start(handlers);
        backendRef.current = backend;
        engine.setBackend(backend.id);
        pushLog(`${BACKEND_LABELS[choice]}: live`);
      }
      engine.start();
    } catch (err) {
      engine.setError((err as Error).message);
      pushLog(`could not start transcription: ${(err as Error).message}`);
      stopTake();
    }
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <span className="subtitle">/ live talking points</span>
        <span className="spacer" />
        <PairPanel info={sessionInfo.info} status={sessionInfo.status} error={sessionInfo.error} />
        {offline && <span className="chip err">OFFLINE</span>}
        {eng.backend && <span className="chip live">● {BACKEND_LABELS[eng.backend]}</span>}
        {screen.status === "watching" && <span className={`chip ${state.screenStats?.analysing ? "busy" : "live"}`}>👁 {state.screenStats?.analysing ? "analysing…" : screen.label}</span>}
        {error && <span className="chip err">{error}</span>}
      </header>

      {section ? (
        <>
          <div>
            <div className="eyebrow">02 / Your points</div>
            <div className="section-count">
              Section {sectionIdx + 1} / {script.sections.length}
            </div>
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
                  title="Double-click to toggle"
                >
                  <span className="mark">{started ? "✓" : ""}</span>
                  <span className="status">
                    {st.status}
                    {!started && <span className="pct">· {Math.round(st.confidence * 100)}%</span>}
                  </span>
                  <span className="text">{b.text}</span>
                </div>
              );
            })}
          </div>

          {nextSection && (
            <div className="strip">
              <div className="label">Next / {nextSection.title}</div>
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
              <div className="label">▾ ! Missed {missed.length}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span
                    key={b.id}
                    className="missed-item"
                    title="Click to re-open this point"
                    onClick={() => engine.dispatch({ type: "reopen", id: b.id })}
                  >
                    ! MISSED · {b.text}
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
            <div className="label">No script</div>
            <div>
              Add sections and bullets in <code>script.md</code>, click Edit points, import a document, or just watch your screen: Screen Sense builds a section per slide.
            </div>
          </div>
        </>
      )}

      <div className="controls">
        {eng.recording ? (
          <button className="btn danger" onClick={stopTake}>
            Stop take
          </button>
        ) : (
          <button className="btn primary" onClick={startTake} disabled={!section || availability.length === 0}>
            Start take
          </button>
        )}
        <select
          className="btn"
          value={choice}
          disabled={eng.recording}
          onChange={(e) => setChoice(e.target.value as BackendChoice)}
          title="Transcription backend"
        >
          <option value="auto">Auto (fastest available)</option>
          {availability.map((id) => (
            <option key={id} value={id}>
              {BACKEND_LABELS[id]}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setEditing(true)}>
          Edit points
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "prevSection" })} disabled={sectionIdx === 0}>
          ← Prev section
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "nextSection" })} disabled={!nextSection}>
          Next section →
        </button>
        <button className="btn" onClick={() => engine.dispatch({ type: "resetSection" })}>
          Reset section
        </button>
        <button className="btn" onClick={loadScript}>
          Reload script
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing} title="PDF, PPTX, DOCX, TXT or MD → talking points">
          {importing ? "Importing…" : "Import document"}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.pptx,.docx,.txt,.md,.markdown" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void importDocument(e.target.files[0])} />
        <a className="btn" href="/settings/local" title="Local models, decision provider, privacy, Screen Sense">
          Settings
        </a>
      </div>

      {screen.status !== "unsupported" && (
        <div className="controls">
          <div className="group">
            <span className="label">Screen Sense</span>
            {screen.status === "watching" ? (
              <button className="btn danger" onClick={screen.stopWatching}>
                Stop watching
              </button>
            ) : (
              <button className="btn primary" onClick={() => void screen.watchScreen()} disabled={offline || !screen.enabled} title={offline ? "Frames would leave this machine; off in offline mode" : "Pick a screen or window to watch"}>
                Watch screen…
              </button>
            )}
            <select className="btn" value={screen.mode} onChange={(e) => screen.setMode(e.target.value as ScreenMode)} title="Cost dial: when a frame goes to the vision model">
              {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
                <option key={m} value={m}>
                  {SCREEN_MODE_LABELS[m]}
                </option>
              ))}
            </select>
            <button className="btn" onClick={screen.lookNow} disabled={offline || (screen.status !== "watching" && !screen.desktop)} title={screen.desktop && screen.status !== "watching" ? "Drag a region of the screen to send" : "Send the current frame now"}>
              Look now
            </button>
            {screen.desktop && (
              <button className="btn" onClick={() => void screen.captureRegion()} disabled={offline} title="Drag a rectangle; also on the global hotkey">
                Region…
              </button>
            )}
            {state.screen && (
              <button className="btn" onClick={screen.forget}>
                Forget
              </button>
            )}
            {lastNotes.length > 0 && (
              <button className="btn" onClick={exportNotes} title="Markdown: one entry per slide with what was on screen and what you said">
                Export notes ({lastNotes.length})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="footer">
        <span>
          Calls {stats.calls} · Avg {stats.avgMs} ms · Cost {costLabel}
          {stats.model ? ` · ${stats.model}` : ""}
          {state.screenStats?.frames ? ` · Screen ${state.screenStats.frames} frames${state.screenStats.costUsd === null ? "" : ` $${state.screenStats.costUsd.toFixed(4)}`}` : ""}
        </span>
        <span className="transcript">
          <span>Transcript / {tail || "…"}</span>
        </span>
      </div>

      {log.length > 0 && (
        <div className="log">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {editing && <ScriptEditor initial={scriptText} onCancel={() => setEditing(false)} onSave={saveScript} />}
      {screen.sources && <SourceChooser sources={screen.sources} onPick={(s) => void screen.chooseSource(s)} />}
      {pendingImport && (
        <ScriptEditor
          initial={pendingImport.text}
          title={`Imported ${pendingImport.script.sections.length} sections`}
          warnings={pendingImport.warnings}
          onCancel={() => setPendingImport(null)}
          onSave={(t) => {
            setPendingImport(null);
            void saveScript(t);
          }}
        />
      )}
    </div>
  );
}

/** Desktop-only chooser: screens and windows minus this app (ARCHITECTURE.md §6.2). */
function SourceChooser({ sources, onPick }: { sources: ScreenSource[]; onPick: (s: ScreenSource | null) => void }) {
  return (
    <div className="modal-bg" onClick={() => onPick(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Watch which screen or window?</div>
        <div className="hint">Frames stay in memory and go once to the vision model when the content changes. This window is excluded.</div>
        {sources.length === 0 && <div className="hint">No capturable screens or windows found.</div>}
        <div className="sources">
          {sources.map((s) => (
            <button key={s.id} className="source" onClick={() => onPick(s)}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div style={{ aspectRatio: "16/9", background: "#000" }} />}
              <span className="kind">{s.kind}</span>
              <span className="name" title={s.name}>
                {s.name}
              </span>
            </button>
          ))}
        </div>
        <div className="controls">
          <button className="btn" onClick={() => onPick(null)}>
            Cancel
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
  title = "Edit points",
  warnings = [],
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  title?: string;
  warnings?: string[];
}) {
  const [text, setText] = useState(initial);
  const preview = parseScript(text);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">{title}</div>
        {warnings.map((w, i) => (
          <span key={i} className="chip err">
            {w}
          </span>
        ))}
        <div className="hint">
          One <code># Section title</code> line per section, then <code>- bullet</code> lines. Saved to{" "}
          <code>script.md</code>. Parsed: {preview.sections.length} sections,{" "}
          {preview.sections.reduce((n, s) => n + s.bullets.length, 0)} points.
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="controls">
          <button className="btn primary" onClick={() => onSave(text)}>
            Save
          </button>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
