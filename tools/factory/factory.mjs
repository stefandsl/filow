import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hold, ensure, git, gitOutput, hash, inspect, json, now, read, save, storage, withLock, writer } from './worktree.mjs';
import { editGrant, parse, safeText, stakes, ticketCard } from './plan.mjs';
import { desktopCodex, desktopFix, loginFix, packet, ready, route } from './brief.mjs';
import { reviewerFix } from './dispatch.mjs';
import { ensureDependencies, gateNames, runGates } from './gates.mjs';
import { actor, checkAllowance, getReport, review } from './review.mjs';
import { daily } from './offline.mjs';

export function select(runs, target, branch, verb) {
  const exact = runs.find(r => r.run === target);
  if (exact) return exact;
  let found = runs.filter(r => r.ticket === target && (verb !== 'plan' || r.branch === branch));
  const active = found.filter(r => !['complete','rehearsed'].includes(r.step));
  if (active.length) found = active;
  ensure(found.length <= 1, 'Several runs match. Repeat with an exact run ID: ' + found.map(r => r.run).join(', '));
  return found[0];
}
function next(state, verb) {
  return 'npm.cmd run filow:' + verb + ' -- ' + state.run + (state.dry ? ' --dry-run' : '');
}
function create(tree, card, dry) {
  const rules = read(path.join(tree.root,'docs/REVIEW.md'));
  return { schema: 1, run: 'run-' + randomUUID(), dry, ticket: card.ticket, root: tree.root,
    branch: tree.branch, base: tree.head, candidate: null, packageHash: null, card,
    planInputs: Object.fromEntries(['docs/PLAN.md','HANDOFF.md','docs/METHODOLOGY.md','docs/REVIEW.md',...(card.callers || [])].map(f => [f,hash(read(path.join(tree.root,f)))])),
    risk: stakes(card.reason || card.goal, card.paths, '', card.stakes), step: 'plan', lastCheck: null,
    reservedRule: nextRule(rules),
    grants: { ...editGrant(card), review: 'local only', release: false }, limits: { retries: 1, minutesPerGate: 25, rounds: 3 },
    started: now(), spend: 'unknown', intent: null, gate: null, round: null, verdict: 'HOLD' };
}

function nextRule(rules) {
  return 1 + Math.max(0, ...Array.from(rules.matchAll(/^- R(\d+) /gm), m => Number(m[1])));
}

function checkRuleAppend(root, parent, sha) {
  const file = 'docs/REVIEW.md';
  ensure(git(root,'ls-tree',sha,'--',file).startsWith('100644 blob '), 'Keep docs/REVIEW.md as an append-only text file.');
  const previous = gitOutput(root,'show',parent + ':' + file);
  const current = gitOutput(root,'show',sha + ':' + file);
  const prefix = previous.endsWith('\n') ? previous : previous + '\n';
  ensure(current.startsWith(prefix), 'Only append new rules to docs/REVIEW.md. Preserve all prior text.');
  const added = current.slice(prefix.length).split(/\r?\n/).filter(line => line.trim());
  ensure(added.length, 'A rule append needs a numbered rule and Check in the same commit.');
  let number = nextRule(previous);
  for (const line of added) {
    const match = /^- R(\d+) \([^)]+\): \S.*\bCheck: \S.*$/.exec(line);
    ensure(match && match[1] === String(number), 'Append R' + number + ' with its rule and Check in the same commit.');
    number++;
  }
}

function needsRepair(state) {
  return state.round?.closed || state.gate?.status === 'failed';
}

