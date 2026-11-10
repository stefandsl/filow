// Adversarial check of the local decision path. Opt-in: it calls the local model. No paid calls,
// nothing leaves the PC.
//   GAUNTLET_ADV=1 npx vitest run apps/web/lib/gauntlet/adversarial.test.ts
// Case files (docs/gauntlet/adversarial/): cases.json (written to break the question wording and the
// guard) and cases-verify.json (written later, by an author who had not seen the verification step,
// to test it). Every case is one decide request sent through the production code (decideClefLocal:
// the real wording and the 0.7 "started" threshold), then through the claim guard, then, as the
// engine does for a point that is ready to tick, through a second call that verifies it.
// A point counts as ticked when the model says started, the guard agrees and the verification
// passes. Clef is deterministic, so the engine's second confirmation gives the same answer.
// Writes docs/gauntlet/results/clef-local-<file>.json with the numbers before and after the
// verification and every failure. A measurement, not a gate: the numbers go into
// docs/gauntlet/BASELINE.md and must not get worse.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkClaim, type DecideRequest, type Verification } from "@filow/core";
import { decideClefLocal, warmClefLocal, CLEF_LOCAL_MODEL } from "@/lib/decide/clef";

const ROOT = path.resolve(__dirname, "../../../..");
const DIR = path.join(ROOT, "docs", "gauntlet", "adversarial");
const RESULTS = path.join(ROOT, "docs", "gauntlet", "results");
/** The engine's defaults (EngineOptions.verifyThreshold). */
const PASS = { real: Number(process.env.GAUNTLET_VERIFY_REAL ?? 0.65), sameParty: Number(process.env.GAUNTLET_VERIFY_PARTY ?? 0.5) };

type Case = { id: string; set: string; language: string; category: string; section: string; points: { text: string; covered: boolean | null }[]; transcript: string; alreadyCovered?: string[]; upcoming?: string[] };
type Row = { id: string; set: string; language: string; category: string; point: string; said: string; expected: boolean; confidence: number; guard: string; verification: Verification | null; ticked: boolean; tickedWithoutVerification: boolean };
type Totals = { falseTicks: number; expectedNot: number; misses: number; expectedTicks: number };

describe.skipIf(process.env.GAUNTLET_ADV !== "1")("adversarial cases (local model)", () => {
  const files = fs.readdirSync(DIR).filter((f) => /^cases.*\.json$/.test(f)).sort();
  it.each(files)("%s: false ticks and misses, before and after the verification", async (file) => {
    const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as { cases: Case[] };
    expect(cases.length).toBeGreaterThan(50);
    const warm = await warmClefLocal();
    expect(warm.ok, warm.error).toBe(true);
    const rows: Row[] = [];
    for (const c of cases) {
      const req: DecideRequest = {
        transcript: c.transcript,
        bullets: c.points.map((p, i) => ({ id: `${c.id}_p${i}`, text: p.text })),
        sectionTitle: c.section,
        covered: c.alreadyCovered ?? [],
        upcoming: c.upcoming ?? [],
        language: c.language,
      };
      const first = await decideClefLocal(req, AbortSignal.timeout(300_000));
      const ready = c.points.map((p, i) => {
        const d = first.decisions.find((x) => x.id === `${c.id}_p${i}`)!;
        const g = checkClaim(p.text, c.transcript);
        return { p, id: d.id, d, g, ready: d.started && g.ok };
      });
      // The engine asks again with `verify` for the points that are ready to tick.
      const verify = ready.filter((r) => r.ready).map((r) => r.id);
      const second = verify.length ? await decideClefLocal({ ...req, verify }, AbortSignal.timeout(300_000)) : null;
      for (const r of ready) {
        if (r.p.covered === null) continue;
        const again = second?.decisions.find((x) => x.id === r.id);
        const v = again?.verification ?? null;
        const stillReady = r.ready && Boolean(again?.started);
        const ticked = stillReady && v !== null && v.real >= PASS.real && v.sameParty >= PASS.sameParty;
        rows.push({ id: c.id, set: c.set, language: c.language, category: c.category, point: r.p.text, said: c.transcript, expected: r.p.covered, confidence: Math.round(r.d.confidence * 100) / 100, guard: r.g.ok ? "ok" : `blocked (${r.g.conflict?.kind})`, verification: v && { real: Math.round(v.real * 100) / 100, sameParty: Math.round(v.sameParty * 100) / 100 }, ticked, tickedWithoutVerification: r.ready });
      }
    }
    const tally = (ticked: (r: Row) => boolean) => {
      const t: Record<string, Totals> = {};
      for (const r of rows) {
        const k = (t[r.set] ??= { falseTicks: 0, expectedNot: 0, misses: 0, expectedTicks: 0 });
        if (r.expected) { k.expectedTicks++; if (!ticked(r)) k.misses++; }
        else { k.expectedNot++; if (ticked(r)) k.falseTicks++; }
      }
      return t;
    };
    const before = tally((r) => r.tickedWithoutVerification);
    const after = tally((r) => r.ticked);
    const out = {
      at: new Date().toISOString(), model: CLEF_LOCAL_MODEL(), pass: PASS, withoutVerification: before, withVerification: after,
      falseTicks: rows.filter((r) => !r.expected && r.ticked),
      misses: rows.filter((r) => r.expected && !r.ticked),
      vetoed: rows.filter((r) => r.tickedWithoutVerification && !r.ticked),
    };
    fs.writeFileSync(path.join(RESULTS, `clef-local-adversarial${file === "cases.json" ? "" : file.replace(/^cases|\.json$/g, "")}.json`), JSON.stringify(out, null, 2) + "\n");
    fs.mkdirSync(path.join(ROOT, "tmp", "trk2"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "tmp", "trk2", `adv-rows-${file}`), JSON.stringify(rows, null, 1));
    const line = (name: string, t: Record<string, Totals>) => `${name}: ` + Object.entries(t).map(([set, x]) => `${set} false ticks ${x.falseTicks}/${x.expectedNot}, misses ${x.misses}/${x.expectedTicks}`).join("; ");
    console.log(`\n${file}\n${line("without verification", before)}\n${line("with verification   ", after)}\n`);
  }, 3_600_000);
});
