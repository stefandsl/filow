import { createRequire } from "node:module";
import path from "node:path";
import { buildSync } from "esbuild";
import type {
  DEFAULT_MATCHER as DefaultMatcherValue,
  Engine as EngineClass,
  matcherDecide as MatcherDecideFn,
  parseScript as ParseScriptFn,
  spokenSection as SpokenSectionFn,
} from "@filow/core";
import { computeScorerDigest, computeSourceDigest, readGitInfo } from "./loader";
import type {
  ArmResult,
  CaseArmResult,
  FinalResult,
  FrozenCase,
  FrozenDataset,
  FrozenTalk,
  HeldFixId,
  ObservedState,
  SectionMoveCounts,
} from "./types";

export type CoreModule = {
  Engine: typeof EngineClass;
  parseScript: typeof ParseScriptFn;
  matcherDecide: typeof MatcherDecideFn;
  DEFAULT_MATCHER: typeof DefaultMatcherValue;
  spokenSection: typeof SpokenSectionFn;
};

const coreCache = new Map<string, CoreModule>();

export async function loadCoreModule(armRoot: string): Promise<CoreModule> {
  const resolved = path.resolve(armRoot);
  const cached = coreCache.get(resolved);
  if (cached) return cached;

  const coreEntry = path.join(resolved, "packages", "core", "src", "index.ts");
  // Bundle the arm's production @filow/core entry in memory via esbuild so CJS dependencies
  // like fast-json-patch work identically under Vitest and standalone Node/tsx CLI runs.
  const built = buildSync({
    entryPoints: [coreEntry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    write: false,
  });
  const code = built.outputFiles[0]?.text;
  if (!code) {
    throw new Error(`Failed to bundle @filow/core from ${coreEntry}`);
  }
  const mod = { exports: {} as CoreModule };
  const armRequire = createRequire(coreEntry);
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", code);
  fn(mod.exports, armRequire, mod, coreEntry, path.dirname(coreEntry));
  coreCache.set(resolved, mod.exports);
  return mod.exports;
}

function speechOrderOffset(finalText: string, quote: string | undefined, pointText: string): number {
  const hay = finalText.toLowerCase();
  if (quote) {
    const idx = hay.indexOf(quote.trim().toLowerCase());
    if (idx >= 0) return idx;
  }
  const words = pointText.toLowerCase().match(/\p{L}{3,}|\d+/gu) ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (const w of words) {
    const idx = hay.indexOf(w);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

export async function replayCase(
  frozenCase: FrozenCase,
  talk: FrozenTalk,
  core: CoreModule,
): Promise<CaseArmResult> {
  const parsed = core.parseScript(talk.script);
  if (parsed.sections.length !== talk.sections.length) {
    throw new Error(
      `Parser mismatch for talk ${talk.id}: expected ${talk.sections.length} sections, got ${parsed.sections.length}`,
    );
  }

  const bulletToPoint = new Map<string, string>();
  const pointTextById = new Map<string, string>();
  const scriptOrderById = new Map<string, number>();
  let order = 0;
  for (let si = 0; si < talk.sections.length; si++) {
    const talkSec = talk.sections[si];
    const parsedSec = parsed.sections[si];
    if (parsedSec.bullets.length !== talkSec.points.length) {
      throw new Error(
        `Parser mismatch for section ${talkSec.id}: expected ${talkSec.points.length} points, got ${parsedSec.bullets.length}`,
      );
    }
    for (let bi = 0; bi < talkSec.points.length; bi++) {
      const point = talkSec.points[bi];
      const bullet = parsedSec.bullets[bi];
      if (bullet.text !== point.text) {
        throw new Error(
          `Parser text mismatch for ${point.id}: expected "${point.text}", got "${bullet.text}"`,
        );
      }
      bulletToPoint.set(bullet.id, point.id);
      pointTextById.set(point.id, point.text);
      scriptOrderById.set(point.id, order++);
    }
  }

  const startIdx = talk.sections.findIndex((s) => s.id === frozenCase.startSection);
  if (startIdx < 0) {
    throw new Error(`Unknown startSection ${frozenCase.startSection} in talk ${talk.id}`);
  }
  const startBullets = parsed.sections[startIdx].bullets;
  const startBulletIds = new Set(startBullets.map((b) => b.id));

  // Exercise the production matcher's lexical and announcement path offline (no network/model download).
  const offlineEmbed = async (texts: string[]) => texts.map(() => new Float32Array(1));
  const decide = core.matcherDecide(
    offlineEmbed,
    () => ({ key: "lexical", ids: [], vectors: [] }),
    core.DEFAULT_MATCHER,
  );

  let nowSec = 0;
  const engine = new core.Engine({
    decide,
    now: () => Math.round(nowSec * 1000),
    setInterval: () => 0,
    clearInterval: () => {},
    costCapUsd: null,
  });

  engine.loadScript(parsed);
  if (startIdx !== 0) {
    const moved = engine.dispatch({ type: "goToSection", idx: startIdx });
    if (!moved.ok) {
      throw new Error(`Failed to navigate to startSection ${frozenCase.startSection}: ${moved.error}`);
    }
  }

  const tickedOrder: string[] = [];
  let currentPoint: string | null = null;
  const finals: FinalResult[] = [];
  const sectionMoves: SectionMoveCounts = {
    allowedObserved: 0,
    allowedExpected: 0,
    prohibited: 0,
    missed: 0,
    voiceMoves: 0,
  };

  let finalIndex = 0;
  for (const event of frozenCase.events) {
    if (event.type === "partial") {
      nowSec += 1;
      engine.feed({ partial: event.text });
      continue;
    }

    nowSec += 5;
    const tickedBefore = new Set(tickedOrder);
    let voiceMoveTo: string | null = null;
    const committed = event.text.endsWith(" ") ? event.text : `${event.text} `;
    engine.feed({ committed, partial: "" }, () => {
      const st = engine.getState();
      const movedIdx = core.spokenSection(
        event.text,
        st.script.sections.map((sec) => sec.title),
        st.sectionIdx,
      );
      if (movedIdx !== null && engine.dispatch({ type: "anchor", idx: movedIdx }).ok) {
        voiceMoveTo = talk.sections[movedIdx]?.id ?? `s${movedIdx}`;
      }
    });

    await engine.tick();
    // Mirror gauntlet.ts: allow a second tick 2 s later so 2-call confirmation settles on this final.
    nowSec += 2;
    await engine.tick();

    const st = engine.getState();
    const startedNow = new Set<string>();
    for (const b of startBullets) {
      if (startBulletIds.has(b.id) && st.points[b.id]?.status === "started") {
        startedNow.add(bulletToPoint.get(b.id)!);
      }
    }

    // Remove any point withdrawn by the guard's correction path.
    for (let i = tickedOrder.length - 1; i >= 0; i--) {
      if (!startedNow.has(tickedOrder[i])) tickedOrder.splice(i, 1);
    }

    // Order newly ticked points by speech order within this final, falling back to script order.
    const newlyTicked = [...startedNow].filter((id) => !tickedBefore.has(id));
    newlyTicked.sort((a, b) => {
      const bulletA = startBullets.find((x) => bulletToPoint.get(x.id) === a);
      const bulletB = startBullets.find((x) => bulletToPoint.get(x.id) === b);
      const evA = bulletA ? st.points[bulletA.id]?.evidence : undefined;
      const evB = bulletB ? st.points[bulletB.id]?.evidence : undefined;
      const quoteA = evA && evA.source === "model" ? evA.quote : undefined;
      const quoteB = evB && evB.source === "model" ? evB.quote : undefined;
      const offA = speechOrderOffset(event.text, quoteA, pointTextById.get(a) ?? "");
      const offB = speechOrderOffset(event.text, quoteB, pointTextById.get(b) ?? "");
      if (offA !== offB) return offA - offB;
      return (scriptOrderById.get(a) ?? 0) - (scriptOrderById.get(b) ?? 0);
    });
    for (const id of newlyTicked) tickedOrder.push(id);

    if (newlyTicked.length > 0) {
      currentPoint = newlyTicked[newlyTicked.length - 1];
    } else if (currentPoint !== null && !startedNow.has(currentPoint)) {
      currentPoint = tickedOrder.length > 0 ? tickedOrder[tickedOrder.length - 1] : null;
    }

    const allStartPointsTicked = startBullets.every((b) => st.points[b.id]?.status === "started");
    const autoAdvanceAllowed = allStartPointsTicked && startIdx < parsed.sections.length - 1;
    const sectionMoveAllowed = autoAdvanceAllowed || voiceMoveTo !== null;

    const observed: ObservedState = {
      currentPoint,
      ticked: [...tickedOrder],
      sectionMoveAllowed,
      sectionId: talk.sections[st.sectionIdx]?.id ?? null,
      voiceMoveTo,
    };

    const expectedSet = new Set(event.expect.ticked);
    const observedSet = new Set(observed.ticked);
    const falseTicks = observed.ticked.filter((id) => !expectedSet.has(id));
    const misses = event.expect.ticked.filter((id) => !observedSet.has(id));
    const currentPointMismatch = observed.currentPoint !== event.expect.currentPoint;
    const prohibitedSectionMove =
      (observed.sectionMoveAllowed && !event.expect.sectionMoveAllowed) ||
      (voiceMoveTo !== null && !event.expect.sectionMoveAllowed);
    const missedSectionMove = !observed.sectionMoveAllowed && event.expect.sectionMoveAllowed;
    const pass =
      falseTicks.length === 0 &&
      misses.length === 0 &&
      !currentPointMismatch &&
      !prohibitedSectionMove &&
      !missedSectionMove;

    if (observed.sectionMoveAllowed) sectionMoves.allowedObserved++;
    if (event.expect.sectionMoveAllowed) sectionMoves.allowedExpected++;
    if (prohibitedSectionMove) sectionMoves.prohibited++;
    if (missedSectionMove) sectionMoves.missed++;
    if (voiceMoveTo !== null) sectionMoves.voiceMoves++;

    finals.push({
      finalIndex,
      text: event.text,
      expected: event.expect,
      observed,
      pass,
      falseTicks,
      misses,
      currentPointMismatch,
      prohibitedSectionMove,
      missedSectionMove,
    });
    finalIndex++;
  }

  return {
    id: frozenCase.id,
    talk: frozenCase.talk,
    language: frozenCase.language,
    split: frozenCase.split,
    defect: frozenCase.defect,
    kind: frozenCase.kind,
    startSection: frozenCase.startSection,
    finals,
    pass: finals.every((f) => f.pass),
    falseTicks: finals.reduce((acc, f) => acc + f.falseTicks.length, 0),
    misses: finals.reduce((acc, f) => acc + f.misses.length, 0),
    sectionMoves,
  };
}

export type ReplayArmOptions = {
  dataset: FrozenDataset;
  armRoot: string;
  armName: string;
  includedFixes?: HeldFixId[];
  coreOverride?: CoreModule;
};

export async function replayArm(opts: ReplayArmOptions): Promise<ArmResult> {
  const core = opts.coreOverride ?? (await loadCoreModule(opts.armRoot));
  const { gitSha, gitDirty } = readGitInfo(opts.armRoot);
  const { sourceDigest, files: sourceFiles } = computeSourceDigest(opts.armRoot);
  const scorerDigest = computeScorerDigest();

  const cases: CaseArmResult[] = [];
  for (const frozenCase of opts.dataset.cases) {
    const talk = opts.dataset.talks.get(frozenCase.talk);
    if (!talk) {
      throw new Error(`Talk ${frozenCase.talk} missing for case ${frozenCase.id}`);
    }
    cases.push(await replayCase(frozenCase, talk, core));
  }

  return {
    schemaVersion: "x12-arm-v1",
    datasetVersion: opts.dataset.version,
    split: opts.dataset.split,
    armName: opts.armName,
    gitSha,
    gitDirty,
    sourceDigest,
    sourceFiles,
    scorerDigest,
    manifestHash: opts.dataset.manifestSha256,
    casesFile: opts.dataset.casesFile,
    casesHash: opts.dataset.casesSha256,
    talksHashes: opts.dataset.talksHashes,
    includedFixes: [...(opts.includedFixes ?? [])],
    embedder: "lexical",
    cases,
  };
}
