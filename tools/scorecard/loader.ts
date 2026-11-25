import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FrozenCasesFile,
  FrozenDataset,
  FrozenTalk,
  FrozenTalksFile,
  HeldFixId,
  LanguageCode,
  SplitName,
} from "./types";
import { HELD_FIX_IDS } from "./types";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CASES_DIR_ENV = "FILOW_SCORECARD_CASES_DIR";

export const SPEECH_SOURCE_FILES: readonly string[] = [
  "packages/core/src/anchor.ts",
  "packages/core/src/api.ts",
  "packages/core/src/engine.ts",
  "packages/core/src/gate.ts",
  "packages/core/src/gauntlet.ts",
  "packages/core/src/guard.ts",
  "packages/core/src/matcher.ts",
  "packages/core/src/script.ts",
  "packages/core/src/text.ts",
  "packages/core/src/types.ts",
];

const SCORER_FILES: readonly string[] = [
  "manifest-pin.json",
  "types.ts",
  "loader.ts",
  "replay.ts",
  "compare.ts",
  "cli.ts",
];

export type PinnedManifest = {
  version: string;
  manifestSha256: string;
};

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadPinnedManifest(pinPath = path.join(THIS_DIR, "manifest-pin.json")): PinnedManifest {
  const raw = fs.readFileSync(pinPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<PinnedManifest>;
  if (!parsed.version || !parsed.manifestSha256 || !/^[0-9a-f]{64}$/i.test(parsed.manifestSha256)) {
    throw new Error(`Invalid manifest pin file: ${path.basename(pinPath)}`);
  }
  return {
    version: parsed.version,
    manifestSha256: parsed.manifestSha256.toLowerCase(),
  };
}

export function parseManifestHashes(markdown: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([0-9a-f]{64})\s*\|$/i);
    if (!match) continue;
    hashes[match[1].trim()] = match[2].toLowerCase();
  }
  return hashes;
}

export function resolveCasesDir(cliDir?: string): string {
  const resolved = cliDir?.trim() || process.env[CASES_DIR_ENV]?.trim();
  if (!resolved) {
    throw new Error(`Cases directory is required: pass --cases-dir or set ${CASES_DIR_ENV}`);
  }
  return path.resolve(resolved);
}

export type LoadDatasetOptions = {
  casesDir?: string;
  manifestPath?: string;
  casesPath?: string;
  split?: SplitName;
  expectedManifestSha256?: string;
};

