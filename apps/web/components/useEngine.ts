"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Engine, gatedDecide, type DecideRequest, type DecideResponse, type PointVectors, type SessionState } from "@filow/core";
import { useLang } from "@filow/ui";
import { engineHeaders } from "./useSession";
import { getDecisionProvider, getGateMode } from "@/lib/prefs";
import { browserEmbed, gateAvailable, preparePoints } from "@/lib/gate/client";

/** Decide through the Next.js API route on the same origin, with the provider chosen in Settings. */
async function decideViaApi(req: DecideRequest, signal?: AbortSignal): Promise<DecideResponse> {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...engineHeaders() },
    body: JSON.stringify({ ...req, provider: getDecisionProvider() }),
    signal,
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `decide failed (${res.status})`);
  }
  return (await res.json()) as DecideResponse;
}

/**
 * One Engine per mounted component, plus its latest state. With the pre-filter on (Settings),
 * each decision first goes through the embedding gate: the model is asked only about the points
 * the speech resembles, and not at all when nothing matches. Point vectors are prepared when the
 * script changes and cached per script; until they are ready the call goes straight to the model.
 */
export function useEngine() {
  const points = useRef<PointVectors | null>(null);
  const engine = useMemo(() => {
    const gated = gatedDecide(decideViaApi, browserEmbed, () => points.current);
    const decide = (r: DecideRequest, signal?: AbortSignal) => (getGateMode() === "on" && gateAvailable() ? gated(r, signal) : decideViaApi(r, signal));
    return new Engine({ decide });
  }, []);
  const [state, setState] = useState<SessionState>(engine.getState());
  const lang = useLang();
  useEffect(() => {
    const unsub = engine.subscribe((s) => setState(s));
    return () => {
      unsub();
      engine.stop();
    };
  }, [engine]);
  const script = state.script;
  useEffect(() => {
    points.current = null;
    if (getGateMode() !== "on" || !gateAvailable()) return;
    const bullets = script.sections.flatMap((s) => s.bullets);
    if (!bullets.length) return;
    let live = true;
    preparePoints(bullets, lang).then(
      (pv) => {
        if (live) points.current = pv;
      },
      () => {
        /* no gate: decisions go straight to the model */
      },
    );
    return () => {
      live = false;
    };
  }, [script, lang]);
  return { engine, state };
}
