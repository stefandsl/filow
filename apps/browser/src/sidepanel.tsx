// Side panel: pairs with a Filow session (server URL + 8-character code), shows the live
// view, and drives the deck tab through the content script: "Generate script from this deck"
// and "Follow" (slide changes -> slideChanged commands). No keys here: the server runs models.
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, isPairCode, type SessionClient } from "@filow/client";
import { isLang, LANG_LABELS, langFromLocale, LANGS, parseScript, slideNeedsImage, type Command, type GenerateProgress, type Lang, type ScreenMode, type SessionState, type SlideInput, type VisionResponse } from "@filow/core";
import { Wordmark, LangProvider, StageView, useT } from "@filow/ui";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { createPageOutbound } from "@/lib/buddy/outboundPage";
import { kvConsentStore, screenOut, scriptOut } from "@/lib/buddy/outboundRemote";
import { EXTENSION_TEXT, RemoteConsentList, RemoteOutboundNotice, RemoteOutboundSignal, remoteText } from "@/components/RemoteOutbound";
import type { SlideInfo } from "./adapters";
import "./sidepanel.css";

/** The Filow API this panel talks to (set from the "API" field once paired). */
const api = { origin: "http://127.0.0.1:4747" };
const CONSENT_KEY = "outboundConsent";

/**
 * What leaves this PC (docs/okfilow/OUTBOUND.md): nothing without a yes, every send shown. The
 * extension cannot reach the Filow window's settings, so it keeps its own choices in its own
 * storage and lists them under "What may leave this PC".
 */
const outbound = createPageOutbound({
  store: kvConsentStore({
    get: async () => (await chrome.storage.local.get(CONSENT_KEY))[CONSENT_KEY],
    set: (next) => chrome.storage.local.set({ [CONSENT_KEY]: next }),
  }),
  fetchRecipients: async () => {
    const res = await fetch(`${api.origin}/api/buddy/recipients`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as BuddyRecipients) : null;
  },
});

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
  const [lang, setLang] = useState<Lang>(() => langFromLocale(navigator.language));
  useEffect(() => {
    void storage.get<Lang | "">("lang", "").then((l) => l && setLang(l));
  }, []);
  return (
    <LangProvider lang={lang}>
      <Panel
        lang={lang}
        onLang={(l) => {
          setLang(l);
          void storage.set("lang", l);
        }}
      />
    </LangProvider>
  );
}

