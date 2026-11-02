// Gauntlet runner (docs/local-latency-gauntlet.md, Round 0). Opt-in: it calls real models.
//   GAUNTLET=1 GAUNTLET_PROVIDERS=openrouter,clef-local npx vitest run apps/web/lib/gauntlet
// Reads every corpus under docs/gauntlet/corpus/<name>/ (script.md, transcript.json, labels.json),
// replays it through the Engine with each provider, prints a table and writes
// docs/gauntlet/results/<provider>-<corpus>.json. Keys come from the desktop profile's .env
// (%APPDATA%/@filow/desktop/.env) when the shell has none.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { replay, type Corpus, type ReplayResult } from "@filow/core";
import { decideOpenRouter } from "@/lib/decide/openrouter";
import { decideClefLocal } from "@/lib/decide/clef";

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
  return `${provider.padEnd(12)} ${r.corpus.padEnd(10)} calls ${String(r.calls).padStart(3)}  p50 ${String(r.latencyMs.p50).padStart(5)} ms  p95 ${String(r.latencyMs.p95).padStart(5)} ms  timeouts ${r.timeouts}  correct ${r.correct}  false ${r.falseStarts}  miss ${r.misses}  precision ${r.precision ?? "-"}  recall ${r.recall ?? "-"}  delay p50 ${r.delaySec.p50 ?? "-"} s`;
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
      for (const corpus of corpora) {
        const r = await replay(corpus, { decide: PROVIDERS[provider], engine: { timeoutMs: Number(process.env.GAUNTLET_TIMEOUT_MS || 2500) } });
        const out = { provider, machine: { cpu: os.cpus()[0]?.model, ramGb: Math.round(os.totalmem() / 1024 ** 3), platform: process.platform }, at: new Date().toISOString(), ...r };
        fs.writeFileSync(path.join(RESULTS_DIR, `${provider}-${corpus.name}.json`), JSON.stringify(out, null, 2));
        lines.push(line(r, provider));
      }
    }
    // eslint-disable-next-line no-console
    console.log("\n" + lines.join("\n") + "\n");
  }, 600_000);
});
