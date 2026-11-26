import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compareArms, formatScorecardTable } from "./compare";
import { runCli } from "./cli";
import { computeSourceDigest, loadFrozenDataset } from "./loader";
import { replayArm } from "./replay";
import type { ArmResult, FrozenCase, FrozenDataset, FrozenTalk } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const TMP_ROOT = path.join(REPO_ROOT, "tmp", "scorecard-test");
const createdDirs: string[] = [];

// Exercise freshness against a clean, disposable production tree, including when
// the developer is running the suite with uncommitted changes in the scorer.
let armRoot: string;
beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  armRoot = fs.mkdtempSync(path.join(TMP_ROOT, "source-"));
  for (const rel of ["packages/core/src", "apps/web/lib/gate/embedder.ts", "package-lock.json"]) {
    fs.cpSync(path.join(REPO_ROOT, rel), path.join(armRoot, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(armRoot, ".gitignore"), "node_modules/\n");
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(armRoot, "node_modules"), "junction");
  const git = (...args: string[]) => execFileSync("git", ["-C", armRoot, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("add", ".gitignore", "apps", "packages", "package-lock.json");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgSign=false", "commit", "-qm", "Synthetic replay arm");
});
afterAll(() => fs.rmSync(armRoot, { recursive: true, force: true }));

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
              { id: "syn-en.bells", text: "Quartz bells ring every morning" },
              { id: "syn-en.lanterns", text: "Copper lanterns shine at dusk" },
            ],
          },
          {
            id: "syn-en.s2",
            title: "Roadmap",
            points: [{ id: "syn-en.ribbons", text: "Silver ribbons mark the trail" }],
          },
        ],
        script: [
          "# Results",
          "- Quartz bells ring every morning",
          "- Copper lanterns shine at dusk",
          "",
          "# Roadmap",
          "- Silver ribbons mark the trail",
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
              { id: "syn-it.campane", text: "Le campane viola suonano a mezzogiorno" },
              { id: "syn-it.lanterne", text: "Le lanterne verdi brillano al tramonto" },
            ],
          },
          {
            id: "syn-it.s2",
            title: "Prossimi passi",
            points: [{ id: "syn-it.nastri", text: "I nastri argentati segnano il sentiero" }],
          },
        ],
        script: [
          "# Risultati",
          "- Le campane viola suonano a mezzogiorno",
          "- Le lanterne verdi brillano al tramonto",
          "",
          "# Prossimi passi",
          "- I nastri argentati segnano il sentiero",
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
      rationale: "plain coverage of bells and lanterns enables section move",
      events: [
        { type: "partial", text: "quartz bells" },
        {
          type: "final",
          text: "quartz bells ring every morning",
          expect: { currentPoint: "syn-en.bells", ticked: ["syn-en.bells"], sectionMoveAllowed: false },
        },
        {
          type: "final",
          text: "copper lanterns shine at dusk",
          expect: { currentPoint: "syn-en.lanterns", ticked: ["syn-en.bells", "syn-en.lanterns"], sectionMoveAllowed: true },
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
      rationale: "lanterns stated before unpunctuated postponement",
      events: [
        {
          type: "final",
          text: "copper lanterns shine at dusk and later I'll tell you about ribbons",
          expect: { currentPoint: "syn-en.lanterns", ticked: ["syn-en.lanterns"], sectionMoveAllowed: false },
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
          text: "le campane viola suonano a mezzogiorno",
          expect: { currentPoint: "syn-it.campane", ticked: ["syn-it.campane"], sectionMoveAllowed: false },
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
      rationale: "lanterns postponed to the end",
      events: [
        {
          type: "final",
          text: "delle lanterne vi parlo alla fine",
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

// Comparator fixtures exercise semantic receipts without loading model weights in CI.
function semanticReceipt(arm: ArmResult, calls: number): ArmResult {
  return { ...arm, stages: ["lexical", "semantic"], embeddingCalls: calls,
    embedder: { model: "fixture-model", revision: "fixture-revision" } };
}

describe("X-12 speech scorecard replay and comparator", () => {
  it("baseline self-comparison reports zero flips, zero regressions, and invalid lexical verdicts even with an exit override", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base", includedFixes: ["C12"] });
    const outDir = makeTempDir("self-cmp");
    const basePath = path.join(outDir, "base.json");
    const outPath = path.join(outDir, "scorecard.json");
    fs.writeFileSync(basePath, JSON.stringify(base, null, 2), "utf8");

    const args = [
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
      "--out",
      outPath,
    ];
    const strict = await runCli(args);
    expect(strict.exitCode).toBe(1);
    const cli = await runCli([...args, "--allow-lexical"]);
    expect(cli.stdout).toBe(strict.stdout);

    expect(cli.exitCode).toBe(0);
    const card = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(card.flips.improvedIds).toEqual([]);
    expect(card.flips.regressedIds).toEqual([]);
    expect(card.flips.changedIds).toEqual([]);
    expect(card.namedRegressions).toEqual([]);
    for (const fix of ["C6", "C12", "C23", "C27", "C28"]) {
      expect(card.heldFixes[fix].status).toBe("NOT VALID (lexical only)");
      expect(cli.stdout).toContain(`${fix}: NOT VALID (lexical only)`);
    }
    expect(card.manifestPinOverridden).toBe(true);
    const table = formatScorecardTable(card);
    expect(table).toContain("C12");
    expect(table).toContain("en-syn-001");
    expect(table).toContain("it-syn-002");
  });

  it("identifies both stage lists when refusing mismatched arms using the same model", async () => {
    const { dataset } = loadSyntheticDataset();
    const arm = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" });
    const base = semanticReceipt(arm, 4);
    const candidate = { ...base, stages: ["lexical"], embeddingCalls: 0 };
    expect(() => compareArms({ dataset, base, candidate }))
      .toThrow(/stages differ: base=lexical,semantic candidate=lexical/i);
  });

  it("prints each arm's stages, model and transcript embedding calls", async () => {
    const { dataset } = loadSyntheticDataset();
    const arm = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "fixture" });
    const table = formatScorecardTable(compareArms({
      dataset, base: semanticReceipt(arm, 4), candidate: semanticReceipt(arm, 7),
    }));
    expect(table).toMatch(/Base:[^\n]*stages=lexical,semantic model=fixture-model embedding calls=4/);
    expect(table).toMatch(/Candidate:[^\n]*stages=lexical,semantic model=fixture-model embedding calls=7/);
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
    navCase.events.push({
      type: "final",
      text: "silver ribbons mark the trail",
      expect: { currentPoint: null, ticked: [], sectionMoveAllowed: true },
    });
    const navDataset: FrozenDataset = { ...dataset, cases: [...dataset.cases, navCase] };
    const arm = await replayArm({ lexicalOnly: true, dataset: navDataset, armRoot, armName: "nav-base" });
    const navResult = arm.cases.find((c) => c.id === "en-syn-nav")!;
    expect(navResult.finals[0].observed.voiceMoveTo).toBe("syn-en.s2");
    expect(navResult.finals[0].observed.sectionMoveAllowed).toBe(true);
    expect(navResult.finals[0].prohibitedSectionMove).toBe(true);
    expect(navResult.finals[1].falseTicks).toEqual(["syn-en.ribbons"]);
    expect(navResult.finals[1].currentPointMismatch).toBe(true);
    expect(navResult.finals[1].missedSectionMove).toBe(true);
    expect(navResult.sectionMoves.voiceMoves).toBe(1);
  });

  it("an injected forbidden tick plus a compensating fix gives a named regression and non-zero exit even with flat total accuracy", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = semanticReceipt(await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" }), 3);

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
      currentPoint: "syn-en.lanterns",
      ticked: ["syn-en.lanterns"],
      sectionMoveAllowed: false,
      sectionId: "syn-en.s1",
      voiceMoveTo: null,
    };

    const candIt = candidate.cases.find((c) => c.id === "it-syn-002")!;
    candIt.finals[0].observed = {
      currentPoint: "syn-it.lanterne",
      ticked: ["syn-it.lanterne"],
      sectionMoveAllowed: false,
      sectionId: "syn-it.s1",
      voiceMoveTo: null,
    };

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
    expect(card.heldFixes.C12.reasons.join(" ")).toContain("language loss in it");
    expect(card.heldFixes.C12.status).toBe("HOLD");
  });

  it("rejects missing case IDs in either arm", async () => {
    const { fixture, dataset } = loadSyntheticDataset();
    const base = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" });
    const incomplete: ArmResult = structuredClone(base);
    incomplete.cases = incomplete.cases.filter((c) => c.id !== "it-syn-002");

    expect(() => compareArms({ dataset, base, candidate: incomplete })).toThrow(/missing case/i);

    expect(() => compareArms({ dataset, base: incomplete, candidate: base })).toThrow(/missing case IDs in base/i);
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
    const base = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" });
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
    const base = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" });
    const staleSource: ArmResult = structuredClone(base);
    staleSource.sourceDigest = "f".repeat(64);

    const live = computeSourceDigest(armRoot);
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
    ]);
    expect(cli.exitCode).toBe(2);
    expect(cli.stderr).toMatch(/stale candidate/i);
    expect(live.files).toContain("packages/core/src/screen.ts");
    expect(live.files).toContain("packages/core/src/phone-ask.ts");
  });

  it("advances a fix only with target improvement, no language loss, no new prohibited tick or section move, and passing ordinary controls", async () => {
    const { dataset } = loadSyntheticDataset();
    const base = semanticReceipt(await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" }), 3);

    // Clean improvement on C12 with no loss and passing controls -> PASS
    const good: ArmResult = structuredClone(base);
    good.armName = "candidate-good";
    good.includedFixes = ["C12"];
    const goodEn = good.cases.find((c) => c.id === "en-syn-002")!;
    goodEn.finals[0].observed = {
      currentPoint: "syn-en.lanterns",
      ticked: ["syn-en.lanterns"],
      sectionMoveAllowed: false,
      sectionId: "syn-en.s1",
      voiceMoveTo: null,
    };

    const passCard = compareArms({ dataset, base, candidate: good });
    expect(passCard.namedRegressions).toEqual([]);
    expect(passCard.heldFixes.C12.status).toBe("PASS");
    expect(passCard.heldFixes.C6.status).toBe("not yet in review");

    // Prohibited section move injected alongside target improvement -> named regression + HOLD
    const badMove: ArmResult = structuredClone(good);
    const badIt = badMove.cases.find((c) => c.id === "it-syn-002")!;
    badIt.finals[0].observed.sectionMoveAllowed = true;
    badIt.finals[0].observed.voiceMoveTo = "syn-it.s2";

    const holdCard = compareArms({ dataset, base, candidate: badMove });
    expect(holdCard.namedRegressions.some((r) => r.caseId === "it-syn-002" && r.reasons.includes("new-prohibited-section-move"))).toBe(true);
    expect(holdCard.heldFixes.C12.status).toBe("HOLD");
  });
  it("checks the live scorer, split, talks and clean source receipts", async () => {
    const { dataset } = loadSyntheticDataset();
    const base = await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" });
    for (const [change, error] of [
      [{ casesHash: "1".repeat(64) }, /cases hash/i],
      [{ scorerDigest: "1".repeat(64) }, /scorer digest/i],
      [{ gitDirty: true }, /dirty/i],
      [{ split: "held" }, /split/i],
      [{ talksHashes: { ...base.talksHashes, it: "x" } }, /talks hash/i],
    ] as const) {
      expect(() => compareArms({ dataset, base, candidate: { ...base, ...change } })).toThrow(error);
    }
  });

  it("names new misses, cursor and move errors even on already failing controls", async () => {
    const { dataset } = loadSyntheticDataset();
    const base = semanticReceipt(await replayArm({ lexicalOnly: true, dataset, armRoot, armName: "base" }), 3);
    const candidate = structuredClone(base);
    candidate.includedFixes = ["C12"];
    const control = (arm: ArmResult) => arm.cases[0].finals[1].observed;
    control(base).ticked.push("extra");
    control(candidate).ticked = ["extra"];
    control(candidate).currentPoint = null;
    control(candidate).sectionMoveAllowed = false;
    const card = compareArms({ dataset, base, candidate });
    expect(card.namedRegressions[0].reasons).toEqual(expect.arrayContaining([
      "new-miss", "new-current-point-mismatch", "new-missed-section-move",
    ]));
    expect(card.heldFixes.C12.reasons.join(" ")).toContain("ordinary controls not all passing");
    expect(card.controlRegressions).toContain("en-syn-001");
  });

  it("refuses semantic replay with a missing offline model", async () => {
    const { dataset } = loadSyntheticDataset();
    await expect(replayArm({ dataset, armRoot, armName: "offline",
      modelCache: makeTempDir("empty-model-cache") })).rejects.toThrow(/offline.*model/i);
  });

});