function Panel({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT();
  const okt = remoteText(lang);
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
  /** The attached deck tab: frames are captured only while it is the visible tab. */
  const deckTab = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      setServer(await storage.get("server", "http://127.0.0.1:4748"));
      setAppServer(await storage.get("appServer", "http://127.0.0.1:4747"));
      setCode(await storage.get("code", ""));
      setMode(await storage.get("mode", "slide-change"));
    })();
  }, []);

  useEffect(() => {
    api.origin = appServer.replace(/\/$/, "");
  }, [appServer]);

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
    const r = await bg<{ ok: boolean; error?: string; url?: string; tabId?: number }>({ t: "attach" });
    if (!r.ok) return setError(r.error ?? "could not attach");
    const p = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "probe" });
    deckTab.current = r.tabId;
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
      // Before the tab is even captured: who would look at it, and a yes. A no stops watching.
      const known = await outbound.recipients();
      if (!known) return;
      const to = screenOut(known);
      if (to && (await outbound.allow("screen", to)) !== "granted") {
        setMode("off");
        void storage.set("mode", "off");
        return;
      }
      // The notice may have stayed open while the deck moved on: a frame of another slide would carry the wrong title.
      if (lastSlide.current !== info.index) return;
      const cap =await bg<{ ok: boolean; dataUrl?: string }>({ t: "capture", tabId: deckTab.current });
      if (!cap.ok || !cap.dataUrl) return;
      const token = await mintEngineToken(server, cl.id, cl.token);
      const look = (consent: Record<string, string>) =>
        fetch(`${appServer}/api/vision`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...consent },
          body: JSON.stringify({ image: cap.dataUrl, source: "window", context: { sectionTitle: info.title } }),
        });
      const res = to ? await outbound.sending("screen", to, look) : await look({});
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
    setProgress(null);
    try {
      // Before the slides are even read: who would write the script, and a yes if that is not this PC.
      const known = await outbound.recipients();
      if (!known) throw new Error(okt("noticeUnknown"));
      const to = scriptOut(known);
      if (to && (await outbound.allow("script", to)) !== "granted") return; // the signal line says what was kept
      setProgress(t("ext.reading"));
      const first = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "probe" });
      if (!first.ok || !first.info) throw new Error("attach the deck tab first");
      const slides: SlideInput[] = [];
      const seen = new Set<string>();
      let info = first.info;
      const limit = info.total || 150;
      // Rewind to the first slide so the script covers the whole deck, not just from the current slide on.
      for (let k = 0; k < limit; k++) {
        const p = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "prev" });
        if (!p.ok || !p.info || p.info.index === info.index) break;
        info = p.info;
      }
      for (let i = 0; i < limit; i++) {
        const sig = `${info.index}|${info.text.slice(0, 120)}`;
        if (seen.has(sig)) break; // wrapped or stuck at the end
        seen.add(sig);
        const slide: SlideInput = { index: slides.length, title: info.title, text: info.text };
        if (slideNeedsImage(slide)) {
          const cap = await bg<{ ok: boolean; dataUrl?: string }>({ t: "capture", tabId: deckTab.current });
          if (cap.ok && cap.dataUrl) slide.imageBase64 = cap.dataUrl.replace(/^data:image\/\w+;base64,/, "");
        }
        slides.push(slide);
        setProgress(t("ext.collected", { n: `${slides.length}${info.total ? ` / ${info.total}` : ""}` }));
        const n = await toContent<{ ok: boolean; info?: SlideInfo }>({ t: "next" });
        if (!n.ok || !n.info) break;
        info = n.info;
      }
      const token = await mintEngineToken(server, cl.id, cl.token);
      // The signal stays on for the whole stream: the slides leave until the last answer is in.
      const write = async (consent: Record<string, string>): Promise<string> => {
        const res = await fetch(`${appServer}/api/script/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...consent },
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
        return text;
      };
      const text = to ? await outbound.sending("script", to, write) : await write({});
      setPreview(text);
      setProgress(t("ext.review"));
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
    <>
      <div className="pane">
        <header className="topbar">
          <h1 className="logo">
            <Wordmark height={28} />
          </h1>
          <span className="spacer" />
          <select className="btn langswitch" value={lang} aria-label={t("common.language")} title={t("common.language")} onChange={(e) => { if (isLang(e.target.value)) onLang(e.target.value); }}>
            {LANGS.map((l) => <option key={l} value={l} lang={l}>{LANG_LABELS[l]}</option>)}
          </select>
          {client && <span className="chip live">{status === "open" ? "●" : status}</span>}
        </header>
        <main className="pane-main">
          <RemoteOutboundSignal out={outbound} lang={lang} swap={EXTENSION_TEXT} />

          {!client ? (
            <div className="setup">
              <div className="eyebrow">{t("ext.pairTitle")}</div>
              <p className="hint">{t("ext.pairHint")}</p>
              <label className="hint">
                {t("ext.relay")}
                <input className="btn" value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://127.0.0.1:4748" />
              </label>
              <label className="hint">
                {t("ext.api")}
                <input className="btn" value={appServer} onChange={(e) => setAppServer(e.target.value)} placeholder="http://127.0.0.1:4747" />
              </label>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void join();
                }}
              >
                <input className="btn code-input" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={9} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""))} placeholder="ABCD 2345" />
                <button className="btn primary" type="submit" disabled={!isPairCode(code) || status === "pairing"}>
                  {status === "pairing" ? t("mirror.pairing") : t("mirror.join")}
                </button>
              </form>
              {error && <span className="chip err">{error}</span>}
            </div>
          ) : (
            <>
              <div className="controls">
                <button className="btn" onClick={() => void attach()}>
                  {attached ? t("ext.deck", { adapter: attached.adapter ?? "" }) : t("ext.useTab")}
                </button>
                <button className="btn primary" disabled={!attached} onClick={() => void generate()}>
                  {t("ext.generate")}
                </button>
                <label className={`btn choice ${follow ? "primary" : ""}`}>
                  <input type="checkbox" checked={follow} disabled={!attached} onChange={(e) => setFollow(e.target.checked)} /> {t("ext.follow")}
                </label>
                <select
                  className="btn"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as ScreenMode);
                    void storage.set("mode", e.target.value);
                  }}
                  title={t("ext.visionTitle")}
                  aria-label={t("ext.visionTitle")}
                >
                  <option value="off">{t("ext.visionOff")}</option>
                  <option value="slide-change">{t("ext.visionChange")}</option>
                  <option value="balanced">{t("ext.visionBalanced")}</option>
                  <option value="realtime">{t("ext.visionRealtime")}</option>
                </select>
                {progress && <span className="hint">{progress}</span>}
                {error && <span className="chip err">{error}</span>}
              </div>
              {state ? <StageView state={state} onCommand={send} banner={status.startsWith("connecting") ? t("ppt.engineOffline") : null} /> : <div className="hint">{t("ppt.waitingEngine")}</div>}
            </>
          )}

          {preview !== null && (
            <div className="modal-bg" onClick={() => setPreview(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="eyebrow">{t("ppt.reviewTitle")}</div>
                <textarea value={preview} onChange={(e) => setPreview(e.target.value)} spellCheck={false} />
                <div className="controls">
                  <button className="btn primary" onClick={() => void loadScript(preview).catch((e) => setError((e as Error).message))}>
                    {t("ppt.loadIntoSession")}
                  </button>
                  <button className="btn" onClick={() => setPreview(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            </div>
          )}
          <RemoteConsentList out={outbound} lang={lang} swap={EXTENSION_TEXT} />
          <RemoteOutboundNotice out={outbound} lang={lang} swap={EXTENSION_TEXT} />
        </main>
        <footer className="help">{t("ext.help")}</footer>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
