"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { missedPoints, parseScript, type Script, type SttBackendId, type SttStatus } from "@intelliprompter/core";
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

type BackendChoice = "auto" | SttBackendId;

export default function Teleprompter() {
  const { engine, state } = useEngine();
  const sessionInfo = useSession(engine);
  const [scriptText, setScriptText] = useState("");
  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  // Resolved on the client only, so server and first client render agree.
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [choice, setChoice] = useState<BackendChoice>("auto");
  const [log, setLog] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [offline, setOffline] = useState(false);
  const backendRef = useRef<SttBackend | null>(null);

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

  // ---- script ----------------------------------------------------------
  const loadScript = useCallback(async () => {
    const res = await fetch("/api/script");
    const { text, script } = (await res.json()) as { text: string; script: Script };
    setScriptText(text);
    engine.loadScript(script);
  }, [engine]);

  useEffect(() => {
    setHasWebSpeech(browserSupported());
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
  }, [engine]);

  const startTake = async () => {
    engine.setError(undefined);
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
  const availability = availableBackends(sttStatus, { webSpeech: hasWebSpeech, whisper: hasWebSpeech || typeof window !== "undefined", offline });
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
        <div className="strip">
          <div className="label">No script</div>
          <div>
            Add sections and bullets in <code>script.md</code> or click Edit points.
          </div>
        </div>
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
        <a className="btn" href="/settings/local" title="Local models, decision provider, privacy">
          Settings
        </a>
      </div>

      <div className="footer">
        <span>
          Calls {stats.calls} · Avg {stats.avgMs} ms · Cost {costLabel}
          {stats.model ? ` · ${stats.model}` : ""}
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
    </div>
  );
}

function ScriptEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const preview = parseScript(text);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Edit points</div>
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
