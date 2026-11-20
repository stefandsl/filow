import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ensure, git, inspect, json, now, save, withLock } from './worktree.mjs';
import { privateEnv } from './gates.mjs';
import { safeText } from './plan.mjs';

// A prepared track is a separate grant. Plan polls it once per day without touching the ticket checkout.
const evaluator = 'tools/autoresearch/ar3/evaluate.mjs';
const editable = 'apps/desktop/tts-numbers.js';
const guards = ['apps/desktop/tts.test.ts','apps/desktop/tts-round2.test.ts'];
const pins = ['0d822872ca6c325430752ed0b1d31327cda1d172','ed33eb769d4fef808f6d4c91d16154d315fe86bb','34e72ee1a99981eefffaa2c1a69d98604f88c08d'];
export function decideTrial(baseline, proposal, noise, guard, heldoutDelta) {
  if (!guard || proposal - baseline <= noise) return 'discard';
  return heldoutDelta < 0 ? 'overfit' : 'keep';
}
export function daily(home, common) {
  return withLock(home + '/AR-3', () => {
    const dir = path.join(home,'offline'), last = path.join(dir,'schedule.json');
    const today = now().slice(0,10), file = path.join(dir,today + '.json');
    const next = new Date(Date.now() + 86400000).toISOString().slice(0,10);
    function pause(receipt, reason, receiptFile) {
      const schedule = {status:'paused',track:'AR-3',last:receipt.ended ?? null,next,reason};
      if (receiptFile) schedule.receipt = receiptFile;
      save(last,schedule);
      return schedule;
    }
    const grant = path.join(dir,'proposal.json');
    if (!fs.existsSync(grant)) {
      const schedule = { status:'blocked', track:'AR-3', last:fs.existsSync(last) ? json(last).last : null, next,
        reason:'Awaiting a prepared private AR-3 trial and independent labels. AR-2 needs a display and AR-1 an isolated model.', grant };
      save(last,schedule); return schedule;
    }
    if (fs.existsSync(file)) {
      const result = json(file);
      ensure(result.result && !['running','invalid','crash'].includes(result.result), 'Offline trial interrupted or invalid. Inspect its receipt: ' + file);
      return pause(result,'Today\'s trial is complete. Review its receipt before integration.',file);
    }
    const p = json(grant);
    const prior = fs.readdirSync(dir).filter(f=>/^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().map(f=>json(path.join(dir,f)));
    const latest = prior.at(-1);
    if (prior.length >= 12) return pause(latest,'Track stopped at the 12-trial cap.');
    if (prior.length >= 4 && prior.slice(-4).every(r=>r.result === 'discard')) return pause(latest,'Track stopped after four consecutive discards.');
    if (prior.some(r=>r.candidate === p.candidate)) return pause(latest,'Proposal already evaluated. Supply a new proposal.');
    const kept = prior.filter(r=>r.result === 'keep').at(-1);
    ensure(!kept || p.base === kept.candidate, 'Continue the offline track from its last kept commit.');
    const initial = inspect(p.baselineTree), proposed = inspect(p.candidateTree);
    const receipt = { track:'AR-3', result:'running', started:now(), base:initial.head, candidate:proposed.head,
      editable, helperPins:pins, hardware:os.cpus()[0]?.model, hypothesis:safeText(p.hypothesis) };
    save(file,receipt);
    try {
      ensure([initial,proposed].every(t => t.common === common && t.branch.startsWith('autoresearch/') && t.root.startsWith(dir + path.sep)),
        'Use separate private autoresearch worktrees under the offline directory.');
      ensure(p.base === initial.head && p.candidate === proposed.head && git(proposed.root,'rev-parse','HEAD^') === initial.head &&
        git(proposed.root,'diff','--name-only',initial.head,proposed.head) === editable, 'Freeze one AR-3 hypothesis and one changed file.');
      ensure(safeText(p.labelJudge) !== safeText(p.builder) && p.heldout === 'reused', 'Record independent label ownership and the reused split.');
      const env = privateEnv(path.join(dir,'rt'));
      const deadline = Date.now() + 600000;
      const launch = (cwd,args) => {
        const remaining = deadline - Date.now(); ensure(remaining > 0, 'Offline trial exceeded ten minutes.');
        return spawnSync(process.execPath,args,{cwd,env,timeout:remaining,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      };
      const score = (cwd,split) => {
        // Import only the pinned pure scorer. Its historical CLI writes to a shared absolute path.
        const code = `import {score} from './${evaluator}'; import t from './${editable}'; console.log(score(t.normalizeNumbers,'${split}').score)`;
        const r = launch(cwd,['--input-type=module','-e',code]);
        ensure(r.status === 0 && r.stdout.trim() && Number.isFinite(Number(r.stdout)), 'Offline scorer failed.');
        return Number(r.stdout);
      };
      for (const tree of [initial,proposed]) {
        ensure([evaluator,...guards].every((f,i)=>git(tree.root,'rev-parse','HEAD:' + f) === pins[i]), 'Frozen AR-3 helper or guard changed.');
      }
      const scores = [score(initial.root,'dev'),score(initial.root,'dev')];
      receipt.baseline = Math.max(...scores); receipt.noise = Math.abs(scores[0]-scores[1]);
      receipt.dev = score(proposed.root,'dev');
      receipt.guards = [initial,proposed].map(t=>launch(t.root,['node_modules/vitest/vitest.mjs','run',...guards]).status);
      receipt.heldout = [score(initial.root,'heldout'),score(proposed.root,'heldout')];
      ensure(inspect(initial.root).head === initial.head && inspect(proposed.root).head === proposed.head,'Offline inputs changed during evaluation.');
      receipt.result = decideTrial(receipt.baseline,receipt.dev,receipt.noise,receipt.guards.every(x=>x===0),receipt.heldout[1]-receipt.heldout[0]);
      receipt.heldoutStatus = 'reused; independent new labels required before generalization';
    } catch (error) {
      receipt.result = 'invalid'; throw error;
    } finally {
      receipt.ended = now(); save(file,receipt);
      // Derive the ledger from atomic daily receipts so recovery never appends an effect twice.
      const rows = fs.readdirSync(dir).filter(f=>/^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().map(f=>json(path.join(dir,f)));
      fs.writeFileSync(path.join(dir,'results.tsv'),['date\tbase\tcandidate\tbaseline\tdev\tnoise\tguards\tstatus',
        ...rows.map(r=>[r.started,r.base,r.candidate,r.baseline,r.dev,r.noise,r.guards,r.result].join('\t'))].join('\n') + '\n');
      pause(receipt,'One trial per prepared proposal. Review before integration.',file);
    }
    return json(last);
  });
}
