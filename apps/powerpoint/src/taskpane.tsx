/* global Office */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, type SessionClient } from "@intelliprompter/client";
import { Engine, parseScript, type Command, type DecideRequest, type DecideResponse, type SessionState, type SttStatus } from "@intelliprompter/core";
import { availableBackends, BACKEND_LABELS, createBackend, startAuto, type SttBackend } from "@intelliprompter/stt";
import { StageView } from "@intelliprompter/ui";
import { getSelectedSlide, hostInfo, onSelectionChange, readNotesAsScript, selectSlide, supportsNotes } from "./office";
import "./taskpane.css";

type Mode = "engine" | "view";
const ORIGIN = window.location.origin; // the pane is served by the Intelliprompter server (or the Vite dev proxy)
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`ppt:${k}`) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`ppt:${k}`, v);
    } catch {
      /* ignore */
    }
  },
};

function App() {
  const host = hostInfo();
  const [mode, setMode] = useState<Mode>(() => (store.get("mode") as Mode) || (host.canUseMic ? "engine" : "view"));
  useEffect(() => store.set("mode", mode), [mode]);
  return (
    <div className="pane">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <span className="spacer" />
        <select className="btn" value={mode} onChange={(e) => setMode(e.target.value as Mode)} title="Engine mode runs the microphone here; View mode mirrors a session from another device">
          <option value="engine" disabled={!host.canUseMic}>
            Engine (mic here){host.canUseMic ? "" : " · not on this host"}
          </option>
          <option value="view">View (pair by code)</option>
        </select>
      </header>
      {mode === "engine" ? <EnginePane webSpeech={host.webSpeech} /> : <ViewPane />}
      <footer className="help">
        Live presenting: PowerPoint hides task panes in Slide Show, and its API cannot follow the show. Use the phone mirror or the desktop app on stage; this pane loads the script and follows the selected slide while editing.
      </footer>
    </div>
  );
}

// ---- shared: slide sync -------------------------------------------------------
function useSlideSync(state: SessionState | null, send: (cmd: Command) => void) {
  const lastSelected = useRef(-1);
  useEffect(() => {
    const off = onSelectionChange((pos) => {
      lastSelected.current = pos.index;
      send({ type: "slideChanged", index: pos.index, total: pos.total, title: pos.title });
    });
    return off;
  }, [send]);
  const idx = state?.sectionIdx ?? -1;
  const fromSlides = state?.script.source === "slides";
  useEffect(() => {
    if (!fromSlides || idx < 0 || idx === lastSelected.current) return;
    lastSelected.current = idx;
    void selectSlide(idx);
  }, [idx, fromSlides]);
}