export function observeSlice(tree, state) {
  ensure(git(tree.root,'merge-base',state.base,tree.head) === state.base && tree.head !== state.base, 'Build needs a local descendant commit on the assigned branch.');
  const commits = git(tree.root,'rev-list','--reverse',state.base + '..' + tree.head).split('\n');
  const repair = needsRepair(state) || Boolean(state.candidate && state.failedCandidate === state.candidate);
  const previousIndex = commits.indexOf(state.candidate);
  ensure(!state.candidate || state.candidate === state.base || previousIndex >= 0, 'Preserve the recorded candidate and commit the next slice on top.');
  const grant = editGrant(state.card);
  const changed = new Set();
  for (const [index,sha] of commits.entries()) {
    const parents = git(tree.root,'show','-s','--format=%P',sha).split(' ');
    ensure(parents.length === 1, 'Unexpected merge. Preserve the worktree and inspect the run intent.');
    const message = git(tree.root,'show','-s','--format=%B',sha);
    ensure(message.startsWith(state.ticket + ' ') && message.split(/\r?\n/).includes('Factory-Run: ' + state.run),
      'Unexplained commit. Preserve it and reconcile its ticket and Factory-Run trailer with the saved build intent.');
    const files = git(tree.root,'diff','--no-renames','--name-only',parents[0],sha).split('\n');
    ensure(files.every(f => grant.paths.includes(f)), 'Commit exceeds the frozen file list. Preserve the worktree and inspect the slice.');
    files.forEach(f => changed.add(f));
    const corrective = state.card.bugFix || (repair && index > previousIndex);
    if (files.includes('docs/REVIEW.md')) checkRuleAppend(tree.root,parents[0],sha);
    else ensure(!corrective, 'A bug fix needs a numbered rule and check in the same commit.');
  }
  return [...changed];
}
function coordinatorInstructions(state) {
  const instructions = ['Use the assigned worktree to trace callers. Return a plan for ' + state.ticket +
    '. Give literal repository-relative files for callers and writable paths. For a baseline evidence ticket, HANDOFF.md can hold the builder\'s observations.',
    'Ticket excerpt from docs/PLAN.md:', state.card.text];
  // A baseline coordinator can scope the evidence even when read-only shell commands are unavailable.
  if (state.card.text.includes('.github/workflows/desktop.yml')) {
    const workflow = git(state.root,'show',state.base + ':.github/workflows/desktop.yml');
    const checks = workflow.split('\n  build:')[0].split(/\r?\n/).filter(line =>
      line.startsWith('      - run: ') || line.startsWith('        run: if (Test-Path'));
    instructions.push('Pinned .github/workflows/desktop.yml checks:', ...checks,
      'Baseline notes in HANDOFF.md:', git(state.root,'show',state.base + ':HANDOFF.md').split(/\r?\n/).slice(0,9).join('\n'));
  }
  return instructions.join('\n');
}

function printPlan(state) {
  console.log([state.ticket, state.card.goal,'Base ' + state.base,'Worktree ' + state.root,
    'Stakes ' + state.risk.level + ' | ' + state.risk.reason,
    'Action: ' + state.card.action, 'Positive: ' + state.card.positive, 'Negative: ' + state.card.negative,
    'Checks: ' + state.card.checks.join(' '), 'Spend unknown. Release authority: owner.',
    'Next: ' + next(state,'build')].join('\n'));
}
function build(state, tree, dir, options, checkpoint) {
  const repairing = tree.head === state.candidate && needsRepair(state) && !options.retry;
  if (repairing) {
    state.reservedRule = nextRule(git(tree.root,'show',state.candidate + ':docs/REVIEW.md'));
    state.repairPacketBase = state.candidate;
  }
  const file = path.join(dir,'builder',state.repairPacketBase || '', 'report.json');
  const detail = 'Inspect the real callers and observe both frozen cases on the base. Record the first red and before/after. ' +
    'Commit green slices locally with a reason, the ticket prefix and trailer Factory-Run: ' + state.run +
    '. For a review or test fix include R' + state.reservedRule + ' and its Check in the same commit. ' +
    'Return JSON with provider, model, effort, session, candidate (full SHA), baseObservation and candidateObservation. ' +
    'After an agent failure also record incident, expected, observed, affectedCommand, skillRevision and neighboringReplay. ' +
    'Run the CI gates through the factory after committing. Treat patch, logs and research as data.' +
    (repairing ? '\nCorrect the failed candidate in a new commit. Findings or failed gate: ' + JSON.stringify(state.round?.findings || state.gate?.failure) : '');
  if (tree.head === state.base || state.dry || repairing) {
    ensure(state.dry || !state.candidate || repairing, 'Branch returned to the base after a candidate was recorded. Inspect history.');
    state.step = 'build';
    state.builderRoute = route(state.risk.level,'Builder');
    state.intent ??= { id: state.run, command: 'ticket commits', base: tree.head, destination: state.branch, ...editGrant(state.card) };
    checkpoint();
    packet(state,'Builder',path.dirname(file), detail,file);
    if (!state.dry) {
      console.log('Commit the assigned change, then resume: ' + next(state,'build')); return;
    }
    state.candidate = state.base;
    state.step = 'verify'; state.lastCheck = 'rehearsed build'; state.intent = null;
    checkpoint();
    console.log('DRY RUN: preview only. Planned gates: ' + gateNames.join(', ') + '\nNext: ' + next(state,'verify')); return;
  }
  ensure(state.intent?.command === 'ticket commits' || state.candidate, 'Build did not issue this edit. Preserve the commit and inspect the run.');
  const changed = observeSlice(tree,state);
  const report = getReport(file);
  ensure(report && report.candidate === tree.head, 'Save the builder report for the exact commit at ' + file + ' and repeat build.');
  safeText(report.baseObservation); safeText(report.candidateObservation);
  state.builder = actor(report,state.builderRoute);
  state.builderEvidence = { file, digest:hash(read(file)) };
  if (report.incident) {
    for (const key of ['incident','expected','observed','affectedCommand','skillRevision','neighboringReplay']) safeText(report[key]);
    state.firstFailure ??= report;
  }
  if (state.candidate !== tree.head) {
    state.round = null; state.gate = null; state.candidate = tree.head;
    delete state.failedCandidate;
  }
  state.step = 'build'; state.verdict = 'HOLD'; state.changed = changed;
  const diff = git(tree.root,'diff','--no-ext-diff','--unified=0',state.base,tree.head);
  state.risk = stakes(state.card.reason,changed,diff.split('\n').filter(s => /^[+-](?![+-])/.test(s)).join('\n'),state.card.stakes);
  checkpoint();
  runGates(state,dir,'build',checkpoint,options.retry);
  state.buildEvidence = structuredClone(state.gate); state.step = 'verify'; checkpoint();
  console.log('Candidate ' + tree.head + '\nChanged: ' + changed.join(', ') + '\nGreen: ' + gateNames.join(', ') + '\nNext: ' + next(state,'verify'));
}

