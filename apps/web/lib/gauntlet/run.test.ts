// Gauntlet runner (docs/local-latency-gauntlet.md, Round 0). Opt-in: it calls real models.
//   GAUNTLET=1 GAUNTLET_PROVIDERS=openrouter,clef-local npx vitest run apps/web/lib/gauntlet
// GAUNTLET_GATE=1 puts the embedding gate (packages/core/src/gate.ts) in front of every provider:
// the model is asked only about the points whose similarity to the transcript tail is >= GAUNTLET_GATE_LOW
// (default 0.3) or whose lexical score (BM25-weighted fuzzy word match) is >= GAUNTLET_LEX_LOW (default
// 0.5, "off" disables the lexical stage), and not at all when no point passes. Variant name becomes "gate".
// GAUNTLET_GATE_NARROW=0: the gate only skips calls; when any point passes, every open point is asked.
// Reads every corpus under docs/gauntlet/corpus/<name>/ (script.md, transcript.json, labels.json),
// replays it through the Engine with each provider, prints a table and writes
// docs/gauntlet/results/<provider>-<corpus>.json. Keys come from the desktop profile's .env
// (%APPDATA%/@filow/desktop/.env) when the shell has none.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_GATE, DEFAULT_MATCHER, corpusLanguage, embedPoints, gatedDecide, matcherDecide, parseScript, replay, type Corpus, type GateThresholds, type MatcherThresholds, type ReplayResult } from "@filow/core";
import { loadEmbedder } from "@/lib/gate/embedder";
import { decideOpenRouter } from "@/lib/decide/openrouter";
import { decideClefLocal, warmClefLocal } from "@/lib/decide/clef";
import { decideOllamaChat, isSmallDecisionModel } from "@/lib/gauntlet/ollamaChat";

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
      return { name: d, language: corpusLanguage(d), script: fs.readFileSync(path.join(dir, "script.md"), "utf8"), transcript: t.segments, labels: l.labels, neverStarted: l.neverStarted } satisfies Corpus;
    });
}

// ollama-chat: GAUNTLET_OLLAMA_MODEL (a small decision model), GAUNTLET_OLLAMA_CPU=1 pins it to the CPU
// (num_gpu 0) to measure a machine without a graphics card. matcher: no model at all (the Lite setup);
// GAUNTLET_MATCH="simStart,simSure,lexStart,margin" overrides its thresholds.
const ollamaModel = process.env.GAUNTLET_OLLAMA_MODEL || "lfm3-vl";
const ollamaOptions = (): Record<string, number> => (process.env.GAUNTLET_OLLAMA_CPU === "1" ? { num_gpu: 0 } : {});
const PROVIDERS: Record<string, (r: Parameters<typeof decideOpenRouter>[0], signal?: AbortSignal) => ReturnType<typeof decideOpenRouter>> = {
  openrouter: (r) => decideOpenRouter(r),
  "clef-local": (r, signal) => decideClefLocal(r, signal),
  "ollama-chat": (r, signal) => {
    if (!isSmallDecisionModel(ollamaModel)) throw new Error(`not a small decision model: ${ollamaModel}`);
    return decideOllamaChat(r, ollamaModel, signal, ollamaOptions());
  },
  matcher: () => Promise.reject(new Error("the matcher is built per corpus")),
};

// GAUNTLET_MATCH_SENT=<n>: also score the last n sentences of the tail on their own
function matcherThresholds(): MatcherThresholds {
  const sent = process.env.GAUNTLET_MATCH_SENT ? { perSentence: Number(process.env.GAUNTLET_MATCH_SENT) } : {};
  const v = (process.env.GAUNTLET_MATCH || "").split(",").map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) return { ...DEFAULT_MATCHER, ...sent };
  return { ...DEFAULT_MATCHER, ...sent, simStart: v[0], simSure: v[1], lexStart: v[2], margin: v[3] };
}

