"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Engine, gatedDecide, gateThresholdsFor, type DecideRequest, type DecideResponse, type PointVectors, type SessionState } from "@filow/core";
import { useLang } from "@filow/ui";
import { engineHeaders } from "./useSession";
import { pageOutbound } from "./usePageOutbound";
import { getDecisionProvider, getGateMode } from "@/lib/prefs";
import { browserEmbed, gateAvailable, preparePoints } from "@/lib/gate/client";

/**
 * Decide through the Next.js API route on the same origin, with the provider chosen in Settings.
 * A cloud decider reads the spoken words: the call carries the consent key the take was given
 * and shows the going-outside signal while it runs. Without a yes the call goes without the key,
 * and the server answers a cloud provider with a refusal, so nothing leaves.
 */
async function decideViaApi(req: DecideRequest, signal?: AbortSignal): Promise<DecideResponse> {
  const out = pageOutbound();
  const to = out.route("transcript");
  const call = (consent: Record<string, string>) =>
    fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...engineHeaders(), ...consent },
      body: JSON.stringify({ ...req, provider: getDecisionProvider() }),
      signal,
    });
  const res = to && Object.keys(out.header("transcript", to)).length
    ? await out.sending("transcript", to, async (consent, quiet) => {
        const r = await call(consent);
        if (r.status === 403) quiet(); // refused here: nothing left this PC
        return r;
      })
    : await call({});
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
    // The gate's mode follows the provider chosen at take start (gateThresholdsFor: local Clef only skips calls).
    const narrowed = gatedDecide(decideViaApi, browserEmbed, () => points.current, gateThresholdsFor(undefined));
    const skipOnly = gatedDecide(decideViaApi, browserEmbed, () => points.current, gateThresholdsFor("clef-local"));
    const decide = (r: DecideRequest, signal?: AbortSignal) => {
      if (getGateMode() !== "on" || !gateAvailable()) return decideViaApi(r, signal);
      return (gateThresholdsFor(getDecisionProvider()).narrow === false ? skipOnly : narrowed)(r, signal);
    };
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
