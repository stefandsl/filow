"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connect, type PairDecision, type PairedDevice, type PairRequest, type SessionClient } from "@filow/client";
import type { Engine, SessionState } from "@filow/core";
import { CLOCK_REFRESH_MS, clockKey, takeRecorder, withClock } from "./TimerClock";
import { desktopBridge, sessionServerUrl } from "@/lib/sessionUrl";
import { loadedTargets, phoneLink, phoneTargets } from "@/lib/phoneLink";
import { useRemoteStatus } from "@/lib/useRemoteStatus";
import { sessionCommand } from "@/lib/buddy/phoneAsk";
import { okFilowSettingsBridge } from "@/lib/buddy/bridge";

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
  // Every pairing, as the session server reports it: the devices list (components/PairedDevices.tsx).
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const devicesRef = useRef<PairedDevice[]>([]);
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

  /** End a pairing: the device is disconnected and its token stops working. */
  const revokeDevice = useCallback((id: string) => clientRef.current?.revoke(id), []);
  /** Let a controller ask OK Filow, or stop it (off by default; each question still waits for the presenter's yes). */
  const allowAsk = useCallback((id: string, allow: boolean) => clientRef.current?.allowAsk(id, allow), []);

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
          onDevices: (list) => {
            devicesRef.current = list;
            setDevices(list);
            setPairRequests((r) => r.filter((p) => list.some((d) => d.id === p.token && d.role === "pending")));
          },
          // A device auto-accepted on the Wi-Fi spent the code too: the next one is ready.
          onPaired: (d) => { if (d.role !== "pending") void newCode(); },
          // Too many wrong codes: the server burned the code on screen and sent a new one.
          onCode: ({ code, codeExpiresAt }) => {
            setInfo((i) => (i ? { ...i, code, codeExpiresAt } : i));
            desktopBridge()?.reportSession?.({ id: created.id, code });
          },
        });
        if (cancelled) return client.close();
        clientRef.current = client;
        client.onCommand((cmd, ack, from) => {
          // A paired phone's question for OK Filow is checked against the devices list and handed to the desktop app; never to the engine (lib/buddy/phoneAsk.ts).
          const bridge = okFilowSettingsBridge();
          void sessionCommand(cmd, from, {
            dispatch: (c) => engine.dispatch(c),
            mayAsk: (id) => devicesRef.current.some((d) => d.id === id && d.role === "controller" && d.canAsk),
            askFromPhone: bridge?.askFromPhone ? (p) => bridge.askFromPhone!(p) : undefined,
          }).then((r) => ack(r.ok ? { ok: true } : { ok: false, error: r.error }));
        });
        // Full states carry the talk clock (TimerClock.ts) for the phone's timer; a patch keeps it.
        let sentClock = "";
        const publishFull = (state: SessionState) => {
          const full = withClock(engine, state);
          sentClock = clockKey(full.clock!);
          client.publishState(full);
        };
        client.onResync(() => publishFull(engine.getState()));
        publishFull(engine.getState());
        const unsubState = engine.subscribe((state, ops) => {
          takeRecorder(engine).observe(state);
          const clockChanged = clockKey(takeRecorder(engine).talkClock()) !== sentClock;
          if (clockChanged || ops.length > 40 || state.version % 50 === 0) publishFull(state);
          else client.publishPatch(state.version, ops);
        });
        // A phone that joins later gets the server's stored state, whose clock may be old: a fresh one
        // every few seconds during a take lines its timer up again (TimerMirror.tsx).
        const refresh = setInterval(() => { if (engine.getState().engine.recording) publishFull(engine.getState()); }, CLOCK_REFRESH_MS);
        unsub = () => { unsubState(); clearInterval(refresh); };
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

  return { info, status, error, pairRequests, decidePair, newCode, devices, revokeDevice, allowAsk };
}
