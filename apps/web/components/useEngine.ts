"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Engine, gatedDecide, gateThresholdsFor, matcherDecide, type DecideRequest, type DecideResponse, type DecisionProviderId, type PointVectors, type SessionState } from "@filow/core";
import { useLang } from "@filow/ui";
import { engineHeaders } from "./useSession";
import { pageOutbound } from "./usePageOutbound";
import { getDecisionProvider, getGateMode, getLang } from "@/lib/prefs";
import { localizeFreeLlmError } from "@/lib/freellm";
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
    // a FreeLLMAPI failure names its reason and the next step, in the user's language
    throw new Error(localizeFreeLlmError(error ?? `decide failed (${res.status})`, getLang()));
  }
  return (await res.json()) as DecideResponse;
}

/**
 * The engine's `reload`: local Clef that Ollama unloaded mid-take (another model took the GPU) is
 * loaded again the way the take start does (no 2.5 s limit, pinned), never replaced by a cloud model.
 * Other providers have nothing to reload.
 */
export function reloadDecisionModel(provider: DecisionProviderId | undefined, post: typeof fetch = fetch): Promise<unknown> | undefined {
  return provider === "clef-local" ? post("/api/local/warmup", { method: "POST" }) : undefined;
}

/** Point vectors are needed by the gate (when on) and by the on-device matcher (always). */
const wantsPoints = () => gateAvailable() && (getGateMode() === "on" || getDecisionProvider() === "matcher");

/**
 * One Engine per mounted component, plus its latest state. With the pre-filter on (Settings),
 * each decision first goes through the embedding gate: the model is asked only about the points
 * the speech resembles, and not at all when nothing matches. With the on-device matcher (the Lite
 * and Standard setups) there is no model: the gate's scores decide, in the page. Point vectors are
 * prepared when the script changes and cached per script; until they are ready the call goes
 * straight to the model, and the matcher answers "not started".
 */
export function useEngine() {
  const points = useRef<PointVectors | null>(null);
  /** The preparation in flight for the current script, so a take started later can wait for it. */
  const preparing = useRef<(() => void) | null>(null);
  const engine = useMemo(() => {
    // The gate's mode follows the provider chosen at take start (gateThresholdsFor: local Clef only skips calls).
    const narrowed = gatedDecide(decideViaApi, browserEmbed, () => points.current, gateThresholdsFor(undefined));
    const skipOnly = gatedDecide(decideViaApi, browserEmbed, () => points.current, gateThresholdsFor("clef-local"));
    const matcher = matcherDecide(browserEmbed, () => points.current);
    const decide = (r: DecideRequest, signal?: AbortSignal) => {
      const provider = getDecisionProvider();
      if (provider === "matcher") {
        if (!points.current) preparing.current?.();
        return matcher(r, signal);
      }
      if (getGateMode() !== "on" || !gateAvailable()) return decideViaApi(r, signal);
      return (gateThresholdsFor(provider).narrow === false ? skipOnly : narrowed)(r, signal);
    };
    return new Engine({ decide, reload: () => reloadDecisionModel(getDecisionProvider()) });
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
    const bullets = script.sections.flatMap((s) => s.bullets);
    let live = true;
    let started = false;
    const prepare = () => {
      if (started || !bullets.length || !gateAvailable()) return;
      started = true;
      preparePoints(bullets, lang).then(
        (pv) => {
          if (live) points.current = pv;
        },
        () => {
          started = false; // try again on the next call; until then no gate, and the matcher answers "not started"
        },
      );
    };
    preparing.current = prepare;
    if (wantsPoints()) prepare();
    return () => {
      live = false;
      preparing.current = null;
    };
  }, [script, lang]);
  return { engine, state };
}
