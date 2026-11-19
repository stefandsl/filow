import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ensure, hash, json, now, read, save } from './worktree.mjs';
import { desktopCodex, desktopFix, loginFix, ready, route, packet } from './brief.mjs';
import { editGrant, packetReply, safeText } from './plan.mjs';

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
  const text = read(file);
  const reply = packetReply(file, text);
  safeText(text);
  return reply;
}
export function checkAllowance(file, dispatch) {
  const rounds = fs.existsSync(file) ? json(file) : [];
  const lastPass = rounds.filter(r => r.verdict === 'PASS').at(-1)?.candidate || 'none';
  ensure(rounds.length < 3 || rounds.some(r => r.id === dispatch), 'Three review rounds used for this change. Last independent pass: ' + lastPass + '. Send open findings and preserved evidence to the owner.');
  return rounds;
}
export function reserve(file, dispatch, candidate) {
  const rounds = checkAllowance(file,dispatch);
  const old = rounds.find(r => r.id === dispatch);
  if (old) return old;
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
export async function checkPackage(file,digest) {
  ensure(typeof file === 'string' && path.isAbsolute(file) && /^[a-f0-9]{128}$/.test(digest) &&
    fs.existsSync(file) && await packageDigest(file) === digest, 'Package evidence is missing or changed.');
}
export async function review(state, dir, ledger, options, checkpoint, resolveCodex = desktopCodex) {
  const expected = route(state.risk.level, 'Reviewer, blind case');
  const openAI = expected.provider === 'OpenAI';
  const exe = openAI ? resolveCodex() : null;
  ensure(!openAI || exe, desktopFix);
  ensure(ready(expected.provider,process.env,exe,path.join(dir,'runtime')), 'Required independent reviewer unavailable. ' +
    (openAI ? loginFix : 'Set OPENROUTER_API_KEY') + ' and repeat verify.');
  if (!state.round || options.newRound && state.round.closed) {
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
        requiredGates: state.gate.receipts, builderGrant: editGrant(state.card) }) +
      '\nFor Heavy include packagePath, packageSha512, os and device for the tested artifact. Include skillRevision after an agent failure.';
    if (stage === 'judge') detail += '\nAssess the independent replay report at ' + round.replay.file + ' with digest ' + round.replay.digest +
      '\nBuilder identity and evidence: ' + JSON.stringify({actor:state.builder,report:state.builderEvidence});
    if (!round[stage]) {
      round.packets ??= {};
      if (!round.packets[stage]) {
        ensure(!fs.existsSync(file), 'Unexpected pre-existing review output. Preserve the packet and inspect its origin.');
        round.packets[stage] = randomUUID();
        checkpoint();
      }
      packet(state, role, folder, detail + '\nEcho this assignment ID in field "assignment": ' + round.packets[stage], file, resolveCodex);
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
          state.failedCandidate = state.candidate;
          round.closed = true; round.findings = report.findings; checkpoint();
          ensure(false, 'Review is on HOLD. Reconcile the findings before requesting another round.');
        }
        ensure(report.observations?.length === checks.length && report.observations.every(s => safeText(s)), 'Missing required replay observations.');
        if (state.firstFailure) safeText(report.skillRevision);
        if (state.risk.level === 'Heavy') {
          safeText(report.device); safeText(report.os);
          await checkPackage(report.packagePath,report.packageSha512);
          ensure(stage !== 'judge' || round.replay.packageHash === report.packageSha512, 'Judge must verify the package that the reviewer replayed.');
          receipt.packageHash = report.packageSha512;
          receipt.packagePath = report.packagePath;
          state.packageHash = report.packageSha512;
        }
      }
      round[stage] = receipt;
      checkpoint();
    }
    ensure(hash(read(file)) === round[stage].digest, 'A recorded review packet changed. Preserve it and request independent review.');
    if (round[stage].packageHash) await checkPackage(round[stage].packagePath,round[stage].packageHash);
    sources.push(round[stage].who);
  }
  state.lastIndependentPass = state.candidate;
  finishRound(ledger,round.id,{verdict:'PASS',evidence:round.judge.file,digest:round.judge.digest});
}
