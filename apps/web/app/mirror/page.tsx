"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { connect, type SessionClient } from "@intelliprompter/client";
import type { Command, SessionState } from "@intelliprompter/core";
import { StageView } from "@intelliprompter/ui";
import { sessionServerUrl } from "@/lib/sessionUrl";

/** PWA mirror: pair with a code, show the live state, send remote commands. ARCHITECTURE.md §5.8 */
export default function MirrorPage() {
  return (
    <Suspense fallback={null}>
      <Mirror />
    </Suspense>
  );
}

function Mirror() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [client, setClient] = useState<SessionClient | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const serverParam = params.get("server");

  const join = async (c: string) => {
    setError(null);
    setStatus("pairing");
    try {
      const cl = await connect({
        serverUrl: serverParam ?? sessionServerUrl(),
        code: c,
        onState: setState,
        onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s),
      });
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
      setError((err as Error).message);
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
      if (!r.ok) setError(r.error ?? "command failed");
      else setError(null);
    });
  };

  if (!client) {
    return (
      <div className="app stage pair">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <div className="subtitle">mirror · enter the 6-digit code shown on the engine</div>
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
            autoFocus
          />
          <button className="btn primary" type="submit" disabled={code.length !== 6 || status === "pairing"}>
            {status === "pairing" ? "Pairing…" : "Join"}
          </button>
        </form>
        {error && <span className="chip err">{error}</span>}
      </div>
    );
  }

  const offline = status.startsWith("connecting") || !state;
  return (
    <StageView
      state={state ?? emptyState(client.id)}
      onCommand={onCommand}
      stage
      banner={error ?? (offline ? "engine offline — showing last known state" : null)}
    />
  );
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
