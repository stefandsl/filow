import { NextResponse } from "next/server";
import os from "node:os";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { cpuPercent, gpuInfo, loadedModels, localAdvice, ramInfo } from "@/lib/sysinfo";

export const dynamic = "force-dynamic";

/** Live resources for the Settings dashboard: CPU, RAM, GPU memory and where each loaded model runs. */
export async function GET() {
  const [cpu, gpu, loaded] = await Promise.all([cpuPercent(), gpuInfo(), loadedModels(OLLAMA_URL())]);
  const ram = ramInfo();
  return NextResponse.json({
    at: Date.now(),
    cpu: { pct: cpu, cores: os.cpus().length, model: os.cpus()[0]?.model ?? "" },
    ram,
    gpu,
    loaded,
    advice: localAdvice(gpu, ram.totalGb),
  });
}
