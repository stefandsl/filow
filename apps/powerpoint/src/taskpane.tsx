/* global Office */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, type SessionClient } from "@filow/client";
import { Engine, isLang, langFromLocale, LANGS, parseScript, type Command, type DecideRequest, type DecideResponse, type Lang, type SessionState, type SttStatus } from "@filow/core";
import { availableBackends, BACKEND_LABELS, startAuto, type SttBackend } from "@filow/stt";
import { Wordmark, LangProvider, StageView, useT } from "@filow/ui";
import { getSelectedSlide, hostInfo, onSelectionChange, readNotesAsScript, selectSlide, supportsNotes } from "./office";
import { attachSlideImages, mintEngineToken, readSlidesForGeneration, requestGeneration } from "./generate";
import "./taskpane.css";

type Mode = "engine" | "view";
const ORIGIN = window.location.origin; // the pane is served by the Filow server (or the Vite dev proxy)
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

/** Served by the desktop app's HTTPS proxy on this PC: the pane should mirror that app, not run its own engine. */
const ON_DESKTOP_APP = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

function officeLang(): Lang {
  const stored = store.get("lang");
  if (isLang(stored)) return stored;
  let locale = "";
  try {
    locale = String(Office.context.displayLanguage || Office.context.contentLanguage || "");
  } catch {
    /* outside Office */
  }
  return langFromLocale(locale || (typeof navigator !== "undefined" ? navigator.language : ""));
}

function App() {
  const [lang, setLang] = useState<Lang>(() => officeLang());
  useEffect(() => store.set("lang", lang), [lang]);
  return (
    <LangProvider lang={lang}>
      <AppInner lang={lang} onLang={setLang} />
    </LangProvider>
  );
}

