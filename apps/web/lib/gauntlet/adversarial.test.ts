// Adversarial check of the local decision path (docs/gauntlet/adversarial/cases.json). Opt-in: it
// calls the local model. No paid calls, nothing leaves the PC.
//   GAUNTLET_ADV=1 npx vitest run apps/web/lib/gauntlet/adversarial.test.ts
// Every case is one decide request sent through the production code (decideClefLocal, so the real
// question wording and the 0.7 "started" threshold), then through the claim guard. A point counts as
// ticked when the model says started and the guard agrees: Clef is deterministic, so the engine's
// second confirmation would give the same answer. Writes docs/gauntlet/results/clef-local-adversarial.json
// and prints the false ticks and the misses. This is a measurement, not a gate: the numbers go into
// docs/gauntlet/BASELINE.md and must not get worse.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkClaim, type DecideRequest } from "@filow/core";
import { decideClefLocal, warmClefLocal, CLEF_LOCAL_MODEL } from "@/lib/decide/clef";

const ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(ROOT, "docs", "gauntlet", "adversarial", "cases.json");
const OUT = path.join(ROOT, "docs", "gauntlet", "results", "clef-local-adversarial.json");

type Case = { id: string; set: string; language: string; category: string; section: string; points: { text: string; covered: boolean | null }[]; transcript: string; alreadyCovered?: string[]; upcoming?: string[] };
type Row = { id: string; set: string; language: string; category: string; point: string; said: string; confidence: number; guard: "ok" | string };

describe.skipIf(process.env.GAUNTLET_ADV !== "1")("adversarial cases (local model)", () => {
  it("counts false ticks and misses", async () => {
    const { cases } = JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: Case[] };
    expect(cases.length).toBeGreaterThan(100);
    const warm = await warmClefLocal();
    expect(warm.ok, warm.error).toBe(true);
    const totals: Record<string, { falseTicks: number; expectedNot: number; misses: number; expectedTicks: number }> = {};
    const falseTicks: Row[] = [];
    const misses: Row[] = [];
    for (const c of cases) {
      const req: DecideRequest = {
        transcript: c.transcript,
        bullets: c.points.map((p, i) => ({ id: `${c.id}_p${i}`, text: p.text })),
        sectionTitle: c.section,
        covered: c.alreadyCovered ?? [],
        upcoming: c.upcoming ?? [],
        language: c.language,
      };
      const { decisions } = await decideClefLocal(req, AbortSignal.timeout(300_000));
      const t = (totals[c.set] ??= { falseTicks: 0, expectedNot: 0, misses: 0, expectedTicks: 0 });
      c.points.forEach((p, i) => {
        if (p.covered === null) return;
        const d = decisions.find((x) => x.id === `${c.id}_p${i}`)!;
        const g = checkClaim(p.text, c.transcript);
        const ticked = d.started && g.ok;
        const row: Row = { id: c.id, set: c.set, language: c.language, category: c.category, point: p.text, said: c.transcript, confidence: Math.round(d.confidence * 100) / 100, guard: g.ok ? "ok" : `blocked (${g.conflict?.kind})` };
        if (p.covered) {
          t.expectedTicks++;
          if (!ticked) { t.misses++; misses.push(row); }
        } else {
          t.expectedNot++;
          if (ticked) { t.falseTicks++; falseTicks.push(row); }
        }
      });
    }
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), model: CLEF_LOCAL_MODEL(), totals, falseTicks, misses }, null, 2) + "\n");
    const lines = Object.entries(totals).map(([set, t]) => `${set}: false ticks ${t.falseTicks}/${t.expectedNot}, misses ${t.misses}/${t.expectedTicks}`);
    for (const r of falseTicks) lines.push(`  FALSE TICK ${r.id} [${r.language} ${r.category}] "${r.point}" conf ${r.confidence}`);
    for (const r of misses) lines.push(`  MISS       ${r.id} [${r.language} ${r.category}] "${r.point}" conf ${r.confidence} guard ${r.guard}`);
    console.log("\n" + lines.join("\n") + "\n");
  }, 3_600_000);
});
