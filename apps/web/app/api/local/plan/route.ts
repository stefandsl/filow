import { NextResponse } from "next/server";
import os from "node:os";
import { OLLAMA_URL, decideClefLocal } from "@/lib/decide/clef";
import { decideOpenRouter } from "@/lib/decide/openrouter";
import { isSetupPreference, resolveSetup } from "@filow/core";
import { gpuInfo, machineInfo } from "@/lib/sysinfo";
import { requireEngine } from "@/lib/engineAuth";
import { buildPlan, type Plan, type PlanInput } from "@/lib/router";

export const dynamic = "force-dynamic";

const PROBE_REQUEST = {
  transcript: "so first of all, welcome everybody, great to see you all here today; let me start with who we are",
  bullets: [
    { id: "a", text: "welcome the audience" },
    { id: "b", text: "explain the pricing" },
    { id: "c", text: "who we are" },
  ],
  sectionTitle: "Intro",
  covered: [] as string[],
  upcoming: ["the demo"],
};

async function timed(fn: () => Promise<unknown>, timeoutMs: number): Promise<number | null> {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_r, rej) => setTimeout(() => rej(new Error("probe timeout")), timeoutMs))]);
    return Date.now() - t0;
  } catch {
    return null;
  }
}

/**
 * The model router. Body: { probe?: boolean, sherpaReady?: boolean, whisperCached?: boolean, webSpeech?: boolean, apply?: boolean }.
 * `probe` runs one real decision per available candidate (local Clef, OpenRouter) and uses the measured
 * latency; `apply` makes the server use the plan's slide-generation choice for this run.
 */
export async function POST(req: Request) {
  // Engine token required while ACCESS_PASSWORD is set: `probe` spends one OpenRouter call and
  // `apply` changes the server's slide-generation provider for everyone.
  const denied = requireEngine(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { probe?: boolean; sherpaReady?: boolean; whisperCached?: boolean; webSpeech?: boolean; apply?: boolean; setup?: string };
  const base = OLLAMA_URL();
  let ollamaOk = false;
  let installed: string[] = [];
  try {
    const v = (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())) as { version?: string };
    ollamaOk = Boolean(v.version);
    const tags = (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())) as { models?: Array<{ name: string }> };
    installed = (tags.models ?? []).map((m) => m.name);
  } catch {
    /* no Ollama */
  }
  const gpu = await gpuInfo();
  const offline = process.env.FILOW_OFFLINE === "1";
  const keys = {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    cloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
  };
  const probes: PlanInput["probes"] = {};
  if (body.probe) {
    const clefThere = ollamaOk && installed.some((n) => n.startsWith("clef"));
    const [clef, cloud] = await Promise.all([
      clefThere ? timed(() => decideClefLocal(PROBE_REQUEST), 6000) : Promise.resolve(undefined),
      keys.openrouter && !offline ? timed(() => decideOpenRouter(PROBE_REQUEST), 6000) : Promise.resolve(undefined),
    ]);
    if (clef !== undefined) probes.clefLocalMs = clef;
    if (cloud !== undefined) probes.openrouterMs = cloud;
  }
  // The setup profile; "probe" (the Measure button) keeps the older measured routing.
  const setup = body.probe ? null : resolveSetup(isSetupPreference(body.setup) ? body.setup : "auto", machineInfo(gpu));
  const plan: Plan = buildPlan({
    setup: setup?.choices ?? null,
    installed,
    ollamaOk,
    gpu: { kind: gpu.kind, vramTotalGb: gpu.vramTotalGb },
    ramGb: Math.ceil(os.totalmem() / 1024 ** 3),
    keys,
    offline,
    sherpaReady: Boolean(body.sherpaReady),
    whisperCached: Boolean(body.whisperCached),
    webSpeech: Boolean(body.webSpeech),
    probes,
  });
  if (body.apply) {
    // The slide generator reads these at call time; the take's decision provider and STT backend are set by the page.
    if (plan.generate.provider === "ollama" && plan.generate.model) {
      process.env.GENERATE_PROVIDER = "ollama";
      process.env.GENERATE_LOCAL_MODEL = plan.generate.model;
    } else if (plan.generate.provider === "openrouter") {
      process.env.GENERATE_PROVIDER = "openrouter";
    }
  }
  return NextResponse.json({ ...plan, setup, machine: { gpu: gpu.name, gpuKind: gpu.kind, vramTotalGb: gpu.vramTotalGb, ramGb: Math.ceil(os.totalmem() / 1024 ** 3) }, installed, ollamaOk, keys, offline });
}