function AppInner({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT();
  const host = hostInfo();
  // "mode2": the default changed in 0.6.0 (follow the app on this PC); older stored choices are ignored once.
  const [mode, setMode] = useState<Mode>(() => (store.get("mode2") as Mode) || (ON_DESKTOP_APP ? "view" : host.canUseMic ? "engine" : "view"));
  useEffect(() => store.set("mode2", mode), [mode]);
  return (
    <div className="pane">
      <header className="topbar">
        <div className="logo">
          <Wordmark height={28} />
        </div>
        <span className="spacer" />
        <span className="langswitch">
          {LANGS.map((l) => (
            <button key={l} className={`chip ${lang === l ? "code" : ""}`} onClick={() => onLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <select className="btn" value={mode} onChange={(e) => setMode(e.target.value as Mode)} title={t("ppt.modeTitle")}>
          <option value="engine" disabled={!host.canUseMic}>
            {host.canUseMic ? t("ppt.modeEngine") : t("ppt.modeEngineNo")}
          </option>
          <option value="view">{t("ppt.modeView")}</option>
        </select>
      </header>
      {mode === "engine" ? <EnginePane webSpeech={host.webSpeech} /> : <ViewPane />}
      <footer className="help">{t("ppt.help")}</footer>
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
  const t = useT();
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
            setMsg(t("ppt.loaded", { slides: parsed.sections.length, points: n }) + (notesOk ? "" : " " + t("ppt.noNotes")));
          } catch (err) {
            setMsg((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t("ppt.reading") : t("ppt.loadNotes")}
      </button>
      {msg && <span className="hint">{msg}</span>}
    </span>
  );
}

/**
 * "Generate script from slides" (ARCHITECTURE.md §7.4). Notes win per slide; the server's model
 * writes points for the slides without notes. `getToken` returns an engine token (engine mode) or
 * asks the relay for a short-lived one (view mode, controllers only).
 */
function GenerateButton({ getToken, onText }: { getToken: () => Promise<string>; onText: (text: string) => Promise<void> | void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(t("ppt.readingSlides"));
    try {
      const slides = await readSlidesForGeneration();
      const images = await attachSlideImages(slides);
      setMsg(`0 / ${slides.length}${images ? ` · ${images} ${t("ppt.slideImages")}` : ""}`);
      const token = await getToken();
      const out = await requestGeneration(ORIGIN, token, slides, undefined, (p) => setMsg(`${p.done} / ${p.total} · ${p.title}`));
      setPreview(out.text);
      setMsg(t("ppt.doneWith", { model: out.model + (out.cost ? ` · $${out.cost.toFixed(4)}` : "") }));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row">
      <button className="btn" disabled={busy} onClick={() => void run()} title={t("ppt.generateTitle")}>
        {busy ? t("ppt.generating") : t("ppt.generate")}
      </button>
      {msg && <span className="hint">{msg}</span>}
      {preview !== null && (
        <div className="modal-bg" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t("ppt.reviewTitle")}</div>
            <textarea value={preview} onChange={(e) => setPreview(e.target.value)} spellCheck={false} />
            <div className="controls">
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await onText(preview);
                    const parsed = parseScript(preview);
                    setMsg(t("ppt.pointsLoaded", { slides: parsed.sections.length, points: parsed.sections.reduce((a, x) => a + x.bullets.length, 0) }));
                    setPreview(null);
                  } catch (err) {
                    setMsg((err as Error).message);
                  }
                }}
              >
                {t("ppt.loadIntoSession")}
              </button>
              <button className="btn" onClick={() => setPreview(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

// ---- engine mode ----------------------------------------------------------------------
function EnginePane({ webSpeech }: { webSpeech: boolean }) {
  const t = useT();
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

  // Read the token through a ref so `headers` keeps one identity and the engine effect doesn't recreate the Engine mid-session.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const headers = useCallback((): Record<string, string> => (tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}), []);

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
      if (res.status === 401) return setError(t("ppt.wrongPassword"));
      if (!res.ok) throw new Error(`session create failed (${res.status})`);
      const created = (await res.json()) as { id: string; code: string; engineToken: string };
      tokenRef.current = created.engineToken;
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
  }, [password, t]);

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
        <div className="eyebrow">{t("ppt.engineMode")}</div>
        <p className="hint">{t("ppt.engineHint")}</p>
        <label className="hint">
          {t("ppt.password")}
          <input className="btn" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => void startSession()}>
          {t("ppt.startSession")}
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
        <GenerateButton getToken={async () => token ?? ""} onText={(text) => engineRef.current?.loadScript(parseScript(text))} />
        {state?.engine.backend && <span className="chip live">● {BACKEND_LABELS[state.engine.backend]}</span>}
        {error && <span className="chip err">{error}</span>}
      </div>
      {state && <StageView state={state} onCommand={onCommand} banner={state.engine.error ?? null} />}
    </>
  );
}

// ---- view mode -------------------------------------------------------------------------
function ViewPane() {
  const t = useT();
  const [code, setCode] = useState(() => store.get("code"));
  const [client, setClient] = useState<SessionClient | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  const [localCode, setLocalCode] = useState<string | null>(null);

  const join = async (c: string = code) => {
    setError(null);
    setStatus("pairing");
    try {
      const cl = await connect({ serverUrl: ORIGIN, code: c, deviceLabel: "PowerPoint pane", onState: setState, onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s) });
      setClient(cl);
      store.set("code", c);
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };
  useEffect(() => () => client?.close(), [client]);

  // On this PC the desktop app publishes its current session; join it without typing anything.
  useEffect(() => {
    if (!ON_DESKTOP_APP || client) return;
    let cancelled = false;
    fetch(`${ORIGIN}/api/local/current-session`)
      .then((r) => r.json())
      .then((j: { code?: string }) => {
        if (cancelled || !j.code) return;
        setLocalCode(j.code);
        void join(j.code);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

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
        <div className="eyebrow">{t("ppt.viewMode")}</div>
        <p className="hint">{ON_DESKTOP_APP ? (localCode ? t("ppt.joining") : t("ppt.openApp")) : t("ppt.mirrorHint")}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void join(code);
          }}
        >
          <input className="btn code-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
          <button className="btn primary" type="submit" disabled={code.length !== 6 || status === "pairing"}>
            {status === "pairing" ? t("mirror.pairing") : t("mirror.join")}
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
        <GenerateButton
          getToken={() => mintEngineToken(ORIGIN, client.id, client.token)}
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
      {state ? <StageView state={state} onCommand={send} banner={status.startsWith("connecting") ? t("ppt.engineOffline") : error} /> : <div className="hint">{t("ppt.waitingEngine")}</div>}
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
