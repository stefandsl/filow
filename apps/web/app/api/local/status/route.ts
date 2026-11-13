import { NextResponse } from "next/server";
import os from "node:os";
import { CLEF_LOCAL_MODEL, OLLAMA_URL } from "@/lib/decide/clef";
import { LOCAL_MODELS, fits, versionAtLeast } from "@/lib/localModels";
import { PII_SERVER_URL, piiMode, rizzoReachable } from "@/lib/pii/guard";
import { isSetupPreference, recommendProfile, resolveSetup } from "@filow/core";
import { localHelper, type LocalHelper } from "@/lib/buddy/providers";
import { isPointOnly } from "@/lib/buddy/pointer";
import { pinHelper } from "@/lib/modelRoles/helper";
import { taskTarget } from "@/lib/modelRoles/resolve";
import { readRoles } from "@/lib/modelRoles/store";
import { pickTranslateModel } from "@/lib/translateLocal";
import { gpuInfo, machineInfo, qaHardware } from "@/lib/sysinfo";
import { freellmConfigured } from "@/lib/freellm";

export const dynamic = "force-dynamic";

/** What is installed and whether the machine can run each local model. */
export async function GET(req: Request) {
  const ramGb = qaHardware()?.ramGb ?? Math.round(os.totalmem() / 1024 ** 3);
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
  // The models the user chose per task in Settings (lib/modelRoles) come first. Only a model that runs
  // on this PC is "in use" here; one on the user's own server is shown with that server.
  const roles = readRoles();
  const here = (t: { model: string | null; server: unknown }) => (t.server ? null : t.model);
  const setupPointer = resolved.choices.screenHelper.pointer ?? null;
  // an everyday question, a "where is it" question and one that asks for a drawing: on "Best quality"
  // they go to different models (an answer with a diagram and a plain "draw a car" may go to two
  // different ones), and a setup may have a second model that places the points: every one is in use
  for (const question of ["what is this?", "where is the save button?", "explain it with a drawing", "draw a car"]) {
    let auto: LocalHelper | Error;
    try {
      auto = localHelper(resolved, names, question);
    } catch (e) {
      auto = e instanceof Error ? e : new Error(String(e));
    }
    try {
      const helper = await pinHelper(auto, { task: "okfilowAnswers", pointOnly: isPointOnly(question), setupPointer, roles });
      if (!helper.at?.server) helpers.add(helper.model);
      if (helper.pointer && !helper.pointerAt?.server) helpers.add(helper.pointer);
    } catch { /* this setup has no local helper */ }
  }
  const [decision, translate, generate, whiteboard] = await Promise.all([
    taskTarget("decision", CLEF_LOCAL_MODEL(), roles),
    taskTarget("translate", pickTranslateModel(names), roles),
    taskTarget("generate", null, roles),
    taskTarget("whiteboard", null, roles),
  ]);
  const picks = {
    decision: here(decision) ?? "",
    translate: here(translate),
    okfilow: [...helpers],
    // only when the user chose them: otherwise the take's plan and OK Filow's helper say it
    ...(generate.pinned ? { generate: here(generate) } : {}),
    ...(whiteboard.pinned ? { whiteboard: here(whiteboard) } : {}),
  };
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
