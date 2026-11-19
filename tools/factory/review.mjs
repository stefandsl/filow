import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ensure, hash, json, now, read, save } from './worktree.mjs';
import { ready, route, packet } from './brief.mjs';
import { safeText } from './plan.mjs';

export function actor(report, expected, others = []) {
  ensure(report.provider === expected.provider && (expected.provider === 'Anthropic' ?
    /^claude[- ]opus[- ][\w.-]+$/i.test(report.model) : report.model === expected.model) && report.effort === expected.effort,
  'Report must identify the assigned flagship provider, actual model and reasoning effort.');
  safeText(report.session);
  ensure(others.every(a => a.session !== report.session), 'Independent review needs a fresh session distinct from the author and prior packets.');
  return { provider: report.provider, model: report.model, effort: report.effort, session: report.session };
}
export function getReport(file) {
  if (!fs.existsSync(file)) return null;
  ensure(fs.statSync(file).size < 64000, 'Report exceeds the private evidence limit.');
  safeText(read(file));
  try { return json(file); } catch { ensure(false, 'Save one JSON object in the requested output file.'); }
}
export function reserve(file, dispatch, candidate) {
  const rounds = fs.existsSync(file) ? json(file) : [];
  const old = rounds.find(r => r.id === dispatch);
  if (old) return old;
  const lastPass = rounds.filter(r => r.verdict === 'PASS').at(-1)?.candidate || 'none';
  ensure(rounds.length < 3, 'Three review rounds used for this change. Last independent pass: ' + lastPass + '. Send open findings and preserved evidence to the owner.');
  const round = { number: rounds.length + 1, id: dispatch, candidate, reserved: now() };
  save(file, [...rounds, round]);
  return round;
}
const identity = 'Include provider, model, effort and actual session. Return JSON only. ';
function finishRound(ledger,id,result) {
  const rows = json(ledger);
  Object.assign(rows.find(r=>r.id === id),result);
  save(ledger,rows);
}
async function packageDigest(file) {
  const sum = createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) sum.update(chunk);
  return sum.digest('hex');
}
export async function review(state, dir, ledger, options, checkpoint) {
  const expected = route(state.risk.level, 'Reviewer, blind case');
  ensure(ready(expected.provider), 'Required independent reviewer unavailable. Configure ' + expected.provider + ' and repeat verify.');
  if (options.newRound && state.round?.closed) state.round = null;
  if (!state.round) {
    state.dispatch ??= randomUUID();
    checkpoint();
    state.round = reserve(ledger, state.dispatch, state.candidate);
    delete state.dispatch;
    checkpoint();
  }
  const round = state.round;
  ensure(round.candidate === state.candidate && !round.closed, 'Open findings or changed candidate. Use --new-round for a fresh review.');
  const root = path.join(dir, round.id);
  const sources = [state.builder];
  for (const [stage, role] of [['blind','Reviewer, blind case'],['replay','Reviewer, replay'],['judge','Judge']]) {
    const folder = path.join(root, stage);
    const file = path.join(folder,'report.json');
    const checks = [state.card.positive, state.card.negative, ...(state.card.checks || [])];
    if (round.blind) checks.push(round.blind.case);
    if (state.risk.level !== 'Light') checks.push('Real caller and retry, correction or restart.');
    if (state.risk.level === 'Heavy') checks.push('Caller and data trace, refusal, crash and exact package or deployment replay.');
    if (state.firstFailure) checks.push('Correct the responsible skill. Replay the incident and a neighboring success and record the reviewed skill revision.');
    let detail = identity + 'Supply a distinct case and expected result in string fields "case" and "expected". End this session after recording them.';
    if (stage !== 'blind') detail = identity + 'Replay the pinned candidate. Record candidate, caseDigest, verdict (PASS or HOLD), findings (array) and observations (one nonempty string per check, in order).\n' +
      JSON.stringify({ candidate: state.candidate, caseDigest: round.blind.digest, expected: round.blind.expected, checks,
        requiredGates: state.gate.receipts, writableFiles: state.card.paths }) +
      '\nFor Heavy include packagePath, packageSha512, os and device for the tested artifact. Include skillRevision after an agent failure.';
    if (stage === 'judge') detail += '\nAssess the independent replay report at ' + round.replay.file + ' with digest ' + round.replay.digest;
    if (!round[stage]) {
      const provider = route(state.risk.level,role).provider;
      ensure(ready(provider), 'Required ' + role + ' unavailable. Configure ' + provider + ' and repeat verify.');
      round.packets ??= {};
      if (!round.packets[stage]) {
        ensure(!fs.existsSync(file), 'Unexpected pre-existing review output. Preserve the packet and inspect its origin.');
        round.packets[stage] = randomUUID();
        checkpoint();
      }
      packet(state, role, folder, detail + '\nEcho this assignment ID in field "assignment": ' + round.packets[stage], file);
      const report = getReport(file);
      ensure(report, 'Awaiting ' + stage + ' evidence. Save the requested JSON at ' + file + ' and repeat verify.');
      ensure(report.assignment === round.packets[stage], 'Report belongs to another dispatch. Replay this assignment.');
      const who = actor(report, route(state.risk.level, role), sources);
      const receipt = { who, file, digest: hash(read(file)), saved: now() };
      if (stage === 'blind') {
        receipt.case = safeText(report.case); receipt.expected = safeText(report.expected);
        ensure(!checks.includes(receipt.case), 'The blind case must challenge a distinct input.');
      } else {
        ensure(report.candidate === state.candidate && report.caseDigest === round.blind.digest,
          'Review evidence is stale. Replay the frozen case on the exact candidate.');
        ensure(Array.isArray(report.findings) && ['PASS','HOLD'].includes(report.verdict), 'Supply a review verdict and the findings array.');
        if (report.verdict !== 'PASS' || report.findings.length) {
          finishRound(ledger,round.id,{verdict:'HOLD',file,digest:receipt.digest});
          round.closed = true; round.findings = report.findings; checkpoint();
          ensure(false, 'Review is on HOLD. Reconcile the findings before requesting another round.');
        }
        ensure(report.observations?.length === checks.length && report.observations.every(s => safeText(s)), 'Missing required replay observations.');
        if (state.firstFailure) safeText(report.skillRevision);
        if (state.risk.level === 'Heavy') {
          safeText(report.device); safeText(report.os);
          ensure(path.isAbsolute(report.packagePath) && /^[a-f0-9]{128}$/.test(report.packageSha512) &&
            await packageDigest(report.packagePath) === report.packageSha512, 'Package evidence is missing or changed.');
          state.packageHash = report.packageSha512;
        }
      }
      round[stage] = receipt;
      checkpoint();
    }
    ensure(hash(read(file)) === round[stage].digest, 'A recorded review packet changed. Preserve it and request independent review.');
    sources.push(round[stage].who);
  }
  state.lastIndependentPass = state.candidate;
  finishRound(ledger,round.id,{verdict:'PASS',evidence:round.judge.file,digest:round.judge.digest});
}
