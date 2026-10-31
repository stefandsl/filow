// Side panel: pairs with an Intelliprompter session (server URL + 6-digit code), shows the live
// view, and drives the deck tab through the content script: "Generate script from this deck"
// and "Follow" (slide changes -> slideChanged commands). No keys here: the server runs models.
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, type SessionClient } from "@intelliprompter/client";
import { parseScript, slideNeedsImage, type Command, type GenerateProgress, type ScreenMode, type SessionState, type SlideInput, type VisionResponse } from "@intelliprompter/core";
import { LangProvider, StageView } from "@intelliprompter/ui";
import type { SlideInfo } from "./adapters";
import "./sidepanel.css";

const storage = {
  async get<T>(k: string, d: T): Promise<T> {
    const r = await chrome.storage.local.get(k);
    return (r[k] as T) ?? d;
  },
  set: (k: string, v: unknown) => chrome.storage.local.set({ [k]: v }),
};

const bg = <T,>(msg: unknown) => chrome.runtime.sendMessage(msg) as Promise<T>;
const toContent = <T,>(msg: unknown) => bg<T>({ t: "toContent", msg });

async function mintEngineToken(server: string, id: string, viewToken: string): Promise<string> {
  const res = await fetch(`${server}/api/session/${id}/engine-token`, { method: "POST", headers: { Authorization: `Bearer ${viewToken}` } });
  if (!res.ok) throw new Error(res.status === 401 ? "the presenter has not given this extension control" : `token failed (${res.status})`);
  return ((await res.json()) as { engineToken: string }).engineToken;
}

