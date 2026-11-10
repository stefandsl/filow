"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connect, type PairDecision, type PairRequest, type SessionClient } from "@filow/client";
import type { Engine } from "@filow/core";
import { desktopBridge, sessionServerUrl } from "@/lib/sessionUrl";
import { loadedTargets, phoneLink, phoneTargets } from "@/lib/phoneLink";
import { useRemoteStatus } from "@/lib/useRemoteStatus";

export type SessionInfo = {
  id: string;
  code: string;
  /** when the current code stops working (ms epoch); 0 = unknown */
  codeExpiresAt: number;
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

/**
 * Pages that are not the prompter (Settings) have no session, hence no engine token, and the
 * spend/local endpoints answer 401 while ACCESS_PASSWORD is set (always, in the desktop app).
 * Mint one by creating a session the same way the prompter does.
 */
export async function ensureEngineToken(): Promise<string | null> {
  if (engineTokenStore.token) return engineTokenStore.token;
  const password = storedPassword();
  try {
    const res = await fetch(`${sessionServerUrl()}/api/session`, { method: "POST", headers: password ? { "X-Access-Password": password } : {} });
    if (!res.ok) return null;
    const created = (await res.json()) as { engineToken?: string };
    engineTokenStore.token = created.engineToken ?? null;
  } catch {
    return null;
  }
  return engineTokenStore.token;
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
  const [pairRequests, setPairRequests] = useState<PairRequest[]>([]);
  const clientRef = useRef<SessionClient | null>(null);
  // The public link comes up after the page: the phone link follows it, the session and its code stay.
  const remote = useRemoteStatus();
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  useEffect(() => {
    setInfo((i) => {
      if (!i) return i;
      const mirrorUrl = phoneLink(i.code, phoneTargets(loadedTargets(), remote));
      return mirrorUrl === i.mirrorUrl ? i : { ...i, mirrorUrl };
    });
  }, [remote]);

  /** Ask the relay for a fresh single-use code (after a phone joined, or when the old one expired). */
  const newCode = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const { code, codeExpiresAt } = await c.requestCode();
      setInfo((i) => (i ? { ...i, code, codeExpiresAt } : i));
      desktopBridge()?.reportSession?.({ id: c.id, code });
    } catch {
      /* relay unreachable; the old code stays on screen */
    }
  }, []);

  const decidePair = useCallback((token: string, decision: PairDecision) => {
    clientRef.current?.decidePair(token, decision);
    setPairRequests((r) => r.filter((p) => p.token !== token));
  }, []);

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
        const created = (await res.json()) as { id: string; code: string; codeExpiresAt?: number; engineToken: string };
        if (cancelled) return;
        engineTokenStore.token = created.engineToken;
        const mirrorUrl = phoneLink(created.code, phoneTargets(loadedTargets(), remoteRef.current));
        setInfo({ ...created, codeExpiresAt: created.codeExpiresAt ?? 0, serverUrl, mirrorUrl });
        desktopBridge()?.reportSession?.({ id: created.id, code: created.code });

        const client = await connect({
          serverUrl,
          session: { id: created.id, token: created.engineToken, role: "engine" },
          onStatus: (s, d) => setStatus(d ? `${s}: ${d}` : s),
          onPairRequest: (req) => {
            setPairRequests((r) => (r.some((p) => p.token === req.token) ? r : [...r, req]));
            void newCode(); // that code is spent; have the next one ready
          },
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
  }, [engine, newCode]);

  return { info, status, error, pairRequests, decidePair, newCode };
}
