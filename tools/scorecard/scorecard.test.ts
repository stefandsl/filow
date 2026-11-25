import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareArms, formatScorecardTable } from "./compare";
import { runCli } from "./cli";
import { computeSourceDigest, loadFrozenDataset } from "./loader";
import { replayArm } from "./replay";
import type { ArmResult, FrozenCase, FrozenDataset, FrozenTalk } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const TMP_ROOT = path.join(REPO_ROOT, "tmp", "scorecard-test");
const createdDirs: string[] = [];

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeTempDir(label: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `${label}-`));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length) {
    const dir = createdDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildSyntheticFixture(): { dir: string; manifestPath: string; casesPath: string; manifestSha256: string } {
  const dir = makeTempDir("fixture");
  const talksEn: { version: string; talks: FrozenTalk[] } = {
    version: "synthetic-v1",
    talks: [
      {
        id: "syn-en",
        language: "en",
        split: "dev",
        title: "Synthetic EN talk",
        sections: [
          {
            id: "syn-en.s1",
            title: "Results",
            points: [
              { id: "syn-en.rev", text: "Revenue grew 18% year on year" },
              { id: "syn-en.churn", text: "Churn fell to 4%" },
            ],
          },
          {
            id: "syn-en.s2",
            title: "Roadmap",
            points: [{ id: "syn-en.price", text: "New pricing starts in March" }],
          },
        ],
        script: [
          "# Results",
          "- Revenue grew 18% year on year",
          "- Churn fell to 4%",
          "",
          "# Roadmap",
          "- New pricing starts in March",
        ].join("\n"),
      },
    ],
  };

  const talksIt: { version: string; talks: FrozenTalk[] } = {
    version: "synthetic-v1",
    talks: [
      {
        id: "syn-it",
        language: "it",
        split: "dev",
        title: "Synthetic IT talk",
        sections: [
          {
            id: "syn-it.s1",
            title: "Risultati",
            points: [
              { id: "syn-it.fatt", text: "Il fatturato è cresciuto del 12%" },
              { id: "syn-it.resi", text: "I resi sono scesi al 3%" },
            ],
          },
          {
            id: "syn-it.s2",
            title: "Prossimi passi",
            points: [{ id: "syn-it.cat", text: "Il nuovo catalogo esce ad aprile" }],
          },
        ],
        script: [
          "# Risultati",
          "- Il fatturato è cresciuto del 12%",
          "- I resi sono scesi al 3%",
          "",
          "# Prossimi passi",
          "- Il nuovo catalogo esce ad aprile",
        ].join("\n"),
      },
    ],
  };

  const cases: FrozenCase[] = [
    {
      id: "en-syn-001",
      talk: "syn-en",
      language: "en",
      split: "dev",
      defect: "none",
      kind: "control",
      startSection: "syn-en.s1",
      rationale: "plain coverage of revenue and churn enables section move",
      events: [
        { type: "partial", text: "revenue grew" },
        {
          type: "final",
          text: "revenue grew 18 percent year on year",
          expect: { currentPoint: "syn-en.rev", ticked: ["syn-en.rev"], sectionMoveAllowed: false },
        },
        {
          type: "final",
          text: "churn fell to 4 percent",
          expect: { currentPoint: "syn-en.churn", ticked: ["syn-en.rev", "syn-en.churn"], sectionMoveAllowed: true },
        },
      ],
    },
    {
      id: "en-syn-002",
      talk: "syn-en",
      language: "en",
      split: "dev",
      defect: "C12",
      kind: "c12-mixed",
      startSection: "syn-en.s1",
      rationale: "churn stated before unpunctuated postponement",
      events: [
        {
          type: "final",
          text: "churn fell to 4 percent and later I'll tell you about pricing",
          expect: { currentPoint: "syn-en.churn", ticked: ["syn-en.churn"], sectionMoveAllowed: false },
        },
      ],
    },
    {
      id: "it-syn-001",
      talk: "syn-it",
      language: "it",
      split: "dev",
      defect: "none",
      kind: "control",
      startSection: "syn-it.s1",
      rationale: "plain Italian coverage",
      events: [
        {
          type: "final",
          text: "il fatturato è cresciuto del 12 per cento",
          expect: { currentPoint: "syn-it.fatt", ticked: ["syn-it.fatt"], sectionMoveAllowed: false },
        },
      ],
    },
    {
      id: "it-syn-002",
      talk: "syn-it",
      language: "it",
      split: "dev",
      defect: "C12",
      kind: "c12-postpone",
      startSection: "syn-it.s1",
      rationale: "resi postponed to the end",
      events: [
        {
          type: "final",
          text: "dei resi vi parlo alla fine",
          expect: { currentPoint: null, ticked: [], sectionMoveAllowed: false },
        },
      ],
    },
  ];

  const talksEnJson = JSON.stringify(talksEn, null, 2);
  const talksItJson = JSON.stringify(talksIt, null, 2);
  const casesDevJson = JSON.stringify({ version: "synthetic-v1", split: "dev", cases }, null, 2);

  fs.writeFileSync(path.join(dir, "talks-en.json"), talksEnJson, "utf8");
  fs.writeFileSync(path.join(dir, "talks-it.json"), talksItJson, "utf8");
  fs.writeFileSync(path.join(dir, "cases-dev.json"), casesDevJson, "utf8");

  const manifest = [
    "# Synthetic EN/IT case set (synthetic-v1)",
    "",
    "## SHA256",
    "",
    "| file | sha256 |",
    "|---|---|",
    `| talks-en.json | ${sha256(talksEnJson)} |`,
    `| talks-it.json | ${sha256(talksItJson)} |`,
    `| cases-dev.json | ${sha256(casesDevJson)} |`,
    "",
  ].join("\n");
  const manifestPath = path.join(dir, "MANIFEST.md");
  fs.writeFileSync(manifestPath, manifest, "utf8");

  return {
    dir,
    manifestPath,
    casesPath: path.join(dir, "cases-dev.json"),
    manifestSha256: sha256(manifest),
  };
}

function loadSyntheticDataset(): { fixture: ReturnType<typeof buildSyntheticFixture>; dataset: FrozenDataset } {
  const fixture = buildSyntheticFixture();
  const dataset = loadFrozenDataset({
    casesDir: fixture.dir,
    split: "dev",
    expectedManifestSha256: fixture.manifestSha256,
  });
  return { fixture, dataset };
}

describe("X-12 speech scorecard replay and comparator", () => {
  it("baseline self-comparison reports zero flips, zero regressions, and exit code 0", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });
    const outDir = makeTempDir("self-cmp");
    const basePath = path.join(outDir, "base.json");
    const outPath = path.join(outDir, "scorecard.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");

    const cli = await runCli([
      "compare",
      "--manifest",
      fixture.manifestPath,
      "--manifest-hash",
      fixture.manifestSha256,
      "--cases",
      fixture.casesPath,
      "--base",
      basePath,
      "--candidate",
      basePath,
      "--candidate-root",
      REPO_ROOT,
      "--out",
      outPath,
    ]);

    expect(cli.exitCode).toBe(0);
    const card = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(card.flips.improvedIds).toEqual([]);
    expect(card.flips.regressedIds).toEqual([]);
    expect(card.flips.changedIds).toEqual([]);
    expect(card.namedRegressions).toEqual([]);
    expect(card.heldFixes.C6.status).toBe("not yet in review");
    expect(card.heldFixes.C12.status).toBe("not yet in review");
    expect(card.heldFixes.C23.status).toBe("not yet in review");
    expect(card.heldFixes.C27.status).toBe("not yet in review");
    expect(card.heldFixes.C28.status).toBe("not yet in review");
    const table = formatScorecardTable(card);
    expect(table).toContain("C12");
    expect(table).toContain("en-syn-001");
    expect(table).toContain("it-syn-002");
  });

  it("replays spoken section navigation through production spokenSection and Engine", async () => {
    const { dataset } = loadSyntheticDataset();
    const navCase: FrozenCase = {
      id: "en-syn-nav",
      talk: "syn-en",
      language: "en",
      split: "dev",
      defect: "C23",
      kind: "nav-check",
      startSection: "syn-en.s1",
      rationale: "explicit spoken announcement moves to Roadmap section",
      events: [
        {
          type: "final",
          text: "now let's move to roadmap",
          expect: { currentPoint: null, ticked: [], sectionMoveAllowed: false },
        },
      ],
    };
    const navDataset: FrozenDataset = { ...dataset, cases: [...dataset.cases, navCase] };
    const arm = await replayArm({ dataset: navDataset, armRoot: REPO_ROOT, armName: "nav-base" });
    const navResult = arm.cases.find((c) => c.id === "en-syn-nav")!;
    expect(navResult.finals[0].observed.voiceMoveTo).toBe("syn-en.s2");
    expect(navResult.finals[0].observed.sectionMoveAllowed).toBe(true);
    expect(navResult.finals[0].prohibitedSectionMove).toBe(true);
    expect(navResult.sectionMoves.voiceMoves).toBe(1);
  });

  it("an injected forbidden tick plus a compensating fix gives a named regression and non-zero exit even with flat total accuracy", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });

    // Confirm base fails en-syn-002 (unpunctuated 'later' drops the whole final on origin/main)
    // and passes it-syn-002 (postponement does not tick).
    const baseEnC12 = base.cases.find((c) => c.id === "en-syn-002")!;
    const baseItPostpone = base.cases.find((c) => c.id === "it-syn-002")!;
    expect(baseEnC12.pass).toBe(false);
    expect(baseItPostpone.pass).toBe(true);

    // Candidate fixes en-syn-002 (+1 pass) while injecting a forbidden tick on it-syn-002 (-1 pass),
    // keeping total accuracy flat.
    const candidate: ArmResult = structuredClone(base);
    candidate.armName = "candidate-c12-injected";
    candidate.includedFixes = ["C12"];

    const candEn = candidate.cases.find((c) => c.id === "en-syn-002")!;
    candEn.finals[0].observed = {
      currentPoint: "syn-en.churn",
      ticked: ["syn-en.churn"],
      sectionMoveAllowed: false,
      sectionId: "syn-en.s1",
      voiceMoveTo: null,
    };
    candEn.finals[0].misses = [];
    candEn.finals[0].falseTicks = [];
    candEn.finals[0].currentPointMismatch = false;
    candEn.finals[0].pass = true;
    candEn.misses = 0;
    candEn.pass = true;

    const candIt = candidate.cases.find((c) => c.id === "it-syn-002")!;
    candIt.finals[0].observed = {
      currentPoint: "syn-it.resi",
      ticked: ["syn-it.resi"],
      sectionMoveAllowed: false,
      sectionId: "syn-it.s1",
      voiceMoveTo: null,
    };
    candIt.finals[0].falseTicks = ["syn-it.resi"];
    candIt.finals[0].currentPointMismatch = true;
    candIt.finals[0].pass = false;
    candIt.falseTicks = 1;
    candIt.pass = false;

    const outDir = makeTempDir("injected");
    const basePath = path.join(outDir, "base.json");
    const candPath = path.join(outDir, "cand.json");
    const outPath = path.join(outDir, "scorecard.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");
    fs.writeFileSync(candPath, JSON.stringify(candidate, null, 2), "utf8");

    const cli = await runCli([
      "compare",
      "--manifest",
      fixture.manifestPath,
      "--manifest-hash",
      fixture.manifestSha256,
      "--cases",
      fixture.casesPath,
      "--base",
      basePath,
      "--candidate",
      candPath,
      "--out",
      outPath,
    ]);

    expect(cli.exitCode).toBe(1);
    const card = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(card.summary.candidate.total.passed).toBe(card.summary.base.total.passed);
    expect(card.flips.improvedIds).toEqual(["en-syn-002"]);
    expect(card.flips.regressedIds).toEqual(["it-syn-002"]);
    expect(card.namedRegressions.some((r: { caseId: string; reasons: string[] }) =>
      r.caseId === "it-syn-002" && r.reasons.includes("new-false-tick"))).toBe(true);
    expect(card.heldFixes.C12.status).toBe("HOLD");
  });

  it("rejects missing case IDs in either arm", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });
    const incomplete: ArmResult = structuredClone(base);
    incomplete.cases = incomplete.cases.filter((c) => c.id !== "it-syn-002");

    expect(() => compareArms({ dataset, base, candidate: incomplete })).toThrow(/missing case/i);

    const outDir = makeTempDir("missing-id");
    const basePath = path.join(outDir, "base.json");
    const candPath = path.join(outDir, "cand.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");
    fs.writeFileSync(candPath, JSON.stringify(incomplete, null, 2), "utf8");

    const cli = await runCli([
      "compare",
      "--manifest",
      fixture.manifestPath,
      "--manifest-hash",
      fixture.manifestSha256,
      "--cases",
      fixture.casesPath,
      "--base",
      basePath,
      "--candidate",
      candPath,
    ]);
    expect(cli.exitCode).toBe(2);
    expect(cli.stderr).toMatch(/missing case/i);
  });

  it("rejects manifest hash mismatch", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });
    const outDir = makeTempDir("bad-manifest");
    const basePath = path.join(outDir, "base.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");

    const cli = await runCli([
      "compare",
      "--manifest",
      fixture.manifestPath,
      "--manifest-hash",
      "0".repeat(64),
      "--cases",
      fixture.casesPath,
      "--base",
      basePath,
      "--candidate",
      basePath,
    ]);
    expect(cli.exitCode).toBe(2);
    expect(cli.stderr).toMatch(/manifest hash mismatch/i);
  });

  it("rejects stale candidate digests (both source digest and git SHA)", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });
    const staleSource: ArmResult = structuredClone(base);
    staleSource.sourceDigest = "f".repeat(64);

    const live = computeSourceDigest(REPO_ROOT);
    expect(() =>
      compareArms({
        dataset,
        base,
        candidate: staleSource,
        expectedCandidateSourceDigest: live.sourceDigest,
        expectedCandidateGitSha: base.gitSha,
      }),
    ).toThrow(/stale candidate/i);

    const staleSha: ArmResult = structuredClone(base);
    staleSha.gitSha = "a".repeat(40);
    expect(() =>
      compareArms({
        dataset,
        base,
        candidate: staleSha,
        expectedCandidateSourceDigest: live.sourceDigest,
        expectedCandidateGitSha: base.gitSha,
      }),
    ).toThrow(/stale candidate/i);

    const outDir = makeTempDir("stale");
    const basePath = path.join(outDir, "base.json");
    const candPath = path.join(outDir, "cand.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");
    fs.writeFileSync(candPath, JSON.stringify(staleSource, null, 2), "utf8");

    const cli = await runCli([
      "compare",
      "--manifest",
      fixture.manifestPath,
      "--manifest-hash",
      fixture.manifestSha256,
      "--cases",
      fixture.casesPath,
      "--base",
      basePath,
      "--candidate",
      candPath,
      "--candidate-root",
      REPO_ROOT,
    ]);
    expect(cli.exitCode).toBe(2);
    expect(cli.stderr).toMatch(/stale candidate/i);
  });

  it("advances a fix only with target improvement, no language loss, no new prohibited tick or section move, and passing ordinary controls", async () => {
    const { dataset } = loadSyntheticDataset();
    const base = await replayArm({ dataset, armRoot: REPO_ROOT, armName: "base" });

    // Clean improvement on C12 with no loss and passing controls -> PASS
    const good: ArmResult = structuredClone(base);
    good.armName = "candidate-good";
    good.includedFixes = ["C12"];
    const goodEn = good.cases.find((c) => c.id === "en-syn-002")!;
    goodEn.finals[0].observed = {
      currentPoint: "syn-en.churn",
      ticked: ["syn-en.churn"],
      sectionMoveAllowed: false,
      sectionId: "syn-en.s1",
      voiceMoveTo: null,
    };
    goodEn.finals[0].misses = [];
    goodEn.finals[0].currentPointMismatch = false;
    goodEn.finals[0].pass = true;
    goodEn.misses = 0;
    goodEn.pass = true;

    const passCard = compareArms({ dataset, base, candidate: good });
    expect(passCard.namedRegressions).toEqual([]);
    expect(passCard.heldFixes.C12.status).toBe("PASS");
    expect(passCard.heldFixes.C6.status).toBe("not yet in review");

    // Prohibited section move injected alongside target improvement -> named regression + HOLD
    const badMove: ArmResult = structuredClone(good);
    const badIt = badMove.cases.find((c) => c.id === "it-syn-002")!;
    badIt.finals[0].observed.sectionMoveAllowed = true;
    badIt.finals[0].observed.voiceMoveTo = "syn-it.s2";
    badIt.finals[0].prohibitedSectionMove = true;
    badIt.finals[0].pass = false;
    badIt.sectionMoves.prohibited = 1;
    badIt.sectionMoves.voiceMoves = 1;
    badIt.pass = false;

    const holdCard = compareArms({ dataset, base, candidate: badMove });
    expect(holdCard.namedRegressions.some((r) => r.caseId === "it-syn-002" && r.reasons.includes("new-prohibited-section-move"))).toBe(true);
    expect(holdCard.heldFixes.C12.status).toBe("HOLD");
  });
});
