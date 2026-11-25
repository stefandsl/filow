export type HeldFixId = "C6" | "C12" | "C23" | "C27" | "C28";

export const HELD_FIX_IDS: readonly HeldFixId[] = ["C6", "C12", "C23", "C27", "C28"];

export type LanguageCode = "en" | "it";

export type SplitName = "dev" | "held";

export type FrozenPoint = {
  id: string;
  text: string;
};

export type FrozenSection = {
  id: string;
  title: string;
  points: FrozenPoint[];
};

export type FrozenTalk = {
  id: string;
  language: LanguageCode;
  split: SplitName;
  title: string;
  sections: FrozenSection[];
  script: string;
};

export type FrozenTalksFile = {
  version: string;
  talks: FrozenTalk[];
};

export type ExpectedState = {
  currentPoint: string | null;
  ticked: string[];
  sectionMoveAllowed: boolean;
};

export type CaseEvent =
  | { type: "partial"; text: string }
  | { type: "final"; text: string; expect: ExpectedState };

export type FrozenCase = {
  id: string;
  talk: string;
  language: LanguageCode;
  split: SplitName;
  defect: string;
  kind: string;
  startSection: string;
  rationale: string;
  events: CaseEvent[];
};

export type FrozenCasesFile = {
  version: string;
  split: SplitName;
  cases: FrozenCase[];
};

export type FrozenDataset = {
  version: string;
  split: SplitName;
  manifestSha256: string;
  casesFile: string;
  casesSha256: string;
  talksHashes: Record<LanguageCode, string>;
  talks: Map<string, FrozenTalk>;
  cases: FrozenCase[];
};

export type ObservedState = {
  currentPoint: string | null;
  ticked: string[];
  sectionMoveAllowed: boolean;
  sectionId: string | null;
  voiceMoveTo: string | null;
};

export type FinalResult = {
  finalIndex: number;
  text: string;
  expected: ExpectedState;
  observed: ObservedState;
  pass: boolean;
  falseTicks: string[];
  misses: string[];
  currentPointMismatch: boolean;
  prohibitedSectionMove: boolean;
  missedSectionMove: boolean;
};

export type SectionMoveCounts = {
  allowedObserved: number;
  allowedExpected: number;
  prohibited: number;
  missed: number;
  voiceMoves: number;
};

export type CaseArmResult = {
  id: string;
  talk: string;
  language: LanguageCode;
  split: SplitName;
  defect: string;
  kind: string;
  startSection: string;
  finals: FinalResult[];
  pass: boolean;
  falseTicks: number;
  misses: number;
  sectionMoves: SectionMoveCounts;
};

export type ArmResult = {
  schemaVersion: "x12-arm-v1";
  datasetVersion: string;
  split: SplitName;
  armName: string;
  gitSha: string;
  gitDirty: boolean;
  sourceDigest: string;
  sourceFiles: string[];
  scorerDigest: string;
  manifestHash: string;
  casesFile: string;
  casesHash: string;
  talksHashes: Record<LanguageCode, string>;
  includedFixes: HeldFixId[];
  embedder: "lexical";
  cases: CaseArmResult[];
};

export type BucketCounts = {
  passed: number;
  total: number;
  falseTicks: number;
  finalsTotal: number;
  misses: number;
  expectedTicksTotal: number;
  sectionMoves: SectionMoveCounts;
};

export type ArmSummary = {
  armName: string;
  total: BucketCounts;
  byLanguage: Record<string, BucketCounts>;
  byDefect: Record<string, BucketCounts>;
  byKind: Record<string, BucketCounts>;
  byLanguageAndDefect: Record<string, Record<string, BucketCounts>>;
};

export type CaseComparison = {
  id: string;
  talk: string;
  language: LanguageCode;
  defect: string;
  kind: string;
  startSection: string;
  base: CaseArmResult;
  candidate: CaseArmResult;
  flip: "improved" | "regressed" | "same-pass" | "same-fail";
  stateChanged: boolean;
  newFalseTicks: string[];
  newProhibitedSectionMoves: number;
  newMisses: string[];
  namedRegression: boolean;
  regressionReasons: string[];
};

export type NamedRegression = {
  caseId: string;
  language: LanguageCode;
  defect: string;
  kind: string;
  reasons: string[];
};

export type HeldFixEvaluation = {
  fix: HeldFixId;
  status: "PASS" | "HOLD" | "not yet in review";
  reasons: string[];
  targetBase?: { passed: number; total: number };
  targetCandidate?: { passed: number; total: number };
};

export type Scorecard = {
  schemaVersion: "x12-scorecard-v1";
  datasetVersion: string;
  split: SplitName;
  digests: {
    manifestSha256: string;
    casesSha256: string;
    scorerSha256: string;
    baseGitSha: string;
    baseSourceSha256: string;
    candidateGitSha: string;
    candidateSourceSha256: string;
    comparisonSha256: string;
  };
  summary: {
    base: ArmSummary;
    candidate: ArmSummary;
  };
  flips: {
    improvedIds: string[];
    regressedIds: string[];
    changedIds: string[];
  };
  namedRegressions: NamedRegression[];
  heldFixes: Record<HeldFixId, HeldFixEvaluation>;
  cases: CaseComparison[];
};
