import { computeScorerDigest, computeSourceDigest, readGitInfo, sha256Hex } from "./loader";
import type {
  ArmResult,
  ArmSummary,
  BucketCounts,
  CaseArmResult,
  CaseComparison,
  FrozenDataset,
  HeldFixEvaluation,
  HeldFixId,
  NamedRegression,
  Scorecard,
} from "./types";
import { scoreCase } from "./replay";
import { HELD_FIX_IDS } from "./types";

const HEX40 = /^[0-9a-f]{40}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

function emptyBucket(): BucketCounts {
  return {
    passed: 0,
    total: 0,
    falseTicks: 0,
    finalsTotal: 0,
    misses: 0,
    expectedTicksTotal: 0,
    sectionMoves: {
      allowedObserved: 0,
      allowedExpected: 0,
      prohibited: 0,
      missed: 0,
      voiceMoves: 0,
    },
  };
}

function addCaseToBucket(bucket: BucketCounts, c: CaseArmResult): void {
  bucket.total += 1;
  if (c.pass) bucket.passed += 1;
  bucket.falseTicks += c.falseTicks;
  bucket.finalsTotal += c.finals.length;
  bucket.misses += c.misses;
  bucket.expectedTicksTotal += c.finals.reduce((acc, f) => acc + f.expected.ticked.length, 0);
  bucket.sectionMoves.allowedObserved += c.sectionMoves.allowedObserved;
  bucket.sectionMoves.allowedExpected += c.sectionMoves.allowedExpected;
  bucket.sectionMoves.prohibited += c.sectionMoves.prohibited;
  bucket.sectionMoves.missed += c.sectionMoves.missed;
  bucket.sectionMoves.voiceMoves += c.sectionMoves.voiceMoves;
}

function summarizeArm(arm: ArmResult, orderedIds: string[]): ArmSummary {
  const byId = new Map(arm.cases.map((c) => [c.id, c]));
  const total = emptyBucket();
  const byLanguage: Record<string, BucketCounts> = {};
  const byDefect: Record<string, BucketCounts> = {};
  const byKind: Record<string, BucketCounts> = {};
  const byLanguageAndDefect: Record<string, Record<string, BucketCounts>> = {};

  for (const id of orderedIds) {
    const c = byId.get(id)!;
    addCaseToBucket(total, c);

    byLanguage[c.language] ??= emptyBucket();
    addCaseToBucket(byLanguage[c.language], c);

    byDefect[c.defect] ??= emptyBucket();
    addCaseToBucket(byDefect[c.defect], c);

    byKind[c.kind] ??= emptyBucket();
    addCaseToBucket(byKind[c.kind], c);

    byLanguageAndDefect[c.language] ??= {};
    byLanguageAndDefect[c.language][c.defect] ??= emptyBucket();
    addCaseToBucket(byLanguageAndDefect[c.language][c.defect], c);
  }

  return {
    armName: arm.armName,
    stages: arm.stages,
    embedder: arm.embedder,
    embeddingCalls: arm.embeddingCalls,
    total,
    byLanguage,
    byDefect,
    byKind,
    byLanguageAndDefect,
  };
}