function App() {
  const [server, setServer] = useState("http://127.0.0.1:4748");
  const [appServer, setAppServer] = useState("http://127.0.0.1:4747");
  const [code, setCode] = useState("");
  const [client, setClient] = useState<SessionClient | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ url?: string; adapter?: string } | null>(null);
  const [follow, setFollow] = useState(false);
  const [mode, setMode] = useState<ScreenMode>("slide-change");
  const [progress, setProgress] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const followRef = useRef(false);
  const clientRef = useRef<SessionClient | null>(null);
  const lastSlide = useRef(-1);

  useEffect(() => {
    void (async () => {
      setServer(await storage.get("server", "http://127.0.0.1:4748"));
      setAppServer(await storage.get("appServer", "http://127.0.0.1:4747"));
      setCode(await storage.get("code", ""));
      setMode(await storage.get("mode", "slide-change"));
    })();
  }, []);

  const join = async () => {
    setError(null);
    setStatus("pairing");
    try {
      const origin = server.replace(/\/$/, "");
      // Host permission only for the configured server (optional_host_permissions).
      try {
        await chrome.permissions.request({ origins: [`${new URL(origin).origin}/*`, `${new URL(appServer).origin}/*`] });
      } catch {
        /* Firefox grants on install; Chrome may decline, the fetch then fails with a clear error */
      }
      const cl = await connect({ serverUrl: origin, code, deviceLabel: "Browser extension", onState: setState, onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s) });
      clientRef.current = cl;
      setClient(cl);
      await storage.set("server", origin);
      await storage.set("appServer", appServer.replace(/\/$/, ""));
      await storage.set("code", code);
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };

  const attach = async () => {
    setError(null);
    const r = await bg<{ ok: boolean; error?: string; url?: string }>({ t: "attach" });
    if (!r.ok) return setError(r.error ?? "could not attach");
    const p = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "probe" });
    setAttached({ url: r.url, adapter: p.info?.adapter });
  };

  // Follow: slide changes from the content script become slideChanged commands (+ optional vision).
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    const handler = (msg: { t: string; info?: SlideInfo }) => {
      if (msg.t !== "slideChanged" || !msg.info || !followRef.current) return;
      const cl = clientRef.current;
      if (!cl) return;
      const info = msg.info;
      if (info.index === lastSlide.current) return;
      lastSlide.current = info.index;
      void cl.send({ type: "slideChanged", index: info.index, total: info.total || info.index + 1, title: info.title });
      if (mode !== "off" && slideNeedsImage({ index: info.index, text: info.text })) void visionForCurrentTab(info);
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const visionForCurrentTab = async (info: SlideInfo) => {
    const cl = clientRef.current;
    if (!cl) return;
    try {
      const cap = await bg<{ ok: boolean; dataUrl?: string }>({ t: "capture" });
      if (!cap.ok || !cap.dataUrl) return;
      const token = await mintEngineToken(server, cl.id, cl.token);
      const res = await fetch(`${appServer}/api/vision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: cap.dataUrl, source: "window", context: { sectionTitle: info.title } }),
      });
      if (!res.ok) return;
      const out = (await res.json()) as VisionResponse;
      // The engine owns the ON SCREEN strip; a view cannot feed it directly, so show it locally.
      setProgress(out.summary.shows ? `On screen: ${out.summary.shows}` : null);
    } catch {
      /* best effort */
    }
  };

  const generate = async () => {
    const cl = clientRef.current;
    if (!cl) return;
    setError(null);
    setProgress("Reading the deck…");
    try {
      const first = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "probe" });
      if (!first.ok || !first.info) throw new Error("attach the deck tab first");
      const slides: SlideInput[] = [];
      const seen = new Set<string>();
      let info = first.info;
      const limit = info.total || 150;
      for (let i = 0; i < limit; i++) {
        const sig = `${info.index}|${info.text.slice(0, 120)}`;
        if (seen.has(sig)) break; // wrapped or stuck at the end
        seen.add(sig);
        const slide: SlideInput = { index: slides.length, title: info.title, text: info.text };
        if (slideNeedsImage(slide)) {
          const cap = await bg<{ ok: boolean; dataUrl?: string }>({ t: "capture" });
          if (cap.ok && cap.dataUrl) slide.imageBase64 = cap.dataUrl.replace(/^data:image\/\w+;base64,/, "");
        }
        slides.push(slide);
        setProgress(`Collected ${slides.length}${info.total ? ` / ${info.total}` : ""}…`);
        const n = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "next" });
        if (!n.ok || !n.info) break;
        info = n.info;
      }
      const token = await mintEngineToken(server, cl.id, cl.token);
      const res = await fetch(`${appServer}/api/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slides }),
      });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `generate failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line) as { progress?: GenerateProgress; done?: boolean; text?: string; error?: string };
          if (j.error) throw new Error(j.error);
          if (j.progress) setProgress(`${j.progress.done} / ${j.progress.total} · ${j.progress.title}`);
          if (j.done) text = j.text ?? "";
        }
      }
      if (text === null) throw new Error("stream ended early");
      setPreview(text);
      setProgress("Review the script, then load it.");
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  const loadScript = async (text: string) => {
    const cl = clientRef.current;
    if (!cl) return;
    const res = await fetch(`${server}/api/session/${cl.id}/script`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cl.token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const parsed = parseScript(text);
    setProgress(`${parsed.sections.length} slides, ${parsed.sections.reduce((a, s) => a + s.bullets.length, 0)} points loaded`);
    setPreview(null);
  };

  const send = useCallback((cmd: Command) => {
    void clientRef.current?.send(cmd).then((r) => setError(r.ok ? null : (r.error ?? "command failed")));
  }, []);

  return (
    <LangProvider lang="en">
      <div className="pane">
        <header className="topbar">
          <div className="logo">
            <span className="dot" /> INTELLIPROMPTER
          </div>
          <span className="spacer" />
          {client && <span className="chip live">{status === "open" ? "● paired" : status}</span>}
        </header>

        {!client ? (
          <div className="setup">
            <div className="eyebrow">Pair with your session</div>
            <p className="hint">Open Intelliprompter (desktop app or server), click its pairing code, and enter it here. The desktop app on this PC is the default.</p>
            <label className="hint">
              Session server (relay)
              <input className="btn" value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://127.0.0.1:4748" />
            </label>
            <label className="hint">
              App server (API)
              <input className="btn" value={appServer} onChange={(e) => setAppServer(e.target.value)} placeholder="http://127.0.0.1:4747" />
            </label>
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
        ) : (
          <>
            <div className="controls">
              <button className="btn" onClick={() => void attach()}>
                {attached ? `Deck: ${attached.adapter}` : "Use this tab as the deck"}
              </button>
              <button className="btn primary" disabled={!attached} onClick={() => void generate()}>
                Generate script from this deck
              </button>
              <label className={`btn choice ${follow ? "primary" : ""}`}>
                <input type="checkbox" checked={follow} disabled={!attached} onChange={(e) => setFollow(e.target.checked)} /> Follow
              </label>
              <select
                className="btn"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as ScreenMode);
                  void storage.set("mode", e.target.value);
                }}
                title="Vision for image-only slides while following"
              >
                <option value="off">Vision off</option>
                <option value="slide-change">Vision on slide change</option>
                <option value="balanced">Vision balanced</option>
                <option value="realtime">Vision real-time</option>
              </select>
              {progress && <span className="hint">{progress}</span>}
              {error && <span className="chip err">{error}</span>}
            </div>
            {state ? <StageView state={state} onCommand={send} banner={status.startsWith("connecting") ? "engine offline" : null} /> : <div className="hint">Waiting for the engine…</div>}
          </>
        )}

        {preview !== null && (
          <div className="modal-bg" onClick={() => setPreview(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="eyebrow">Generated script · review before loading</div>
              <textarea value={preview} onChange={(e) => setPreview(e.target.value)} spellCheck={false} />
              <div className="controls">
                <button className="btn primary" onClick={() => void loadScript(preview).catch((e) => setError((e as Error).message))}>
                  Load into session
                </button>
                <button className="btn" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        <footer className="help">Page text is treated as data, never as instructions. Frames for image slides are captured only when you generate or follow, and are not stored.</footer>
      </div>
    </LangProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
