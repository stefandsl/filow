"use client";
import { Icon } from "@/components/icons";
import { OverlayFrame } from "@/components/OverlayFrame";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { connect, type SessionClient } from "@filow/client";
import { currentPoint, moveCommand, type Command, type SessionState } from "@filow/core";
import { useClickerKeys } from "@/components/prompter/useReanchor";
import { DISPLAY_KEYS, DisplayPanel, displayAttributes, useDisplayPrefs, useEyeline } from "@/components/prompter/DisplayPanel";
import { Wordmark, LangProvider, StageView, useT } from "@filow/ui";
import { sessionServerUrl } from "@/lib/sessionUrl";
import { classifyServer } from "@/lib/mirrorServer";
import { LangSwitch, useUiLang, useUiTheme } from "@/components/LangSwitch";

/** PWA mirror: pair with a code, show the live state, send remote commands. ARCHITECTURE.md §5.8 */
export default function MirrorPage() {
  const [lang, setLang] = useUiLang();
  useUiTheme();
  return (
    <Suspense fallback={null}>
      <LangProvider lang={lang}>
        <Mirror lang={lang} onLang={setLang} />
      </LangProvider>
    </Suspense>
  );
}

function Mirror({ lang, onLang }: { lang: "en" | "it"; onLang: (l: "en" | "it") => void }) {
  const t = useT();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [client, setClient] = useState<SessionClient | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const serverParam = params.get("server");
  const compact = params.get("compact") === "1";
  const overlay = params.get("overlay") === "1";
  const points = params.get("points") === "1";
  const closeOverlay = () => (globalThis as { filow?: { closeOverlay?: () => void } }).filow?.closeOverlay?.();
  const [pending, setPending] = useState(false);

  /** ?server= is trusted only where the desktop's own QR code points (this origin, or this host one port up); anything else is confirmed first (never auto-connect elsewhere). */
  const resolveServer = (): string | null => {
    if (!serverParam) return sessionServerUrl();
    const s = classifyServer(serverParam, window.location.origin);
    if (s.kind === "trusted") return s.url;
    if (s.kind === "invalid") return null;
    return window.confirm(t("mirror.foreignServer", { host: s.host })) ? serverParam : null;
  };

  const join = async (c: string) => {
    setError(null);
    const serverUrl = resolveServer();
    if (!serverUrl) {
      setStatus("idle");
      return;
    }
    setStatus("pairing");
    try {
      const cl = await connect({
        serverUrl,
        code: c,
        onState: setState,
        onStatus: (s, d) => {
          setStatus(d ? `${s}: ${d}` : s);
          if (d === "pending") setPending(true);
          if (s === "closed" && d && /rejected/.test(d)) setError(t("mirror.rejected"));
        },
        onRole: () => setPending(false),
      });
      if (cl.role === "pending") setPending(true);
      setClient(cl);
      try {
        localStorage.setItem("mirror:lastCode", c);
      } catch {
        /* private mode */
      }
      // Keep the screen on while mirroring (Android Chrome, iOS 16.4+).
      try {
        await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request("screen");
      } catch {
        /* unsupported or denied */
      }
    } catch (err) {
      setError(t("mirror.connectionError", { error: (err as Error).message }));
      setStatus("idle");
    }
  };

  useEffect(() => {
    if (code.length === 6 && !client) void join(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => client?.close(), [client]);

  const onCommand = (cmd: Command) => {
    void client?.send(cmd).then((r) => {
      if (!r.ok) setError(t("mirror.commandError", { error: r.error ?? "" }));
      else setError(null);
    });
  };

  if (!client) {
    return (
      <OverlayFrame overlay={overlay} onClose={closeOverlay}>
      <div className="app stage pair">
        <div className="logo">
          <Wordmark height={44} />
          <span className="spacer" />
          <LangSwitch lang={lang} onChange={onLang} />
        </div>
        <div className="subtitle">{t("mirror.enterCode")}</div>
        <form
          className="controls"
          onSubmit={(e) => {
            e.preventDefault();
            void join(code);
          }}
        >
          <input
            className="btn code-input"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            aria-label={t("mirror.enterCode")}
            autoFocus
          />
          <button className="btn primary" type="submit" disabled={code.length !== 6 || status === "pairing"}>
            {status === "pairing" ? t("mirror.pairing") : t("mirror.join")}
          </button>
        </form>
        {error && <span className="chip err">{error}</span>}
      </div>
      </OverlayFrame>
    );
  }

  if (pending && !state) {
    return (
      <OverlayFrame overlay={overlay} onClose={closeOverlay}>
      <div className="app stage pair">
        <div className="logo">
          <Wordmark height={44} />
        </div>
        <div className="subtitle">{t("mirror.waiting")}</div>
        {error && <span className="chip err">{error}</span>}
      </div>
      </OverlayFrame>
    );
  }

  const offline = status.startsWith("connecting") || !state;
  if (overlay) {
    // The points window for calls (?points=1) is this same overlay view; it says whether screen sharing can show it.
    const note = points ? <span className="overlay-note">{t(params.get("private") === "1" ? "points.onlyYou" : "points.shared")}</span> : undefined;
    return (
      <OverlayFrame overlay={overlay} onClose={closeOverlay} note={note} closeLabel={points ? t("points.close") : undefined}>
        <MirrorKeys state={state} onCommand={onCommand} />
        <StageView pointMark={<Icon name="check" />} previewMark={<Icon name="circle" />} state={state ?? emptyState(client.id)} onCommand={onCommand} stage compact banner={error ?? (offline ? t("stage.engineOffline") : null)} />
      </OverlayFrame>
    );
  }
  if (compact) return <><MirrorKeys state={state} onCommand={onCommand} /><StageView pointMark={<Icon name="check" />} previewMark={<Icon name="circle" />} state={state ?? emptyState(client.id)} onCommand={onCommand} stage compact banner={error ?? (offline ? t("stage.engineOffline") : null)} /></>;
  return <MirrorStage state={state ?? emptyState(client.id)} onCommand={onCommand} banner={error ?? (offline ? t("stage.engineOffline") : null)} />;
}

/** Clicker keys on the mirror (a Bluetooth clicker paired with the phone, or the overlay window in focus). */
function MirrorKeys({ state, onCommand }: { state: SessionState | null; onCommand: (cmd: Command) => void }) {
  useClickerKeys((m) => {
    const cmd = state && moveCommand(state, m);
    if (cmd) onCommand(cmd);
  }, Boolean(state));
  return null;
}

/** The full phone view: the stage with this phone's own display choice (size, eyeline, mirror for glass, contrast). */
function MirrorStage({ state, onCommand, banner }: { state: SessionState; onCommand: (cmd: Command) => void; banner: string | null }) {
  const t = useT();
  const [display, setDisplay] = useDisplayPrefs(DISPLAY_KEYS.mirror);
  const [open, setOpen] = useState(false);
  useEyeline(pageArea, currentPoint(state), display);
  return (
    <div className="display-root" {...displayAttributes(display)}>
      <MirrorKeys state={state} onCommand={onCommand} />
      <button type="button" className="btn mirror-display-btn" onClick={() => setOpen(true)} title={t("display.openTitle")} aria-haspopup="dialog">
        <Icon name="sliders" /> {t("display.open")}
      </button>
      <StageView pointMark={<Icon name="check" />} previewMark={<Icon name="circle" />} state={state} onCommand={onCommand} stage banner={banner} />
      {open && <DisplayPanel prefs={display} onChange={setDisplay} onClose={() => setOpen(false)} />}
    </div>
  );
}

const pageArea = () => (typeof document === "undefined" ? null : (document.scrollingElement as HTMLElement | null));

function emptyState(id: string): SessionState {
  return {
    id,
    version: 0,
    script: { sections: [] },
    sectionIdx: 0,
    points: {},
    transcriptTail: "",
    stats: { calls: 0, totalMs: 0, avgMs: 0, costUsd: 0, model: "" },
    engine: { backend: null, recording: false },
  };
}
