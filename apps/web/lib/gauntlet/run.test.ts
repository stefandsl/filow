// Gauntlet runner (docs/local-latency-gauntlet.md, Round 0). Opt-in: it calls real models.
//   GAUNTLET=1 GAUNTLET_PROVIDERS=openrouter,clef-local npx vitest run apps/web/lib/gauntlet
// GAUNTLET_GATE=1 puts the embedding gate (packages/core/src/gate.ts) in front of every provider:
// the model is asked only about the points whose similarity to the transcript tail is >= GAUNTLET_GATE_LOW
// (default 0.3), and not at all when no point passes. Variant name becomes "gate".
// Reads every corpus under docs/gauntlet/corpus/<name>/ (script.md, transcript.json, labels.json),
// replays it through the Engine with each provider, prints a table and writes
// docs/gauntlet/results/<provider>-<corpus>.json. Keys come from the desktop profile's .env
// (%APPDATA%/@filow/desktop/.env) when the shell has none.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_GATE, embedPoints, gatedDecide, parseScript, replay, type Corpus, type GateThresholds, type ReplayResult } from "@filow/core";
import { loadEmbedder } from "@/lib/gate/embedder";
import { decideOpenRouter } from "@/lib/decide/openrouter";
import { decideClefLocal, warmClefLocal } from "@/lib/decide/clef";

const ROOT = path.resolve(__dirname, "../../../..");
const CORPUS_DIR = path.join(ROOT, "docs", "gauntlet", "corpus");
const RESULTS_DIR = path.join(ROOT, "docs", "gauntlet", "results");
const on = process.env.GAUNTLET === "1";

function loadEnvFromProfile() {
  const candidates = [
    path.join(process.env.APPDATA || "", "@filow", "desktop", ".env"),
    path.join(os.homedir(), "Library", "Application Support", "@filow", "desktop", ".env"),
    path.join(os.homedir(), ".config", "@filow", "desktop", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (v && !(m[1] in process.env)) process.env[m[1]] = v;
    }
    return file;
  }
  return null;
}

function loadCorpora(): Corpus[] {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((d) => fs.existsSync(path.join(CORPUS_DIR, d, "transcript.json")))
    .map((d) => {
      const dir = path.join(CORPUS_DIR, d);
      const t = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8")) as { segments: Corpus["transcript"] };
      const l = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8")) as { labels: Corpus["labels"]; neverStarted?: string[] };
      return { name: d, language: d.endsWith("-en") ? "en" : "it", script: fs.readFileSync(path.join(dir, "script.md"), "utf8"), transcript: t.segments, labels: l.labels, neverStarted: l.neverStarted } satisfies Corpus;
    });
}

const PROVIDERS: Record<string, (r: Parameters<typeof decideOpenRouter>[0], signal?: AbortSignal) => ReturnType<typeof decideOpenRouter>> = {
  openrouter: (r) => decideOpenRouter(r),
  "clef-local": (r, signal) => decideClefLocal(r, signal),
};

function line(r: ReplayResult, provider: string): string {
  return `${provider.padEnd(12)} ${r.corpus.padEnd(10)} calls ${String(r.calls).padStart(3)}  p50 ${String(r.latencyMs.p50).padStart(5)} ms  p95 ${String(r.latencyMs.p95).padStart(5)} ms  timeouts ${r.timeouts}  correct ${r.correct}  late ${r.late}  false ${r.falseStarts}  miss ${r.misses}  precision ${r.precision ?? "-"}  recall ${r.recall ?? "-"}  delay p50 ${r.delaySec.p50 ?? "-"} s  guarded ${r.guarded}`;
}

describe.skipIf(!on)("gauntlet (real providers)", () => {
  it("replays every corpus with every requested provider and writes the results", async () => {
    const envFile = loadEnvFromProfile();
    const corpora = loadCorpora();
    expect(corpora.length).toBeGreaterThan(0);
    const wanted = (process.env.GAUNTLET_PROVIDERS || "openrouter").split(",").map((s) => s.trim()).filter((p) => p in PROVIDERS);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const lines: string[] = [`env: ${envFile ?? "shell only"} · model ${process.env.OPENROUTER_DECISION_MODEL ?? "default"} / ${process.env.CLEF_MODEL ?? "clef-flash"} · ${os.cpus()[0]?.model} · ${Math.round(os.totalmem() / 1024 ** 3)} GB`];
    for (const provider of wanted) {
      if (provider === "clef-local") {
        // A cold Clef load takes ~16 s; calls aborted at the timeout never let it finish, so warm it first.
        const w = await warmClefLocal();
        lines.push(`clef-local warm-up: ${w.ok ? "ok" : `failed (${w.error})`} in ${w.ms} ms`);
      }
      for (const corpus of corpora) {
        const engine = {
          timeoutMs: Number(process.env.GAUNTLET_TIMEOUT_MS || 2500),
          ...(process.env.GAUNTLET_CONFIRM ? { confirmCalls: Number(process.env.GAUNTLET_CONFIRM) } : {}),
          ...(process.env.GAUNTLET_SURE ? { sureThreshold: Number(process.env.GAUNTLET_SURE) } : {}),
          ...(process.env.GAUNTLET_WINDOW ? { window: Number(process.env.GAUNTLET_WINDOW) } : {}),
          ...(process.env.GAUNTLET_REASK ? { reaskOnPending: process.env.GAUNTLET_REASK === "1" } : {}),
          ...(process.env.GAUNTLET_GUARD === "0" ? { guard: false } : {}),
        };
        let variant = process.env.GAUNTLET_VARIANT || "default";
        let decide = PROVIDERS[provider];
        const gateStats = { calls: 0, skipped: 0, candidates: 0, embedLoadMs: 0 };
        if (process.env.GAUNTLET_GATE === "1") {
          variant = variant === "default" ? "gate" : `${variant}-gate`;
          const { embed, loadMs } = await loadEmbedder();
          gateStats.embedLoadMs = loadMs;
          const th: GateThresholds = { ...DEFAULT_GATE, low: Number(process.env.GAUNTLET_GATE_LOW || DEFAULT_GATE.low) };
          const pv = await embedPoints(embed, parseScript(corpus.script).sections.flatMap((sec) => sec.bullets), corpus.language);
          decide = gatedDecide(PROVIDERS[provider], embed, () => pv, th, (o) => {
            gateStats.calls++;
            if (o.skipped) gateStats.skipped++;
            else gateStats.candidates += o.candidates.length;
          });
        }
        const r = await replay(corpus, { decide, engine });
        const out = { provider, variant, engine, gate: process.env.GAUNTLET_GATE === "1" ? gateStats : undefined, machine: { cpu: os.cpus()[0]?.model, ramGb: Math.round(os.totalmem() / 1024 ** 3), platform: process.platform }, at: new Date().toISOString(), ...r };
        fs.writeFileSync(path.join(RESULTS_DIR, `${provider}-${corpus.name}${variant === "default" ? "" : `-${variant}`}.json`), JSON.stringify(out, null, 2));
        lines.push(line(r, `${provider}${variant === "default" ? "" : `/${variant}`}`) + (process.env.GAUNTLET_GATE === "1" ? `  gate: ${gateStats.skipped}/${gateStats.calls} model calls skipped, ${gateStats.candidates} candidates asked` : ""));
      }
    }
    // eslint-disable-next-line no-console
    console.log("\n" + lines.join("\n") + "\n");
  }, 600_000);
});