function LoadNotesButton({ onText }: { onText: (text: string) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const notesOk = supportsNotes();
  return (
    <span className="row">
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const text = await readNotesAsScript();
            const parsed = parseScript(text);
            await onText(text);
            const n = parsed.sections.reduce((a, s) => a + s.bullets.length, 0);
            setMsg(`${parsed.sections.length} slides, ${n} points` + (notesOk ? "" : " · this PowerPoint cannot expose speaker notes; add - lines to notes in PowerPoint for the web or Microsoft 365"));
          } catch (err) {
            setMsg((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Reading…" : "Load script from notes"}
      </button>
      {msg && <span className="hint">{msg}</span>}
    </span>
  );
}

// ---- engine mode ----------------------------------------------------------------------
function EnginePane({ webSpeech }: { webSpeech: boolean }) {
  const [password, setPassword] = useState(() => store.get("password"));
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState("offline");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  const engineRef = useRef<Engine | null>(null);
  const clientRef = useRef<SessionClient | null>(null);
  const backendRef = useRef<SttBackend | null>(null);

  const headers = useCallback((): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  // Engine with decide through the server.
  useEffect(() => {
    const decide = async (r: DecideRequest): Promise<DecideResponse> => {
      const res = await fetch(`${ORIGIN}/api/decide`, { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(r) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `decide failed (${res.status})`);
      return (await res.json()) as DecideResponse;
    };
    const engine = new Engine({ decide });
    engineRef.current = engine;
    setState(engine.getState());
    const unsub = engine.subscribe((s) => setState(s));
    return () => {
      unsub();
      engine.stop();
    };
  }, [headers]);

  // Session: create, connect as engine, publish.
  const startSession = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    store.set("password", password);
    try {
      const res = await fetch(`${ORIGIN}/api/session`, { method: "POST", headers: password ? { "X-Access-Password": password } : {} });
      if (res.status === 401) return setError("wrong access password");
      if (!res.ok) throw new Error(`session create failed (${res.status})`);
      const created = (await res.json()) as { id: string; code: string; engineToken: string };
      setToken(created.engineToken);
      setCode(created.code);
      const client = await connect({ serverUrl: ORIGIN, session: { id: created.id, token: created.engineToken, role: "engine" }, onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s) });
      clientRef.current = client;
      client.onCommand((cmd, ack) => {
        const r = engine.dispatch(cmd);
        ack(r.ok ? { ok: true } : { ok: false, error: r.error });
      });
      client.onResync(() => client.publishState(engine.getState()));
      client.publishState(engine.getState());
      engine.subscribe((s, ops) => (ops.length > 40 || s.version % 50 === 0 ? client.publishState(s) : client.publishPatch(s.version, ops)));
      const st = await fetch(`${ORIGIN}/api/stt/status`).then((r) => r.json()).catch(() => ({ elevenlabs: false, openai: false }));
      setSttStatus(st as SttStatus);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [password]);

  useEffect(() => () => clientRef.current?.close(), []);

  const send = useCallback((cmd: Command) => {
    engineRef.current?.dispatch(cmd);
  }, []);
  useSlideSync(state, send);

  const startTake = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const handlers = {
      onTranscript: (e: { committed?: string; partial?: string }) => engine.feed(e),
      onError: (m: string) => engine.setError(m),
    };
    try {
      const candidates = availableBackends(sttStatus, webSpeech);
      const { backend } = await startAuto(candidates, handlers, () => undefined, { baseUrl: ORIGIN, headers: headers() });
      backendRef.current = backend;
      engine.setBackend(backend.id);
      engine.start();
    } catch (err) {
      engine.setError((err as Error).message);
    }
  };
  const stopTake = () => {
    backendRef.current?.stop();
    backendRef.current = null;
    engineRef.current?.stop();
  };
  useEffect(() => {
    if (state && !state.engine.recording && backendRef.current) stopTake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.engine.recording]);

  const onCommand = (cmd: Command) => {
    if (cmd.type === "startTake") return void startTake();
    if (cmd.type === "stopTake") return stopTake();
    send(cmd);
  };

  if (!code) {
    return (
      <div className="setup">
        <div className="eyebrow">Engine mode</div>
        <p className="hint">This pane will run the microphone and the decision loop, and publish a session other devices can mirror.</p>
        <label className="hint">
          Access password (only if the server has one)
          <input className="btn" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => void startSession()}>
          Start session
        </button>
        {error && <span className="chip err">{error}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="controls">
        <span className="chip code">pair {code} {status === "open" ? "●" : "○"}</span>
        <LoadNotesButton onText={(text) => engineRef.current?.loadScript(parseScript(text))} />
        {state?.engine.backend && <span className="chip live">● {BACKEND_LABELS[state.engine.backend]}</span>}
        {error && <span className="chip err">{error}</span>}
      </div>
      {state && <StageView state={state} onCommand={onCommand} banner={state.engine.error ?? null} />}
    </>
  );
}

// ---- view mode -------------------------------------------------------------------------
function ViewPane() {
  const [code, setCode] = useState(() => store.get("code"));
  const [client, setClient] = useState<SessionClient | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setError(null);
    setStatus("pairing");
    try {
      const cl = await connect({ serverUrl: ORIGIN, code, onState: setState, onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s) });
      setClient(cl);
      store.set("code", code);
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };
  useEffect(() => () => client?.close(), [client]);

  const send = useCallback(
    (cmd: Command) => {
      void client?.send(cmd).then((r) => setError(r.ok ? null : (r.error ?? "command failed")));
    },
    [client],
  );
  useSlideSync(client ? state : null, send);

  if (!client) {
    return (
      <div className="setup">
        <div className="eyebrow">View mode</div>
        <p className="hint">Mirror a session running on your laptop or phone. Enter the 6-digit code it shows.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input className="btn code-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
          <button className="btn primary" type="submit" disabled={code.length !== 6 || status === "pairing"}>
            {status === "pairing" ? "Pairing…" : "Join"}
          </button>
        </form>
        {error && <span className="chip err">{error}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="controls">
        <LoadNotesButton
          onText={async (text) => {
            const res = await fetch(`${ORIGIN}/api/session/${client.id}/script`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${client.token}` },
              body: JSON.stringify({ text }),
            });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `upload failed (${res.status})`);
          }}
        />
      </div>
      {state ? <StageView state={state} onCommand={send} banner={status.startsWith("connecting") ? "engine offline" : error} /> : <div className="hint">Waiting for the engine…</div>}
    </>
  );
}

Office.onReady(() => {
  // Report the current slide once so the engine shows "slide n/m" immediately.
  void getSelectedSlide();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
