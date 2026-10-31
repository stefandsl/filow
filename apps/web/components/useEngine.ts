"use client";

import { useEffect, useMemo, useState } from "react";
import { Engine, type DecideRequest, type DecideResponse, type SessionState } from "@intelliprompter/core";
import { engineHeaders } from "./useSession";

/** Decide through the Next.js API route on the same origin. */
async function decideViaApi(req: DecideRequest): Promise<DecideResponse> {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...engineHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `decide failed (${res.status})`);
  }
  return (await res.json()) as DecideResponse;
}

/** One Engine per mounted component, plus its latest state. */
export function useEngine() {
  const engine = useMemo(() => new Engine({ decide: decideViaApi }), []);
  const [state, setState] = useState<SessionState>(engine.getState());
  useEffect(() => {
    const unsub = engine.subscribe((s) => setState(s));
    return () => {
      unsub();
      engine.stop();
    };
  }, [engine]);
  return { engine, state };
}
