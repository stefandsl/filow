import { NextResponse } from "next/server";
import os from "node:os";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { LOCAL_MODELS, fits, versionAtLeast } from "@/lib/localModels";

export const dynamic = "force-dynamic";

/** What is installed and whether the machine can run each local model. */
export async function GET() {
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
    installed: installed.some((i) => i.name === m.name || i.name.startsWith(`${m.name}:`)),
    ollamaOk: m.minOllama && version ? versionAtLeast(version, m.minOllama) : Boolean(version),
  }));
  return NextResponse.json({
    ollama: { url: base, reachable: version !== null, version, minimum: "0.35.1", ok: version ? versionAtLeast(version, "0.35.1") : false },
    machine: { ramGb, platform: process.platform, arch: process.arch },
    offline: process.env.INTELLIPROMPTER_OFFLINE === "1",
    defaultProvider: process.env.DECISION_PROVIDER || "openrouter",
    openrouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    cloudflareKey: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    models,
    installed,
    recommendation: ramGb >= 32 ? "clef" : ramGb >= 16 ? "clef-flash" : null,
  });
}
