"use client";

import { useEffect, useRef, useState } from "react";
import { connect, type SessionClient } from "@intelliprompter/client";
import type { Engine } from "@intelliprompter/core";
import { desktopBridge, mirrorOrigin, sessionServerUrl } from "@/lib/sessionUrl";

export type SessionInfo = {
  id: string;
  code: string;
  engineToken: string;
  serverUrl: string;
  /** URL a phone opens to mirror this session */
  mirrorUrl: string;
};

/** The engine token, attached to spend endpoints when the server requires it. */
export const engineTokenStore: { token: string | null } = { token: null };

export function engineHeaders(): Record<string, string> {
  return engineTokenStore.token ? { Authorization: `Bearer ${engineTokenStore.token}` } : {};
}

function storedPassword(): string {
  const bridge = desktopBridge();
  if (bridge?.accessPassword) return bridge.accessPassword;
  try {
    return localStorage.getItem("session:password") ?? "";
  } catch {
    return "";
  }
}

/**
 * Engine side of ARCHITECTURE.md §5.4: create a session, connect as engine,
 * publish every state change, apply incoming commands.
 */
export function useSession(engine: Engine) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<string>("offline");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SessionClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      const serverUrl = sessionServerUrl();
      const password = storedPassword();
      try {
        const res = await fetch(`${serverUrl}/api/session`, {
          method: "POST",
          headers: password ? { "X-Access-Password": password } : {},
        });
        if (res.status === 401) {
          setError("session server needs the access password");
          return;
        }
        if (!res.ok) throw new Error(`session create failed (${res.status})`);
        const created = (await res.json()) as { id: string; code: string; engineToken: string };
        if (cancelled) return;
        engineTokenStore.token = created.engineToken;
        const sameOriginRelay = serverUrl === window.location.origin;
        const mirrorUrl =
          `${mirrorOrigin()}/mirror?code=${created.code}` + (sameOriginRelay ? "" : `&server=${encodeURIComponent(serverUrl)}`);
        setInfo({ ...created, serverUrl, mirrorUrl });

        const client = await connect({
          serverUrl,
          session: { id: created.id, token: created.engineToken, role: "engine" },
          onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s),
        });
        if (cancelled) return client.close();
        clientRef.current = client;
        client.onCommand((cmd, ack) => {
          const r = engine.dispatch(cmd);
          ack(r.ok ? { ok: true } : { ok: false, error: r.error });
        });
        client.onResync(() => client.publishState(engine.getState()));
        client.publishState(engine.getState());
        unsub = engine.subscribe((state, ops) => {
          if (ops.length > 40 || state.version % 50 === 0) client.publishState(state);
          else client.publishPatch(state.version, ops);
        });
        setError(null);
      } catch {
        if (!cancelled) setError(`session server unreachable at ${serverUrl}`);
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [engine]);

  return { info, status, error };
}
