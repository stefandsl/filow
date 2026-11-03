"use client";
import { Icon } from "@/components/icons";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { connect, type SessionClient } from "@filow/client";
import type { Command, SessionState } from "@filow/core";
import { Wordmark, LangProvider, StageView, useT } from "@filow/ui";
import { sessionServerUrl } from "@/lib/sessionUrl";
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
  const [pending, setPending] = useState(false);

  /** ?server= is only trusted when it is this page's own origin; anything else is confirmed first (never auto-connect elsewhere). */
  const resolveServer = (): string | null => {
    if (!serverParam) return sessionServerUrl();
    let host = "";
    try {
      const u = new URL(serverParam);
      if (u.origin === window.location.origin) return u.origin;
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      host = u.host;
    } catch {
      return null;
    }
    return window.confirm(t("mirror.foreignServer", { host })) ? serverParam : null;
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
    );
  }

  if (pending && !state) {
    return (
      <div className="app stage pair">
        <div className="logo">
          <Wordmark height={44} />
        </div>
        <div className="subtitle">{t("mirror.waiting")}</div>
        {error && <span className="chip err">{error}</span>}
      </div>
    );
  }

  const offline = status.startsWith("connecting") || !state;
  if (overlay) {
    const bridge = (globalThis as { filow?: { closeOverlay?: () => void } }).filow;
    return (
      <div className="overlay">
        <div className="overlay-bar">
          <span className="drag"><Icon name="grip" /> Filow</span>
          <button className="chip" onClick={() => bridge?.closeOverlay?.()} title={t("overlay.close")} aria-label={t("overlay.close")}>
            <Icon name="close" />
          </button>
        </div>
        <StageView pointMark={<Icon name="check" />} previewMark={<Icon name="circle" />} state={state ?? emptyState(client.id)} onCommand={onCommand} stage compact banner={error ?? (offline ? t("stage.engineOffline") : null)} />
      </div>
    );
  }
  return <StageView pointMark={<Icon name="check" />} previewMark={<Icon name="circle" />} state={state ?? emptyState(client.id)} onCommand={onCommand} stage compact={compact} banner={error ?? (offline ? t("stage.engineOffline") : null)} />;
}

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
