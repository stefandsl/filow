"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bullet, BulletState, DecideResponse, Script, SttBackendId, SttStatus } from "@/lib/types";
import { parseScript } from "@/lib/script";
import { availableBackends, BACKEND_LABELS, createBackend, startAuto, type SttBackend } from "@/lib/stt";
import { browserSupported } from "@/lib/stt/browser";

const TICK_MS = 500; // how often we ask the model, like the original
const START_THRESHOLD = 0.7; // matches the rubric in app/api/decide/route.ts // confidence needed to flip a point to "started"
const TRANSCRIPT_WINDOW = 900; // characters of recent speech sent per tick
const STICKY_MS = 1500; // after a flip, ignore contradicting answers for a bit

type BackendChoice = "auto" | SttBackendId;

export default function Teleprompter() {
  const [script, setScript] = useState<Script>({ sections: [] });
  const [scriptText, setScriptText] = useState("");
  const [sectionIdx, setSectionIdx] = useState(0);
  const [states, setStates] = useState<Record<string, BulletState>>({});
  const [missed, setMissed] = useState<Bullet[]>([]);

  const [recording, setRecording] = useState(false);
  const [committed, setCommitted] = useState("");
  const [partial, setPartial] = useState("");

  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  // Resolved on the client only, so server and first client render agree.
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [choice, setChoice] = useState<BackendChoice>("auto");
  const [activeBackend, setActiveBackend] = useState<SttBackendId | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [stats, setStats] = useState({ calls: 0, totalMs: 0, cost: 0, model: "" });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendRef = useRef<SttBackend | null>(null);
  const inFlight = useRef(false);
  const lastSent = useRef("");
  const flippedAt = useRef<Record<string, number>>({});

  const section = script.sections[sectionIdx];
  const nextSection = script.sections[sectionIdx + 1];

  const pushLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-30), `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  // ---- script ----------------------------------------------------------
  const loadScript = useCallback(async () => {
    const res = await fetch("/api/script");
    const { text, script } = (await res.json()) as { text: string; script: Script };
    setScriptText(text);
    setScript(script);
    setStates({});
    setMissed([]);
    setSectionIdx(0);
    flippedAt.current = {};
  }, []);

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
    setScript(script);
    setEditing(false);
  };

  // ---- transcription ---------------------------------------------------
  const stopTake = useCallback(() => {
    backendRef.current?.stop();
    backendRef.current = null;
    setRecording(false);
    setActiveBackend(null);
  }, []);

  const startTake = async () => {
    setError(null);
    setCommitted("");
    setPartial("");
    lastSent.current = "";
    const handlers = {
      onTranscript: (e: { committed?: string; partial?: string }) => {
        if (e.committed) setCommitted((c) => (c + e.committed).slice(-6000));
        if (e.partial !== undefined) setPartial(e.partial);
      },
      onError: (m: string) => {
        pushLog(`error: ${m}`);
        setError(m);
      },
      onReady: () => pushLog("transcription ready"),
    };
    try {
      if (choice === "auto") {
        const candidates = availableBackends(sttStatus, hasWebSpeech);
        const { backend } = await startAuto(candidates, handlers, (id, note) =>
          pushLog(`${BACKEND_LABELS[id]}: ${note}`),
        );
        backendRef.current = backend;
        setActiveBackend(backend.id);
      } else {
        const backend = createBackend(choice);
        await backend.start(handlers);
        backendRef.current = backend;
        setActiveBackend(backend.id);
        pushLog(`${BACKEND_LABELS[choice]}: live`);
      }
      setRecording(true);
    } catch (err) {
      setError((err as Error).message);
      pushLog(`could not start transcription: ${(err as Error).message}`);
      stopTake();
    }
  };

  useEffect(() => () => backendRef.current?.stop(), []);

  // ---- decision loop ---------------------------------------------------
  const transcript = useMemo(() => (committed + " " + partial).trim(), [committed, partial]);

  useEffect(() => {
    if (!recording || !section) return;
    const timer = window.setInterval(async () => {
      if (inFlight.current) return;
      const windowText = transcript.slice(-TRANSCRIPT_WINDOW);
      if (!windowText || windowText === lastSent.current) return;
      const open = section.bullets.filter((b) => states[b.id]?.status !== "started");
      if (!open.length) return;

      inFlight.current = true;
      lastSent.current = windowText;
      try {
        const res = await fetch("/api/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: windowText,
            bullets: open,
            sectionTitle: section.title,
            covered: section.bullets.filter((b) => states[b.id]?.status === "started").map((b) => b.text),
            upcoming: script?.sections[sectionIdx + 1]?.bullets.map((b) => b.text) ?? [],
          }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          setError(error ?? `decide failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as DecideResponse;
        setError(null);
        setStats((s) => ({
          calls: s.calls + 1,
          totalMs: s.totalMs + data.latencyMs,
          cost: s.cost + data.cost,
          model: data.model,
        }));
        const now = Date.now();
        setStates((prev) => {
          const next = { ...prev };
          for (const d of data.decisions) {
            const cur = next[d.id] ?? { status: "waiting" as const, confidence: 0 };
            if (cur.status === "started") continue;
            const recentlyFlipped = now - (flippedAt.current[d.id] ?? 0) < STICKY_MS;
            const started = d.started && d.confidence >= START_THRESHOLD && !recentlyFlipped;
            next[d.id] = started
              ? { status: "started", confidence: d.confidence, startedAt: now }
              : { status: "waiting", confidence: d.confidence };
            if (started) flippedAt.current[d.id] = now;
          }
          return next;
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        inFlight.current = false;
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [recording, section, states, transcript]);

  // ---- navigation ------------------------------------------------------
  const goTo = (idx: number) => {
    if (!section) return;
    if (idx > sectionIdx) {
      // Everything still open in the sections we skip past becomes "missed".
      const skipped = script.sections
        .slice(sectionIdx, idx)
        .flatMap((s) => s.bullets)
        .filter((b) => states[b.id]?.status !== "started");
      setMissed((m) => [...m, ...skipped.filter((b) => !m.some((x) => x.id === b.id))]);
    }
    setSectionIdx(Math.max(0, Math.min(script.sections.length - 1, idx)));
    lastSent.current = "";
  };

  const resetSection = () => {
    if (!section) return;
    setStates((prev) => {
      const next = { ...prev };
      for (const b of section.bullets) delete next[b.id];
      return next;
    });
    for (const b of section.bullets) delete flippedAt.current[b.id];
    lastSent.current = "";
  };

  const clearMissed = (id: string) => setMissed((m) => m.filter((b) => b.id !== id));

  const avgMs = stats.calls ? Math.round(stats.totalMs / stats.calls) : 0;
  const tail = transcript.slice(-160);

  const availability = availableBackends(sttStatus, hasWebSpeech);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <span className="subtitle">/ live talking points</span>
        <span className="spacer" />
        {activeBackend && <span className="chip live">● {BACKEND_LABELS[activeBackend]}</span>}
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
              const st = states[b.id] ?? { status: "waiting", confidence: 0 };
              const started = st.status === "started";
              const hot = !started && st.confidence >= 0.3;
              return (
                <div key={b.id} className={`point ${started ? "started" : ""} ${hot ? "hot" : ""}`}>
                  <span className="mark">{started ? "✓" : ""}</span>
                  <span className="status">
                    {started ? "started" : "waiting"}
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
                  <span key={b.id} className={`next-item ${states[b.id]?.status === "started" ? "done" : ""}`}>
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
                  <span key={b.id} className="missed-item" title="Click to dismiss" onClick={() => clearMissed(b.id)}>
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
        {recording ? (
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
          disabled={recording}
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
        <button className="btn" onClick={() => goTo(sectionIdx - 1)} disabled={sectionIdx === 0}>
          ← Prev section
        </button>
        <button className="btn" onClick={() => goTo(sectionIdx + 1)} disabled={!nextSection}>
          Next section →
        </button>
        <button className="btn" onClick={resetSection}>
          Reset section
        </button>
        <button className="btn" onClick={loadScript}>
          Reload script
        </button>
      </div>

      <div className="footer">
        <span>
          Calls {stats.calls} · Avg {avgMs} ms · Cost ${stats.cost.toFixed(6)}
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

      {editing && (
        <ScriptEditor
          initial={scriptText}
          onCancel={() => setEditing(false)}
          onSave={saveScript}
        />
      )}
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