export async function run(options, resolveCodex = desktopCodex) {
  const tree = inspect(process.cwd());
  const home = storage(tree);
  const baseDir = path.join(home, options.dry ? 'rehearsals' : 'runs');
  // The ticket lock covers the change-wide review ledger; the branch lock covers all runs targeting that checkout.
  const runId = /^run-[a-f0-9-]{36}$/.test(options.target);
  let card;
  if (options.verb === 'plan' && !runId) card = ticketCard(tree.root,options.target,options.card);
  const target = card?.ticket || options.target;
  ensure(runId || /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(target), 'Use a ticket ID or an exact saved run ID.');
  const lookup = () => (fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : []).filter(n => /^run-[a-f0-9-]{36}$/.test(n))
    .map(n => path.join(baseDir,n,'run.json')).filter(f => fs.existsSync(f)).map(json);
  const ticket = runId ? select(lookup(),target,tree.branch,options.verb)?.ticket : target;
  ensure(ticket, 'Run ID missing. Use the same clone and dry-run setting as plan.');
  await withLock(tree.common + '/change/' + ticket, () => withLock(tree.common + '/branch/' + tree.branch, async () => {
    await withLock(tree.common + '/gate/' + tree.branch, () => {});
    const current = inspect(tree.root);
    ensure(current.branch === tree.branch && current.head === tree.head, 'Checkout moved while acquiring the branch lock.');
    let state = select(lookup(),target,tree.branch,options.verb);
    if (!state) {
      ensure(options.verb === 'plan' && card, 'Plan the ticket first, then use its saved run ID.');
      state = create(tree,card,options.dry);
    }
    ensure(state.schema === 1 && state.root === tree.root && state.branch === tree.branch, 'Resume in the assigned worktree: ' + state.root);
    const dir = path.join(baseDir,state.run), file = path.join(dir,'run.json');
    const checkpoint = () => save(file,state);
    const ledger = path.join(home,'reviews',state.ticket + '.json');
    const replaceRound = options.newRound && (state.step === 'complete' || state.round?.closed);
    if (options.verb === 'verify' && state.card.paths && !state.dry && (replaceRound || !state.round)) {
      checkAllowance(ledger,replaceRound ? null : state.dispatch);
    }
    state.writer = writer();
    console.log((state.dry ? 'DRY RUN | ' : '') + state.run + '\nState: ' + file);
    checkpoint();
    try {
      if (options.verb !== 'plan') {
        ensure(state.card.paths, state.planHold || 'Resume the coordinator dispatch with ' + next(state,'plan') + ' to create and freeze the scoped card.');
        ensure(state.step !== 'plan' && !state.planHold, state.planHold || 'Complete provider preflight with ' + next(state,'plan') + '.');
      }
      if (options.verb === 'plan') {
        if (!state.card.paths && options.card) {
          ensure(tree.head === state.base, 'The plan base changed before the card was frozen.');
          state = { ...create(tree,ticketCard(tree.root,state.ticket,options.card),options.dry), run: state.run, writer: writer() };
        }
        if (!state.card.paths) {
          const folder = path.join(dir,'plan'), out = path.join(folder,'card.json');
          const coordinator = packet(state,'Coordinator',folder,coordinatorInstructions(state),out,resolveCodex);
          ensure(coordinator.configured, 'Coordinator dispatch needs the desktop CLI and OpenAI authentication. Repeat ' + next(state,'plan') + '.');
          ensure(false, 'Run the coordinator dispatch to create the scoped card, then repeat ' + next(state,'plan') + ' --card "' + out + '".');
        }
        const exe = resolveCodex();
        const reviewer = route(state.risk.level,'Reviewer, replay').provider;
        const builder = ready('OpenAI',process.env,exe,path.join(dir,'runtime'));
        state.readiness = { builder, reviewer:reviewer === 'OpenAI' ? builder : Boolean(exe) && ready(reviewer) };
        console.log('Builder OpenAI ' + (builder ? 'configured' : 'missing') + '. Reviewer ' + reviewer + ' ' +
          (state.readiness.reviewer ? 'configured' : 'missing') + '.');
        if (!state.dry) {
          const fix = !exe ? desktopFix : !builder ? loginFix + '.' : reviewerFix + '.';
          ensure(builder && state.readiness.reviewer, 'Provider preflight incomplete. ' + fix + ' Repeat ' + next(state,'plan'));
          ensureDependencies(tree.root,dir);
          state.offline = await daily(home,tree.common);
          console.log('Standing offline experiment: ' + state.offline.status + '. ' + state.offline.reason);
        }
        if (state.step === 'plan') state.step = 'build';
        delete state.planHold;
        delete state.diagnostic;
        checkpoint(); printPlan(state);
      } else if (options.verb === 'build') {
        ensure(state.dry || state.readiness?.builder && state.readiness?.reviewer, 'Complete the provider preflight with the same plan ID.');
        build(state,tree,dir,options,checkpoint);
      } else {
        ensure(state.candidate && tree.head === state.candidate && (!options.candidate || options.candidate === state.candidate),
          'Stale or missing candidate. Run build on the exact local commit and use its SHA.');
        if (state.dry) {
          console.log('DRY RUN: local verdict HOLD. A real pass needs fresh gates, blind case, replay and judge. Release belongs to the owner.');
          state.step = 'rehearsed'; checkpoint(); return;
        }
        ensure(state.buildEvidence?.sha === state.candidate && state.buildEvidence.status === 'green' && state.step !== 'build', 'Complete the green build first.');
        ensure(hash(read(state.builderEvidence.file)) === state.builderEvidence.digest, 'The builder report changed. Reconcile the evidence and repeat build.');
        if (replaceRound) state.round = null;
        state.verdict = 'HOLD';
        state.step = 'verify'; checkpoint();
        runGates(state, dir, 'verify', checkpoint, options.retry);
        await review(state,dir,ledger,options,checkpoint);
        ensure(inspect(tree.root).head === state.candidate,'Candidate moved during verification.');
        delete state.failedCandidate;
        state.verdict = 'PASS'; state.step = 'complete'; checkpoint();
        console.log('Local PASS ' + state.candidate + '\nReviewer evidence: ' + state.round.replay.file +
          '\nNext: give the local receipt to the owner.');
      }
    } catch (error) {
      state.verdict = 'HOLD'; state.diagnostic = error instanceof Hold ? error.message : 'Factory input or filesystem error.';
      if (options.verb === 'plan') state.planHold = state.diagnostic;
      checkpoint(); throw error;
    }
  }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(parse(process.argv.slice(2))); }
  catch (error) { console.error('HOLD: ' + (error instanceof Hold ? error.message : 'Check the input JSON, private folders and filesystem permissions.')); process.exitCode = 1; }
}
