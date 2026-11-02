"use client";

import { selectedWhisperModel, sherpaBridge, whisperCached, browserSupported } from "@filow/stt";
import type { Plan } from "./router";

export type PlanResponse = Plan & { machine: { gpu: string; gpuKind: string; vramTotalGb: number | null; ramGb: number }; installed: string[]; ollamaOk: boolean; keys: Record<string, boolean>; offline: boolean };

/** Asks the router for the best setup on this machine; `probe` measures one real call per candidate (1–6 s). */
export async function fetchPlan(opts: { probe: boolean; apply?: boolean }): Promise<PlanResponse> {
  const [sherpaReady, cached] = await Promise.all([
    sherpaBridge()
      ?.status()
      .then((s) => s.model === "ready")
      .catch(() => false) ?? Promise.resolve(false),
    whisperCached(selectedWhisperModel()).catch(() => false),
  ]);
  const res = await fetch("/api/local/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probe: opts.probe, apply: opts.apply ?? false, sherpaReady, whisperCached: cached, webSpeech: browserSupported() }),
  });
  if (!res.ok) throw new Error(`plan failed (${res.status})`);
  return (await res.json()) as PlanResponse;
}