function validateArmAgainstDataset(arm: ArmResult, label: "base" | "candidate", dataset: FrozenDataset): Map<string, CaseArmResult> {
  if (arm.manifestHash.toLowerCase() !== dataset.manifestSha256.toLowerCase()) {
    throw new Error(
      `Manifest hash mismatch in ${label} arm: expected ${dataset.manifestSha256}, got ${arm.manifestHash}`,
    );
  }
  if (arm.casesHash.toLowerCase() !== dataset.casesSha256.toLowerCase()) {
    throw new Error(
      `Cases hash mismatch in ${label} arm: expected ${dataset.casesSha256}, got ${arm.casesHash}`,
    );
  }
  if (arm.schemaVersion !== "x12-arm-v2") throw new Error("Unsupported arm receipt: replay both arms");
  if (arm.gitDirty !== false) throw new Error(`Dirty ${label} arm`);
  if (arm.scorerDigest !== computeScorerDigest()) throw new Error(`Scorer digest mismatch in ${label} arm`);
  if (arm.split !== dataset.split) throw new Error(`Split mismatch in ${label} arm`);
  if (arm.talksHashes.en !== dataset.talksHashes.en || arm.talksHashes.it !== dataset.talksHashes.it) {
    throw new Error(`Talks hash mismatch in ${label} arm`);
  }
  if (!HEX40.test(arm.gitSha)) {
    throw new Error(`Invalid git SHA in ${label} arm: ${arm.gitSha}`);
  }
  if (!HEX64.test(arm.sourceDigest)) {
    throw new Error(`Invalid source digest in ${label} arm: ${arm.sourceDigest}`);
  }

  const expectedIds = new Set(dataset.cases.map((c) => c.id));
  const byId = new Map<string, CaseArmResult>();
  for (const c of arm.cases) {
    if (byId.has(c.id)) {
      throw new Error(`Duplicate case ID in ${label} arm: ${c.id}`);
    }
    if (!expectedIds.has(c.id)) {
      throw new Error(`Unexpected case ID in ${label} arm: ${c.id}`);
    }
    byId.set(c.id, c);
  }

  const missing = dataset.cases.map((c) => c.id).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing case IDs in ${label} arm (${missing.length}): ${missing.slice(0, 5).join(", ")}`);
  }

  for (const frozen of dataset.cases) {
    const finals = byId.get(frozen.id)!.finals;
    const events = frozen.events.filter(event => event.type === "final");
    if (finals.some((f, i) => f.finalIndex !== i || f.text !== events[i]?.text)) {
      throw new Error(`Final identity mismatch on case ${frozen.id}`);
    }
    for (const { observed } of finals) {
      if (!observed || !Array.isArray(observed.ticked) ||
          !observed.ticked.every(id => typeof id === "string") ||
          new Set(observed.ticked).size !== observed.ticked.length ||
          typeof observed.sectionMoveAllowed !== "boolean" ||
          ![observed.currentPoint, observed.voiceMoveTo, observed.sectionId].every(
            value => value === null || typeof value === "string")) {
        throw new Error(`Invalid observed state on case ${frozen.id}`);
      }
    }
    byId.set(frozen.id, scoreCase(frozen, finals.map(f => f.observed)));
  }
  return byId;
}

function verifyFreshness(
  arm: ArmResult,
  label: "base" | "candidate",
  opts: { root?: string; expectedGitSha?: string; expectedSourceDigest?: string },
): void {
  const root = opts.root ?? arm.armRoot;
  if (!root) throw new Error(`Missing ${label} arm source root`);
  const liveGit = readGitInfo(root);
  const expectedSha = liveGit.gitSha;
  const expectedSource = computeSourceDigest(root).sourceDigest;
  if (liveGit.gitDirty) throw new Error(`Dirty live ${label} source`);
  if ((opts.expectedGitSha && opts.expectedGitSha.toLowerCase() !== expectedSha) ||
      (opts.expectedSourceDigest && opts.expectedSourceDigest.toLowerCase() !== expectedSource)) {
    throw new Error(`Stale ${label} digest: expected checkout differs from live source`);
  }
  if (expectedSha && arm.gitSha.toLowerCase() !== expectedSha) {
    throw new Error(
      `Stale ${label} digest (git SHA mismatch): arm recorded ${arm.gitSha}, live/expected is ${expectedSha}`,
    );
  }
  if (expectedSource && arm.sourceDigest.toLowerCase() !== expectedSource) {
    throw new Error(
      `Stale ${label} digest (source digest mismatch): arm recorded ${arm.sourceDigest}, live/expected is ${expectedSource}`,
    );
  }
}

function observedChanged(a: CaseArmResult, b: CaseArmResult): boolean {
  if (a.finals.length !== b.finals.length) return true;
  for (let i = 0; i < a.finals.length; i++) {
    const oa = a.finals[i].observed;
    const ob = b.finals[i].observed;
    if (
      oa.currentPoint !== ob.currentPoint ||
      oa.sectionMoveAllowed !== ob.sectionMoveAllowed ||
      oa.voiceMoveTo !== ob.voiceMoveTo ||
      oa.sectionId !== ob.sectionId ||
      oa.ticked.length !== ob.ticked.length ||
      oa.ticked.some((t, idx) => t !== ob.ticked[idx])
    ) {
      return true;
    }
  }
  return false;
}

export type CompareArmsOptions = {
  dataset: FrozenDataset;
  base: ArmResult;
  candidate: ArmResult;
  baseRoot?: string;
  candidateRoot?: string;
  expectedBaseGitSha?: string;
  expectedBaseSourceDigest?: string;
  expectedCandidateGitSha?: string;
  expectedCandidateSourceDigest?: string;

};

export function compareArms(opts: CompareArmsOptions): Scorecard {
  const baseById = validateArmAgainstDataset(opts.base, "base", opts.dataset);
  const candById = validateArmAgainstDataset(opts.candidate, "candidate", opts.dataset);

  verifyFreshness(opts.base, "base", {
    root: opts.baseRoot,
    expectedGitSha: opts.expectedBaseGitSha,
    expectedSourceDigest: opts.expectedBaseSourceDigest,
  });
  verifyFreshness(opts.candidate, "candidate", {
    root: opts.candidateRoot,
    expectedGitSha: opts.expectedCandidateGitSha,
    expectedSourceDigest: opts.expectedCandidateSourceDigest,
  });

  if (JSON.stringify(opts.base.stages) !== JSON.stringify(opts.candidate.stages) ||
      JSON.stringify(opts.base.embedder) !== JSON.stringify(opts.candidate.embedder)) {
    throw new Error("Matcher stages or embedding model revisions differ across arms");
  }
  const orderedIds = opts.dataset.cases.map((c) => c.id);
  const baseSummary = summarizeArm({ ...opts.base, cases: [...baseById.values()] }, orderedIds);
  const candSummary = summarizeArm({ ...opts.candidate, cases: [...candById.values()] }, orderedIds);

  const cases: CaseComparison[] = [];
  const improvedIds: string[] = [];
  const regressedIds: string[] = [];
  const changedIds: string[] = [];
  const namedRegressions: NamedRegression[] = [];

  for (const frozen of opts.dataset.cases) {
    const b = baseById.get(frozen.id)!;
    const c = candById.get(frozen.id)!;

    if (b.finals.length !== c.finals.length) {
      throw new Error(`Final count mismatch on case ${frozen.id}: base=${b.finals.length}, candidate=${c.finals.length}`);
    }

    const newFalseTicks: string[] = [];
    const newMisses: string[] = [];
    let newProhibitedSectionMoves = 0;

    for (let i = 0; i < b.finals.length; i++) {
      const bf = b.finals[i];
      const cf = c.finals[i];
      const baseFalse = new Set(bf.falseTicks);
      const baseMiss = new Set(bf.misses);
      for (const ft of cf.falseTicks) {
        if (!baseFalse.has(ft)) newFalseTicks.push(`f${i}:${ft}`);
      }
      for (const m of cf.misses) {
        if (!baseMiss.has(m)) newMisses.push(`f${i}:${m}`);
      }
      if (cf.prohibitedSectionMove && !bf.prohibitedSectionMove) {
        newProhibitedSectionMoves += 1;
      }
    }

    const flip: CaseComparison["flip"] =
      !b.pass && c.pass
        ? "improved"
        : b.pass && !c.pass
          ? "regressed"
          : b.pass && c.pass
            ? "same-pass"
            : "same-fail";

    const stateChanged = observedChanged(b, c);
    if (flip === "improved") improvedIds.push(frozen.id);
    if (flip === "regressed") regressedIds.push(frozen.id);
    if (stateChanged) changedIds.push(frozen.id);

    const regressionReasons: string[] = [];
    if (flip === "regressed") regressionReasons.push("case-regressed");
    if (newFalseTicks.length > 0) regressionReasons.push("new-false-tick");
    if (newProhibitedSectionMoves > 0) regressionReasons.push("new-prohibited-section-move");
    if (newMisses.length > 0) regressionReasons.push("new-miss");

    if (c.finals.some((f, i) => f.currentPointMismatch && !b.finals[i].currentPointMismatch)) {
      regressionReasons.push("new-current-point-mismatch");
    }
    if (c.finals.some((f, i) => f.missedSectionMove && !b.finals[i].missedSectionMove)) {
      regressionReasons.push("new-missed-section-move");
    }
    const namedRegression = regressionReasons.length > 0;
    if (namedRegression) {
      namedRegressions.push({
        caseId: frozen.id,
        language: frozen.language,
        defect: frozen.defect,
        kind: frozen.kind,
        reasons: regressionReasons,
      });
    }

    cases.push({
      id: frozen.id,
      talk: frozen.talk,
      language: frozen.language,
      defect: frozen.defect,
      kind: frozen.kind,
      startSection: frozen.startSection,
      base: b,
      candidate: c,
      flip,
      stateChanged,
      newFalseTicks,
      newProhibitedSectionMoves,
      newMisses,
      namedRegression,
      regressionReasons,
    });
  }

  const candidateFixes = new Set<HeldFixId>(opts.candidate.includedFixes ?? []);
  const heldFixes = {} as Record<HeldFixId, HeldFixEvaluation>;
  const languages = Object.keys(baseSummary.byLanguage).sort();
  const baseControl = baseSummary.byKind.control;
  const candControl = candSummary.byKind.control;

  for (const fix of HELD_FIX_IDS) {
    if (!candidateFixes.has(fix)) {
      heldFixes[fix] = {
        fix,
        status: "not yet in review",
        reasons: [],
      };
      continue;
    }

    const targetBase = baseSummary.byDefect[fix] ?? emptyBucket();
    const targetCand = candSummary.byDefect[fix] ?? emptyBucket();
    const reasons: string[] = [];

    if (targetBase.total === 0) {
      reasons.push(`no target cases for ${fix} in ${opts.dataset.split} split`);
    } else if (targetCand.passed <= targetBase.passed) {
      reasons.push(`no net improvement on ${fix} (${targetBase.passed}/${targetBase.total} -> ${targetCand.passed}/${targetCand.total})`);
    }

    for (const lang of languages) {
      const bLang = baseSummary.byLanguage[lang] ?? emptyBucket();
      const cLang = candSummary.byLanguage[lang] ?? emptyBucket();
      if (cLang.passed < bLang.passed) {
        reasons.push(`language loss in ${lang} (${bLang.passed}/${bLang.total} -> ${cLang.passed}/${cLang.total})`);
      }
    }

    const totalNewFalseTicks = cases.reduce((acc, c) => acc + c.newFalseTicks.length, 0);
    if (totalNewFalseTicks > 0 || candSummary.total.falseTicks > baseSummary.total.falseTicks) {
      reasons.push(`new prohibited tick(s): +${totalNewFalseTicks} (total ${baseSummary.total.falseTicks} -> ${candSummary.total.falseTicks})`);
    }

    const totalNewProhibitedMoves = cases.reduce((acc, c) => acc + c.newProhibitedSectionMoves, 0);
    if (
      totalNewProhibitedMoves > 0 ||
      candSummary.total.sectionMoves.prohibited > baseSummary.total.sectionMoves.prohibited
    ) {
      reasons.push(
        `new prohibited section move(s): +${totalNewProhibitedMoves} (total ${baseSummary.total.sectionMoves.prohibited} -> ${candSummary.total.sectionMoves.prohibited})`,
      );
    }

    if (namedRegressions.length > 0) {
      reasons.push(`named regressions (${namedRegressions.length}): ${namedRegressions.map((r) => r.caseId).join(", ")}`);
    }

    if (candControl && candControl.passed < candControl.total) {
      reasons.push(
        `ordinary controls not all passing (${candControl.passed}/${candControl.total}; base ${baseControl?.passed ?? 0}/${baseControl?.total ?? 0})`,
      );
    }

    heldFixes[fix] = {
      fix,
      status: reasons.length === 0 ? "PASS" : "HOLD",
      reasons,
      targetBase: { passed: targetBase.passed, total: targetBase.total },
      targetCandidate: { passed: targetCand.passed, total: targetCand.total },
    };
  }

  const scorerSha256 = computeScorerDigest();
  const payloadWithoutComparisonHash = {
    manifestPinOverridden: opts.dataset.manifestPinOverridden,
    controlRegressions: namedRegressions.filter(r => r.kind === "control").map(r => r.caseId),
    schemaVersion: "x12-scorecard-v1" as const,
    datasetVersion: opts.dataset.version,
    split: opts.dataset.split,
    digests: {
      manifestSha256: opts.dataset.manifestSha256,
      casesSha256: opts.dataset.casesSha256,
      scorerSha256,
      baseGitSha: opts.base.gitSha.toLowerCase(),
      baseSourceSha256: opts.base.sourceDigest.toLowerCase(),
      candidateGitSha: opts.candidate.gitSha.toLowerCase(),
      candidateSourceSha256: opts.candidate.sourceDigest.toLowerCase(),
    },
    summary: {
      base: baseSummary,
      candidate: candSummary,
    },
    flips: {
      improvedIds,
      regressedIds,
      changedIds,
    },
    namedRegressions,
    heldFixes,
    cases,
  };

  const comparisonSha256 = sha256Hex(JSON.stringify(payloadWithoutComparisonHash));

  return {
    ...payloadWithoutComparisonHash,
    digests: {
      ...payloadWithoutComparisonHash.digests,
      comparisonSha256,
    },
  };
}

function fmtRatio(n: number, d: number): string {
  return `${n}/${d}`;
}

export function formatScorecardTable(card: Scorecard): string {
  const lines: string[] = [];
  lines.push(`X-12 Speech Scorecard (${card.datasetVersion}, split: ${card.split})`);
  lines.push(`Base:      ${card.summary.base.armName} (${card.digests.baseGitSha.slice(0, 10)}, src ${card.digests.baseSourceSha256.slice(0, 10)})`);
  lines.push(`Candidate: ${card.summary.candidate.armName} (${card.digests.candidateGitSha.slice(0, 10)}, src ${card.digests.candidateSourceSha256.slice(0, 10)})`);
  lines.push(`Manifest:  ${card.digests.manifestSha256.slice(0, 12)} | Scorer: ${card.digests.scorerSha256.slice(0, 12)} | Comparison: ${card.digests.comparisonSha256.slice(0, 12)}`);
  lines.push("");

  if (card.manifestPinOverridden) lines.push("Manifest pin overridden");
  lines.push(`Control regressions: ${card.controlRegressions.join(", ") || "none"}`);
  lines.push("By language:");
  lines.push("lang  | base pass | cand pass | false ticks (b->c) | misses (b->c) | sec moves ok/prohib (b->c)");
  lines.push("------+-----------+-----------+--------------------+---------------+---------------------------");
  for (const lang of Object.keys(card.summary.base.byLanguage).sort()) {
    const b = card.summary.base.byLanguage[lang];
    const c = card.summary.candidate.byLanguage[lang];
    lines.push(
      `${lang.padEnd(5)} | ${fmtRatio(b.passed, b.total).padEnd(9)} | ${fmtRatio(c.passed, c.total).padEnd(9)} | ${`${b.falseTicks}->${c.falseTicks}`.padEnd(18)} | ${`${b.misses}->${c.misses}`.padEnd(13)} | ${b.sectionMoves.allowedObserved}/${b.sectionMoves.prohibited} -> ${c.sectionMoves.allowedObserved}/${c.sectionMoves.prohibited}`,
    );
  }
  const bt = card.summary.base.total;
  const ct = card.summary.candidate.total;
  lines.push(
    `${"total".padEnd(5)} | ${fmtRatio(bt.passed, bt.total).padEnd(9)} | ${fmtRatio(ct.passed, ct.total).padEnd(9)} | ${`${bt.falseTicks}->${ct.falseTicks}`.padEnd(18)} | ${`${bt.misses}->${ct.misses}`.padEnd(13)} | ${bt.sectionMoves.allowedObserved}/${bt.sectionMoves.prohibited} -> ${ct.sectionMoves.allowedObserved}/${ct.sectionMoves.prohibited}`,
  );
  lines.push("");

  lines.push("By defect:");
  lines.push("defect | base pass | cand pass | false ticks (b->c) | misses (b->c)");
  lines.push("-------+-----------+-----------+--------------------+--------------");
  for (const defect of Object.keys(card.summary.base.byDefect).sort()) {
    const b = card.summary.base.byDefect[defect];
    const c = card.summary.candidate.byDefect[defect];
    lines.push(
      `${defect.padEnd(6)} | ${fmtRatio(b.passed, b.total).padEnd(9)} | ${fmtRatio(c.passed, c.total).padEnd(9)} | ${`${b.falseTicks}->${c.falseTicks}`.padEnd(18)} | ${b.misses}->${c.misses}`,
    );
  }
  lines.push("");

  lines.push("By kind:");
  lines.push("kind              | base pass | cand pass | false ticks (b->c) | misses (b->c)");
  lines.push("------------------+-----------+-----------+--------------------+--------------");
  for (const kind of Object.keys(card.summary.base.byKind).sort()) {
    const b = card.summary.base.byKind[kind];
    const c = card.summary.candidate.byKind[kind];
    lines.push(
      `${kind.padEnd(17)} | ${fmtRatio(b.passed, b.total).padEnd(9)} | ${fmtRatio(c.passed, c.total).padEnd(9)} | ${`${b.falseTicks}->${c.falseTicks}`.padEnd(18)} | ${b.misses}->${c.misses}`,
    );
  }
  lines.push("");

  lines.push(`Flips improved (${card.flips.improvedIds.length}): ${card.flips.improvedIds.join(", ") || "none"}`);
  lines.push(`Flips regressed (${card.flips.regressedIds.length}): ${card.flips.regressedIds.join(", ") || "none"}`);
  lines.push(`State changed (${card.flips.changedIds.length}): ${card.flips.changedIds.join(", ") || "none"}`);
  lines.push(
    `Named regressions (${card.namedRegressions.length}): ${
      card.namedRegressions.length
        ? card.namedRegressions.map((r) => `${r.caseId} [${r.reasons.join("+")}]`).join(", ")
        : "none"
    }`,
  );
  lines.push("");

  lines.push("Held fixes:");
  for (const fix of HELD_FIX_IDS) {
    const h = card.heldFixes[fix];
    const suffix = h.reasons.length ? ` (${h.reasons.join("; ")})` : "";
    lines.push(`  ${fix}: ${h.status}${suffix}`);
  }
  lines.push("");

  lines.push("Per case (expected vs observed, final-by-final):");
  lines.push("case       | lang | defect | flip      | expected -> base | cand");
  lines.push("-----------+------+--------+-----------+--------------------------------");
  const fmtFinals = (finals: CaseArmResult["finals"], which: "expected" | "observed") =>
    finals
      .map((f) => {
        const s = which === "expected" ? f.expected : f.observed;
        const pts = s.ticked.length ? s.ticked.join(",") : "-";
        const mv = s.sectionMoveAllowed ? "+move" : "";
        return `[${pts}${mv}]`;
      })
      .join(" ");
  for (const c of card.cases) {
    const exp = fmtFinals(c.base.finals, "expected");
    const baseObs = fmtFinals(c.base.finals, "observed");
    const candObs = fmtFinals(c.candidate.finals, "observed");
    lines.push(
      `${c.id.padEnd(10)} | ${c.language.padEnd(4)} | ${c.defect.padEnd(6)} | ${c.flip.padEnd(9)} | ${exp} -> ${baseObs} | ${candObs}`,
    );
  }

  return lines.join("\n") + "\n";
}