function line(r: ReplayResult, provider: string): string {
  return `${provider.padEnd(12)} ${r.corpus.padEnd(10)} calls ${String(r.calls).padStart(3)}  p50 ${String(r.latencyMs.p50).padStart(5)} ms  p95 ${String(r.latencyMs.p95).padStart(5)} ms  timeouts ${r.timeouts}  correct ${r.correct}  late ${r.late}  false ${r.falseStarts}  miss ${r.misses}  precision ${r.precision ?? "-"}  recall ${r.recall ?? "-"}  delay p50 ${r.delaySec.p50 ?? "-"} s  guarded ${r.guarded}  verified ${r.verified}  vetoed ${r.vetoed}`;
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
      if (provider === "ollama-chat" && isSmallDecisionModel(ollamaModel)) {
        const t0 = Date.now();
        await decideOllamaChat({ transcript: "warm-up", bullets: [{ id: "a", text: "warm-up" }], sectionTitle: "warm-up" }, ollamaModel, undefined, ollamaOptions()).catch(() => undefined);
        lines.push(`ollama-chat ${ollamaModel} warm-up in ${Date.now() - t0} ms`);
      }
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
          ...(process.env.GAUNTLET_VERIFY === "0" ? { verify: false } : {}),
        };
        let variant = process.env.GAUNTLET_VARIANT || "default";
        let decide = PROVIDERS[provider];
        if (provider === "matcher") {
          const { embed } = await loadEmbedder();
          const pv = await embedPoints(embed, parseScript(corpus.script).sections.flatMap((sec) => sec.bullets), corpus.language);
          decide = matcherDecide(embed, () => pv, matcherThresholds());
          if (process.env.GAUNTLET_MATCH && variant === "default") variant = `m${process.env.GAUNTLET_MATCH.replace(/,/g, "-")}`;
        }
        if (provider === "ollama-chat") variant = `${ollamaModel}${process.env.GAUNTLET_OLLAMA_CPU === "1" ? "-cpu" : ""}${variant === "default" ? "" : `-${variant}`}`;
        const gateStats = { calls: 0, skipped: 0, candidates: 0, lexicalOnly: 0, embedLoadMs: 0 };
        if (process.env.GAUNTLET_GATE === "1") {
          variant = variant === "default" ? "gate" : `${variant}-gate`;
          const { embed, loadMs } = await loadEmbedder();
          gateStats.embedLoadMs = loadMs;
          const lexEnv = process.env.GAUNTLET_LEX_LOW;
          const th: GateThresholds = { ...DEFAULT_GATE, low: Number(process.env.GAUNTLET_GATE_LOW || DEFAULT_GATE.low), lexicalLow: lexEnv === "off" ? Infinity : Number(lexEnv || DEFAULT_GATE.lexicalLow), narrow: process.env.GAUNTLET_GATE_NARROW !== "0" };
          const pv = await embedPoints(embed, parseScript(corpus.script).sections.flatMap((sec) => sec.bullets), corpus.language);
          decide = gatedDecide(PROVIDERS[provider], embed, () => pv, th, (o) => {
            gateStats.calls++;
            if (o.skipped) gateStats.skipped++;
            else gateStats.candidates += o.candidates.length;
            gateStats.lexicalOnly += o.lexicalOnly;
          });
        }
        const r = await replay(corpus, { decide, engine });
        const out = { provider, variant, engine, gate: process.env.GAUNTLET_GATE === "1" ? gateStats : undefined, machine: { cpu: os.cpus()[0]?.model, ramGb: Math.round(os.totalmem() / 1024 ** 3), platform: process.platform }, at: new Date().toISOString(), ...r };
        fs.writeFileSync(path.join(RESULTS_DIR, `${provider}-${corpus.name}${variant === "default" ? "" : `-${variant}`}.json`), JSON.stringify(out, null, 2));
        lines.push(line(r, `${provider}${variant === "default" ? "" : `/${variant}`}`) + (process.env.GAUNTLET_GATE === "1" ? `  gate: ${gateStats.skipped}/${gateStats.calls} model calls skipped, ${gateStats.candidates} candidates asked (${gateStats.lexicalOnly} by the lexical stage only)` : ""));
      }
    }
    console.log("\n" + lines.join("\n") + "\n");
  }, 600_000);
});
