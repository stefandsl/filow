import { NextResponse } from "next/server";
import os from "node:os";
import { CLEF_LOCAL_MODEL, OLLAMA_URL } from "@/lib/decide/clef";
import { LOCAL_MODELS, fits, versionAtLeast } from "@/lib/localModels";
import { PII_SERVER_URL, piiMode, rizzoReachable } from "@/lib/pii/guard";
import { isSetupPreference, recommendProfile, resolveSetup } from "@filow/core";
import { localHelper } from "@/lib/buddy/providers";
import { pickTranslateModel } from "@/lib/translateLocal";
import { gpuInfo, machineInfo } from "@/lib/sysinfo";
import { freellmConfigured } from "@/lib/freellm";

export const dynamic = "force-dynamic";

/** What is installed and whether the machine can run each local model. */
export async function GET(req: Request) {
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  const base = OLLAMA_URL();
  let version: string | null = null;
  let installed: Array<{ name: string; sizeGb: number }> = [];
  try {
    const v = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
    version = String(v.version ?? "");
    const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
    installed = ((tags.models ?? []) as Array<{ name: string; size: number }>).map((m) => ({
      name: m.name,
      sizeGb: Math.round((m.size / 1024 ** 3) * 10) / 10,
    }));
  } catch {
    /* Ollama not reachable */
  }
  const models = LOCAL_MODELS.map((m) => ({
    ...m,
    fit: fits(ramGb, m),
    installed: m.runtime === "ollama" && installed.some((i) => i.name === m.name || i.name.startsWith(`${m.name}:`)),
    installedSizeGb: installed.find((i) => i.name === m.name || i.name.startsWith(`${m.name}:`))?.sizeGb ?? null,
    ollamaOk: m.runtime !== "ollama" ? true : m.minOllama && version ? versionAtLeast(version, m.minOllama) : Boolean(version),
  }));
  const pii = { mode: piiMode(), serverUrl: PII_SERVER_URL(), serverReachable: process.env.FILOW_OFFLINE !== "1" && await rizzoReachable() };
  const gpu = await gpuInfo();
  // what is installed needs no free disk: the setup does not flip after its own downloads
  const hardware = machineInfo(gpu, installed.map((i) => i.name));
  // Which Ollama model each feature would call now, from the feature's own picker: the settings page
  // shows "in use" from this (lib/modelUse.ts), never from a guess of its own.
  const names = installed.map((i) => i.name);
  const wanted = new URL(req.url).searchParams.get("setup");
  const resolved = resolveSetup(isSetupPreference(wanted) ? wanted : "auto", hardware);
  const helpers = new Set<string>();
  // an everyday question and one that asks for a drawing: on "Best quality" they go to different models
  for (const question of ["what is this?", "explain it with a drawing"]) {
    try { helpers.add(localHelper(resolved, names, question).model); } catch { /* this setup has no local helper */ }
  }
  const picks = { decision: CLEF_LOCAL_MODEL(), translate: pickTranslateModel(names), okfilow: [...helpers] };
  return NextResponse.json({
    picks,
    pii,
    ollama: { url: base, reachable: version !== null, version, minimum: "0.35.1", ok: version ? versionAtLeast(version, "0.35.1") : false },
    machine: { ramGb, platform: process.platform, arch: process.arch },
    offline: process.env.FILOW_OFFLINE === "1",
    defaultProvider: process.env.DECISION_PROVIDER || "openrouter",
    openrouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    freellmReady: freellmConfigured(),
    cloudflareKey: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    models,
    installed,
    recommendation: ramGb >= 32 ? "clef" : ramGb >= 16 ? "clef-flash" : null,
    gpu: { name: gpu.name, kind: gpu.kind, vramTotalGb: gpu.vramTotalGb },
    // the setup profiles (P3): the page applies the user's preference with resolveSetup(pref, hardware)
    hardware,
    setup: recommendProfile(hardware),
  });
}
