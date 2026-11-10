"use client";

import { selectedWhisperModel, sherpaBridge, whisperCached, browserSupported } from "@filow/stt";
import type { ResolvedSetup } from "@filow/core";
import type { Plan } from "./router";
import { getSetupPreference } from "./prefs";
import { engineHeaders, ensureEngineToken } from "@/components/useSession";

export type PlanResponse = Plan & { setup: ResolvedSetup | null; machine: { gpu: string; gpuKind: string; vramTotalGb: number | null; ramGb: number }; installed: string[]; ollamaOk: boolean; keys: Record<string, boolean>; offline: boolean };

/**
 * Asks the router for the best setup on this machine, following the setup profile the user chose
 * (Settings > Local models). `probe` measures one real call per candidate (1 to 6 s) and spends one
 * OpenRouter call when a key exists: only the explicit Measure button sets it.
 */
export async function fetchPlan(opts: { probe: boolean; apply?: boolean }): Promise<PlanResponse> {
  const [sherpaReady, cached] = await Promise.all([
    sherpaBridge()
      ?.status()
      .then((s) => s.model === "ready")
      .catch(() => false) ?? Promise.resolve(false),
    whisperCached(selectedWhisperModel()).catch(() => false),
  ]);
  await ensureEngineToken();
  const res = await fetch("/api/local/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...engineHeaders() },
    body: JSON.stringify({ probe: opts.probe, apply: opts.apply ?? false, sherpaReady, whisperCached: cached, webSpeech: browserSupported(), setup: getSetupPreference() }),
  });
  if (!res.ok) throw new Error(`plan failed (${res.status})`);
  return (await res.json()) as PlanResponse;
}