export function loadFrozenDataset(opts: LoadDatasetOptions): FrozenDataset {
  const manifestPath = opts.manifestPath
    ? path.resolve(opts.manifestPath)
    : path.join(resolveCasesDir(opts.casesDir), "MANIFEST.md");
  const baseDir = path.dirname(manifestPath);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${path.basename(manifestPath)}`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = sha256Hex(manifestBytes);
  const expectedManifest = (opts.expectedManifestSha256 ?? loadPinnedManifest().manifestSha256).toLowerCase();
  if (manifestSha256 !== expectedManifest) {
    throw new Error(`Manifest hash mismatch: expected ${expectedManifest}, got ${manifestSha256}`);
  }

  const manifestText = manifestBytes.toString("utf8");
  const fileHashes = parseManifestHashes(manifestText);

  const casesPath = opts.casesPath
    ? path.resolve(opts.casesPath)
    : path.join(baseDir, opts.split === "held" ? "cases-held.json" : "cases-dev.json");
  const casesFile = path.basename(casesPath);
  if (!fs.existsSync(casesPath)) {
    throw new Error(`Cases file not found: ${casesFile}`);
  }
  const expectedCasesHash = fileHashes[casesFile];
  if (!expectedCasesHash) {
    throw new Error(`Manifest hash mismatch: ${casesFile} is not listed in MANIFEST.md`);
  }
  const casesBytes = fs.readFileSync(casesPath);
  const casesSha256 = sha256Hex(casesBytes);
  if (casesSha256 !== expectedCasesHash) {
    throw new Error(`Cases hash mismatch for ${casesFile}: expected ${expectedCasesHash}, got ${casesSha256}`);
  }

  const talks = new Map<string, FrozenTalk>();
  const talksHashes = {} as Record<LanguageCode, string>;
  for (const lang of ["en", "it"] as const) {
    const fileName = `talks-${lang}.json`;
    const talkPath = path.join(baseDir, fileName);
    const expectedTalkHash = fileHashes[fileName];
    if (!expectedTalkHash) {
      throw new Error(`Manifest hash mismatch: ${fileName} is not listed in MANIFEST.md`);
    }
    if (!fs.existsSync(talkPath)) {
      throw new Error(`Talks file not found: ${fileName}`);
    }
    const talkBytes = fs.readFileSync(talkPath);
    const talkSha256 = sha256Hex(talkBytes);
    if (talkSha256 !== expectedTalkHash) {
      throw new Error(`Talks hash mismatch for ${fileName}: expected ${expectedTalkHash}, got ${talkSha256}`);
    }
    talksHashes[lang] = talkSha256;
    const parsedTalks = JSON.parse(talkBytes.toString("utf8")) as FrozenTalksFile;
    for (const talk of parsedTalks.talks) {
      if (talks.has(talk.id)) {
        throw new Error(`Duplicate talk ID in ${fileName}: ${talk.id}`);
      }
      talks.set(talk.id, talk);
    }
  }

  const parsedCases = JSON.parse(casesBytes.toString("utf8")) as FrozenCasesFile;
  if (!Array.isArray(parsedCases.cases) || parsedCases.cases.length === 0) {
    throw new Error(`Cases file ${casesFile} contains no cases`);
  }
  const seenIds = new Set<string>();
  for (const c of parsedCases.cases) {
    if (seenIds.has(c.id)) {
      throw new Error(`Duplicate case ID in ${casesFile}: ${c.id}`);
    }
    seenIds.add(c.id);
    const talk = talks.get(c.talk);
    if (!talk) {
      throw new Error(`Case ${c.id} references unknown talk ${c.talk}`);
    }
    if (!talk.sections.some((s) => s.id === c.startSection)) {
      throw new Error(`Case ${c.id} references unknown startSection ${c.startSection} in talk ${c.talk}`);
    }
  }

  return {
    version: parsedCases.version,
    split: parsedCases.split,
    manifestSha256,
    casesFile,
    casesSha256,
    talksHashes,
    talks,
    cases: parsedCases.cases,
  };
}

export function computeSourceDigest(armRoot: string): { sourceDigest: string; files: string[] } {
  const root = path.resolve(armRoot);
  const h = createHash("sha256");
  const files: string[] = [];
  for (const rel of SPEECH_SOURCE_FILES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing production speech source file in arm: ${rel}`);
    }
    const bytes = fs.readFileSync(full);
    h.update(`${rel}\0${sha256Hex(bytes)}\n`);
    files.push(rel);
  }
  return { sourceDigest: h.digest("hex"), files };
}

export function readGitInfo(armRoot: string): { gitSha: string; gitDirty: boolean } {
  const root = path.resolve(armRoot);
  const gitSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/i.test(gitSha)) {
    throw new Error(`Invalid git HEAD SHA in arm: ${gitSha}`);
  }
  const porcelain = execFileSync(
    "git",
    ["-C", root, "status", "--porcelain", "--", "packages/core/src"],
    { encoding: "utf8" },
  ).trim();
  return { gitSha: gitSha.toLowerCase(), gitDirty: porcelain.length > 0 };
}

export function computeScorerDigest(scorecardDir = THIS_DIR): string {
  const dir = path.resolve(scorecardDir);
  const h = createHash("sha256");
  for (const rel of SCORER_FILES) {
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing scorer file: ${rel}`);
    }
    const bytes = fs.readFileSync(full);
    h.update(`${rel}\0${sha256Hex(bytes)}\n`);
  }
  return h.digest("hex");
}

export function parseHeldFixes(raw?: string): HeldFixId[] {
  if (!raw || !raw.trim()) return [];
  const out: HeldFixId[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!HELD_FIX_IDS.includes(part as HeldFixId)) {
      throw new Error(`Unknown held fix ID: ${part} (expected one of ${HELD_FIX_IDS.join(", ")})`);
    }
    if (!out.includes(part as HeldFixId)) out.push(part as HeldFixId);
  }
  return out;
}
