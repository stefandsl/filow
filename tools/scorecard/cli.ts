import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareArms, formatScorecardTable } from "./compare";
import { loadFrozenDataset, parseHeldFixes } from "./loader";
import { replayArm } from "./replay";
import type { ArmResult, SplitName } from "./types";

type ParsedFlags = {
  command?: string;
  flags: Record<string, string>;
};

function parseArgs(argv: string[]): ParsedFlags {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = "true";
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

function asSplit(raw: string | undefined): SplitName {
  if (!raw || raw === "dev") return "dev";
  if (raw === "held") return "held";
  throw new Error(`Invalid split: ${raw} (expected dev or held)`);
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export async function runCli(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { command, flags } = parseArgs(argv);
    if (!command || command === "--help" || command === "-h") {
      const usage = [
        "Usage:",
        "  tsx tools/scorecard/cli.ts replay --arm-root <dir> --arm-name <name> --out <file> [--cases-dir <dir>] [--manifest <file>] [--cases <file>] [--split dev|held] [--model-cache <dir> | --lexical-only] [--fixes C12] [--manifest-hash <sha256>]",
        "  tsx tools/scorecard/cli.ts compare --base <file> --candidate <file> [--cases-dir <dir>] [--manifest <file>] [--cases <file>] [--split dev|held] [--base-root <dir>] [--candidate-root <dir>] [--out <scorecard.json>] [--table-out <table.txt>] [--allow-lexical] [--manifest-hash <sha256>]",
      ].join("\n") + "\n";
      return { exitCode: 0, stdout: usage, stderr: "" };
    }

    if (command === "replay") {
      const armRoot = flags["arm-root"];
      const armName = flags["arm-name"];
      const outPath = flags.out;
      if (!armRoot) throw new Error("Missing required flag: --arm-root");
      if (!armName) throw new Error("Missing required flag: --arm-name");
      if (!outPath) throw new Error("Missing required flag: --out");

      const dataset = loadFrozenDataset({
        casesDir: flags["cases-dir"],
        manifestPath: flags.manifest,
        casesPath: flags.cases,
        split: asSplit(flags.split),
        expectedManifestSha256: flags["manifest-hash"],
      });

      const includedFixes = parseHeldFixes(flags.fixes);
      const result = await replayArm({
        dataset,
        armRoot,
        armName,
        includedFixes,
        lexicalOnly: flags["lexical-only"] === "true",
        modelCache: flags["model-cache"],
      });

      ensureParentDir(outPath);
      fs.writeFileSync(path.resolve(outPath), JSON.stringify(result, null, 2) + "\n", "utf8");
      const passed = result.cases.filter((c) => c.pass).length;
      return {
        exitCode: 0,
        stdout: `Replayed ${result.armName} (${result.gitSha.slice(0, 10)}) on ${result.split}: ${passed}/${result.cases.length} passed\n`,
        stderr: "",
      };
    }

    if (command === "compare") {
      const basePath = flags.base;
      const candPath = flags.candidate;
      if (!basePath) throw new Error("Missing required flag: --base");
      if (!candPath) throw new Error("Missing required flag: --candidate");

      const dataset = loadFrozenDataset({
        casesDir: flags["cases-dir"],
        manifestPath: flags.manifest,
        casesPath: flags.cases,
        split: asSplit(flags.split),
        expectedManifestSha256: flags["manifest-hash"],
      });

      const base = JSON.parse(fs.readFileSync(path.resolve(basePath), "utf8")) as ArmResult;
      const candidate = JSON.parse(fs.readFileSync(path.resolve(candPath), "utf8")) as ArmResult;

      const scorecard = compareArms({
        dataset,
        base,
        candidate,
        baseRoot: flags["base-root"],
        candidateRoot: flags["candidate-root"],
        expectedBaseGitSha: flags["expected-base-sha"],
        expectedBaseSourceDigest: flags["expected-base-source-digest"],
        expectedCandidateGitSha: flags["expected-candidate-sha"],
        expectedCandidateSourceDigest: flags["expected-candidate-source-digest"],
      });

      const table = formatScorecardTable(scorecard);

      if (flags.out) {
        ensureParentDir(flags.out);
        fs.writeFileSync(path.resolve(flags.out), JSON.stringify(scorecard, null, 2) + "\n", "utf8");
      }
      if (flags["table-out"]) {
        ensureParentDir(flags["table-out"]);
        fs.writeFileSync(path.resolve(flags["table-out"]), table, "utf8");
      }

      const lexicalFailure = scorecard.lexicalOnly && flags["allow-lexical"] !== "true";
      const exitCode = lexicalFailure || scorecard.namedRegressions.length > 0 ? 1 : 0;
      return { exitCode, stdout: table, stderr: "" };
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 2, stdout: "", stderr: `Error: ${message}\n` };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  void runCli(process.argv.slice(2)).then(({ exitCode, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  });
}
