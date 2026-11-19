import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import Ajv from 'ajv';
import { prepareReplay, verifyReplay } from '../release/review-packet.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { parse, stakes, ticketCard } from './plan.mjs';
import { checkWindowsVolumes, hash, inspect, json, save, withLock } from './worktree.mjs';
import { observeSlice, select } from './factory.mjs';
import { actor, checkPackage, getReport, reserve, review } from './review.mjs';
import { reviewerKey, startProgress } from './dispatch.mjs';
import { packet, ready, route } from './brief.mjs';
import { ensureDependencies, gateNames, privateEnv, runGates } from './gates.mjs';
import { tmpRoot } from '../../apps/desktop/test-tmp';
import { daily, decideTrial } from './offline.mjs';

const source = process.cwd();
const lab = tmpRoot('factory');
const clone = path.join(lab,'clone'), tree = path.join(lab,'ticket tree');
const git = (cwd: string, ...args: string[]) => execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();
const fixture = 'N-08-PRACTICE';
const marker = 'synthetic-secret-value-123456';
// The synthetic CLI needs Git. Keep host PowerShell app discovery off its Windows PATH.
const cliPath = process.platform === 'win32'
  ? process.env.PATH!.split(path.delimiter).filter(dir => fs.existsSync(path.join(dir,'git.exe'))).join(path.delimiter)
  : process.env.PATH;
// Only the live keyed-plan fixture needs a stand-in for the installed desktop package.
const keyedPlanEntry = ['--input-type=module','-e',`
    import {run} from './tools/factory/factory.mjs';
    import {parse} from './tools/factory/plan.mjs';
    try { await run(parse(process.argv.slice(1)), () => process.execPath); }
    catch (error) { console.error('HOLD: ' + error.message); process.exitCode = 1; }
  `,'--'];
const command = (verb: string, ...args: string[]) => spawnSync(process.execPath,[
  ...(verb === 'plan' && process.env.FACTORY_TEST_CREDENTIAL ? keyedPlanEntry : ['tools/factory/factory.mjs']),verb,...args],{
  cwd: tree, encoding:'utf8',timeout:30000,windowsHide:true,env:{...privateEnv(path.join(lab,'runtime')), PATH:cliPath, GH_TOKEN:marker,
    NODE_ENV:'test', FILOW_FACTORY_ALLOW_ANY_VOLUME:'1',npm_execpath:path.join(lab,'install.cjs'),
    CODEX_API_KEY:process.env.FACTORY_TEST_CREDENTIAL || '',OPENROUTER_API_KEY:process.env.FACTORY_TEST_CREDENTIAL || ''},
});

beforeEach(() => {
  vi.stubEnv('FILOW_FACTORY_ENV','');
  vi.stubEnv('FILOW_CODEX_HOME','');
});
afterEach(()=>vi.unstubAllEnvs());

beforeAll(() => {
  fs.mkdirSync(clone);
  git(clone,'init','-b','main');
  git(clone,'config','user.name','Practice');
  git(clone,'config','user.email','practice@example.invalid');
  const files = ['.github/workflows/desktop.yml','docs/factory/BRIEF-TEMPLATE.md','docs/REVIEW.md','docs/PLAN.md','docs/METHODOLOGY.md','HANDOFF.md',
    'packages/core/src/i18n/en.ts','apps/web/app/tour/page.tsx','tools/factory/N-08-PRACTICE.json',
    ...fs.readdirSync(path.join(source,'tools/factory')).filter(f=>f.endsWith('.mjs') || f.endsWith('.schema.json')).map(f=>'tools/factory/'+f)];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(clone,f)),{recursive:true});
    fs.copyFileSync(path.join(source,f),path.join(clone,f));
  }
  fs.writeFileSync(path.join(clone,'.gitignore'),'node_modules/\n');
  save(path.join(clone,'package-lock.json'),{});
  fs.writeFileSync(path.join(lab,'install.cjs'),`
    const fs = require('node:fs');
    for (const file of ['electron/install.js','vitest/vitest.mjs']) {
      const target = 'node_modules/' + file;
      fs.mkdirSync(require('node:path').dirname(target),{recursive:true}); fs.writeFileSync(target,'');
    }
    fs.appendFileSync('node_modules/install-count','1');
  `);
  git(clone,'add','.'); git(clone,'commit','-qm','Synthetic base');
  git(clone,'worktree','add','-qb','practice/tour',tree);
});
afterAll(() => fs.rmSync(lab,{recursive:true,force:true}));

it('parses a quoted request, exact SHA and strict verb-specific options', () => {
  expect(parse(['plan','Save practice','--dry-run'])).toMatchObject({target:'Save practice',dry:true});
  expect(parse(['verify','N-05','--candidate','a'.repeat(40)]).candidate).toHaveLength(40);
  for (const args of [['release','N-05'],['build'],['plan','N-05','B'],['plan','N-05','--push'],['verify','N-05','--candidate','HEAD'],
    ['build','N-05','--card','x'],['plan','N-05','--card'],['plan','N-05','--dry-run','--dry-run']]) expect(()=>parse(args)).toThrow();
});
it('routes the highest actual stakes, including translated consent and a new destination', () => {
  expect(stakes('Spelling typo',['docs/setup.md']).level).toBe('Light');
  expect(stakes('Local list retry',['src/list.js']).level).toBe('Medium');
  expect(stakes('Typo',['packages/core/src/i18n/it.ts'],'"consent.allow": "Consenti"').level).toBe('Heavy');
  expect(stakes('Layout',['tour.css'],'url(https://example.invalid/x)').level).toBe('Heavy');
  expect(stakes('unknown boundary').level).toBe('Heavy');
  expect(route('Heavy','Builder')).toMatchObject({model:'gpt-6.2-astra',effort:'xhigh'});
  expect(route('Medium','Reviewer, replay').provider).not.toBe(route('Medium','Builder').provider);
});
it('refuses plain clones, detached trees, untracked and staged edits', () => {
  expect(()=>inspect(lab)).toThrow(); expect(()=>inspect(clone)).toThrow(/linked worktree/);
  expect(inspect(tree).branch).toBe('practice/tour');
  const f = path.join(tree,'note.txt'); fs.writeFileSync(f,'keep me');
  expect(()=>inspect(tree)).toThrow(/Dirty/); git(tree,'add','note.txt'); expect(()=>inspect(tree)).toThrow(/Dirty/);
  expect(fs.readFileSync(f,'utf8')).toBe('keep me');
  git(tree,'restore','--staged','note.txt'); fs.unlinkSync(f);
  git(tree,'switch','--detach','-q'); expect(()=>inspect(tree)).toThrow(/branch/); git(tree,'switch','-q','practice/tour');
});
it('resolves practice, plan titles and two competing run IDs', () => {
  expect(ticketCard(tree,'save practice').ticket).toBe(fixture);
  expect(ticketCard(tree,'Use tomorrow’s list for real').ticket).toBe('N-05');
  expect(ticketCard(tree,'Let me sort tomorrow by classroom').ticket).toMatch(/^REQUEST-/);
  const runs = ['1','2'].map(run=>({run,ticket:'N-05',branch:run}));
  expect(()=>select(runs,'N-05','1','build')).toThrow(/1, 2/);
  expect(select(runs,'2','2','build')).toBe(runs[1]);
});
it('locks simultaneous writers and reuses a dispatch slot across restarts', async () => {
  await withLock(lab,async()=>{ await expect(withLock(lab,()=>{})).rejects.toThrow(/lock/); });
  await withLock(lab,()=>{});
  const ledger = path.join(lab,'rounds.json');
  for(const id of ['a','a','b','c']) reserve(ledger,id,'candidate');
  expect(json(ledger)).toHaveLength(3);
  expect(()=>reserve(ledger,'d','changed candidate')).toThrow(/Three review/);
});
it('rejects missing providers and reused sessions without exposing their credentials', () => {
  expect(ready('OpenAI',{})).toBe(false);
  expect(ready('OpenAI',{CODEX_API_KEY:marker},process.execPath,path.join(lab,'probe'))).toBe(true);
  expect(ready('Google',{OPENAI_API_KEY:marker})).toBe(false);
  expect(ready('Google',{OPENROUTER_API_KEY:marker})).toBe(true);
  expect(privateEnv(lab)).not.toHaveProperty('GH_TOKEN');
  const identity = {...route('Light','Judge'),session:'same'};
  expect(()=>actor(identity,identity,[identity])).toThrow(/fresh/);
});
it('checks only the reviewer credential from the explicitly named dotenv file', () => {
  const file = path.join(lab,'operator environment');
  const env = { FILOW_FACTORY_ENV:file };
  expect(ready('Google',env)).toBe(false);
  fs.writeFileSync(file,'OPENAI_API_KEY=irrelevant\nOPENROUTER_API_KEY="   "');
  expect(ready('Google',env)).toBe(false);
  fs.writeFileSync(file,'export OPENROUTER_API_KEY="fixture#key" # reviewer\nEXTRA=ignored');
  expect(ready('Google',env)).toBe(true);
  fs.unlinkSync(file);
  expect(ready('Google',{...env, OPENROUTER_API_KEY:marker})).toBe(true);
});

it('reads each dotenv assignment independently and ignores malformed overrides', () => {
  const file = path.join(lab,'messy.env');
  for (const quote of ["'", '"']) {
    fs.writeFileSync(file, ["\uFEFF# operator's file", "BAD='unterminated", 'not an assignment',
      'export OPENROUTER_API_KEY=' + quote + 'quoted#fixture' + quote + ' # current',
      'OPENROUTER_API_KEY="incomplete', 'OPENROUTER_API_KEY="bad" trailing junk'].join('\r\n'));
    expect(reviewerKey({FILOW_FACTORY_ENV:file})).toBe('quoted#fixture');
    fs.writeFileSync(file,'\uFEFFexport OPENROUTER_API_KEY=first # comment');
    expect(reviewerKey({FILOW_FACTORY_ENV:file})).toBe('first');
  }
});

it('announces the live log and records elapsed dispatch time every 30 seconds', () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  try {
    const file = path.join(lab,'heartbeat.log');
    const finish = startProgress('Coordinator',file);
    expect(log.mock.calls.flat().join('\n')).toContain(file);
    vi.advanceTimersByTime(29999);
    expect(log.mock.calls).toHaveLength(1);
    vi.advanceTimersByTime(30001);
    finish(17);
    for (const elapsed of ['30s','60s']) {
      expect(log.mock.calls.flat().some(line=>String(line).includes('Coordinator') && String(line).includes(elapsed))).toBe(true);
      expect(fs.readFileSync(file,'utf8')).toContain(elapsed);
    }
    const count = log.mock.calls.length;
    vi.advanceTimersByTime(30000);
    expect(log.mock.calls.length).toBe(count);
  } finally { vi.useRealTimers(); log.mockRestore(); }
});

it('describes a configured rehearsal packet without issuing a dispatch', () => {
  const folder = path.join(lab,'configured rehearsal');
  vi.stubEnv('CODEX_API_KEY',marker);
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  try {
    packet(packetState(),'Builder',folder,'Practice.',path.join(folder,'report.json'),()=>process.execPath);
    const lines = log.mock.calls.flat().join('\n');
    expect(lines).toMatch(/DRY RUN.*would.*Builder/i);
    expect(lines).not.toMatch(/powershell\.exe|dispatch\.ps1/i);
    expect(fs.existsSync(path.join(folder,'dispatch.ps1'))).toBe(false);
  } finally { log.mockRestore(); }
});

it('generates a read-only coordinator dispatch with an active Windows sandbox', () => {
  const folder = path.join(lab,'coordinator sandbox');
  vi.stubEnv('CODEX_API_KEY',marker);
  onTestFinished(()=>vi.unstubAllEnvs());
  packet(packetState(false),'Coordinator',folder,'Check the worktree HEAD.',path.join(folder,'card.json'),()=>process.execPath);
  const script = fs.readFileSync(path.join(folder,'dispatch.ps1'),'utf8');
  expect(script).toContain("'-s' 'read-only'");
  expect(script).toContain("'-c' 'windows.sandbox=unelevated'");
});

it('preflights the coordinator and withholds its command when login status fails', () => {
  const folder = path.join(lab,'blocked coordinator');
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  try {
    vi.stubEnv('CODEX_API_KEY',''); vi.stubEnv('OPENAI_API_KEY','');
    vi.stubEnv('CODEX_HOME',path.join(lab,'signed out'));
    expect(()=>packet({...packetState(),dry:false},'Coordinator',folder,'Scope N-01.',
      path.join(folder,'card.json'),()=>process.execPath)).toThrow(/codex login/i);
    expect(log.mock.calls.flat().join('\n')).not.toContain('dispatch.ps1');
    expect(fs.existsSync(path.join(folder,'dispatch.ps1'))).toBe(false);
  } finally { log.mockRestore(); vi.unstubAllEnvs(); }
});

it('points both later verbs back to the blocked coordinator dispatch', () => {
  const plan = command('plan','N-01');
  const file = plan.stdout.match(/State: ([^\r\n]+)/)![1];
  for (const verb of ['build','verify']) {
    const result = command(verb,json(file).run);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/HOLD: .*coordinator dispatch/i);
    expect(json(file).diagnostic).toMatch(/coordinator dispatch/i);
  }
},60000); // Three separate invocations acquire the real run locks.

it('sets up dependencies after a green preflight and reuses only a matching install', () => {
  const root = path.join(lab,'setup'), lock = path.join(root,'package-lock.json');
  fs.mkdirSync(root);
  const install = vi.fn(()=>{
    for (const name of ['electron/install.js','vitest/vitest.mjs']) {
      const file = path.join(root,'node_modules',name);
      fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,'');
    }
    return 0;
  });
  fs.writeFileSync(lock,'first');
  const setup = () => ensureDependencies(root,lab,install);
  setup(); setup();
  expect(install).toHaveBeenCalledTimes(1);
  fs.writeFileSync(lock,'second');
  install.mockImplementationOnce(()=>1);
  expect(setup).toThrow(/npm ci/i);
  setup(); setup();
  expect(install).toHaveBeenCalledTimes(3);
  const guide = fs.readFileSync(path.join(source,'docs/GUIDE-START-HERE.md'),'utf8');
  expect(guide.slice(0,guide.indexOf('### Practice ticket'))).not.toMatch(/^\s*npm\.cmd ci/m);
});

it('walks N-01 from the coordinator dispatch to the scoped card in the same run', () => {
  const guide = fs.readFileSync(path.join(source,'docs/GUIDE-START-HERE.md'),'utf8');
  const example = guide.match(/^### [^\n]*N-01[^\n]*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m)?.[1];
  expect(example).toBeDefined();
  expect(example).toContain('filow:plan -- N-01');
  expect(example).toMatch(/coordinator/i);
  expect(example).toContain('dispatch.ps1');
  expect(example).toMatch(/filow:plan -- \$run --card/);
});

it('withholds noise, guard failures and overfit in a bounded offline trial', () => {
  expect(decideTrial(80,81,1,true,2)).toBe('discard');
  expect(decideTrial(80,82,1,false,2)).toBe('discard');
  expect(decideTrial(80,82,1,true,-1)).toBe('overfit');
  expect(decideTrial(80,82,1,true,0)).toBe('keep');
});
it('rechecks the actual package bytes when an approved receipt is resumed', async () => {
  const file = path.join(lab,'fixture-package');
  fs.writeFileSync(file,'original');
  const digest = createHash('sha512').update('original').digest('hex');
  await checkPackage(file,digest);
  fs.writeFileSync(file,'replacement');
  await expect(checkPackage(file,digest)).rejects.toThrow(/changed/);
});
it('resumes the exact live plan after a missing-provider hold without saving the configured secret', () => {
  try {
    vi.stubEnv('FACTORY_TEST_CREDENTIAL','');
    const missing = command('plan',fixture);
    expect(missing.status).toBe(1); expect(missing.stderr).toContain('Provider preflight incomplete');
    const file = missing.stdout.match(/State: ([^\r\n]+)/)![1];
    vi.stubEnv('FACTORY_TEST_CREDENTIAL',marker);
    const installs = path.join(tree,'node_modules/install-count');
    expect(fs.existsSync(installs)).toBe(false);
    const configured = command('plan',json(file).run);
    expect(configured.status,configured.stderr).toBe(0);
    expect(command('plan',json(file).run).status).toBe(0);
    expect(fs.readFileSync(installs,'utf8')).toBe('1');
    expect(json(file).readiness).toEqual({builder:true,reviewer:true});
    expect(configured.stdout + fs.readFileSync(file,'utf8')).not.toContain(marker);
  } finally { vi.unstubAllEnvs(); }
},60000); // Runs a blocked plan and resumes twice across process boundaries.
it('seals the blind case before exposing the candidate and refuses a stale replay or missing judge', async () => {
  const dir = path.join(lab,'independent'), ledger = path.join(dir,'ledger.json');
  const t = inspect(tree), card = ticketCard(tree,fixture);
  const state:any = {run:'test-run',ticket:fixture,root:tree,branch:t.branch,base:t.head,candidate:t.head,card,
    risk:{level:'Medium',reason:card.reason},builder:{session:'builder'},gate:{receipts:[]}};
  const verify = () => review(state,dir,ledger,{},()=>{},()=>process.execPath);
  try {
    vi.stubEnv('OPENROUTER_API_KEY','');
    await expect(verify()).rejects.toThrow(/reviewer unavailable[^\n]*OPENROUTER_API_KEY[^\n]*FILOW_FACTORY_ENV/);
    expect(fs.existsSync(ledger)).toBe(false);
    vi.stubEnv('OPENROUTER_API_KEY',marker);
    await expect(verify()).rejects.toThrow(/Awaiting blind/);
    const root = path.join(dir,state.round.id);
    const brief = fs.readFileSync(path.join(root,'blind','brief.md'),'utf8');
    expect(brief).not.toContain(t.head); expect(brief).not.toContain(tree); expect(brief).not.toContain(marker);
    const reviewer = {provider:'Google',model:'google/gemini-4-carbon',effort:'high'};
    save(path.join(root,'blind','report.json'),{...reviewer,session:'blind',assignment:state.round.packets.blind,case:'Double press Enter.',expected:'One confirmation.'});
    await expect(verify()).rejects.toThrow(/Awaiting replay/);
    const file = path.join(root,'replay','report.json');
    const replay = {...reviewer,session:'replay',assignment:state.round.packets.replay,caseDigest:state.round.blind.digest,
      candidate:'a'.repeat(40),verdict:'PASS',findings:[],observations:Array(4+card.checks.length).fill('Recorded fixture observation.')};
    save(file,replay); await expect(verify()).rejects.toThrow(/stale/);
    vi.stubEnv('CODEX_API_KEY',''); vi.stubEnv('OPENAI_API_KEY','');
    save(file,{...replay,candidate:t.head}); await expect(verify()).rejects.toThrow(/Judge dispatch unavailable/);
    expect(json(ledger)).toHaveLength(1);
    expect(state.failedCandidate).toBeUndefined();
    vi.stubEnv('CODEX_API_KEY',marker);
    await expect(verify()).rejects.toThrow(/Awaiting judge/);
    save(path.join(root,'judge','report.json'),{...route('Medium','Judge'),session:'judge',
      assignment:state.round.packets.judge,candidate:t.head,caseDigest:state.round.blind.digest,
      verdict:'HOLD',findings:['A second click duplicates the confirmation.']});
    await expect(verify()).rejects.toThrow(/Review is on HOLD/);
    expect(state).toMatchObject({failedCandidate:t.head,round:{closed:true}});
  } finally { vi.unstubAllEnvs(); }
});
it('keeps a Light review slot available when the Codex login is missing', async () => {
  const dir = path.join(lab,'light-signed-out'), ledger = path.join(dir,'ledger.json');
  vi.stubEnv('CODEX_API_KEY',''); vi.stubEnv('OPENAI_API_KEY','');
  try {
    const state = {...packetState(),dry:false,gate:{receipts:[]}};
    await expect(review(state,dir,ledger,{},()=>{},()=>process.execPath)).rejects.toThrow(/codex login/i);
    expect(fs.existsSync(ledger)).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});

it('takes all three public verbs through a dry run, repeats build in another process and leaves one private run', () => {
  const before = inspect(tree);
  const plan = command('plan',fixture,'--dry-run');
  expect(plan.status,plan.stderr).toBe(0);
  expect(plan.stdout).toMatch(/Reviewer Google.*google\/gemini-4-carbon.*OpenRouter/);
  const file = plan.stdout.match(/State: ([^\r\n]+)/)![1];
  const id = json(file).run;
  expect(command('build',fixture,'--dry-run').status).toBe(0);
  expect(command('build',id,'--dry-run').status).toBe(0);
  const stale = command('verify',id,'--dry-run','--candidate','a'.repeat(40));
  expect(stale.status).toBe(1); expect(stale.stderr).toContain('Stale');
  const verify = command('verify',fixture,'--dry-run','--candidate',before.head);
  expect(verify.status).toBe(0); expect(verify.stdout).toContain('local verdict HOLD');
  const state = json(file);
  expect(state).toMatchObject({candidate:before.head,verdict:'HOLD',step:'rehearsed',run:id});
  expect(fs.readdirSync(path.dirname(path.dirname(file)))).toEqual([id]);
  expect(inspect(tree)).toEqual(before);
  const files = [file,path.join(path.dirname(file),'builder','brief.md')];
  for (const f of files) expect(fs.readFileSync(f,'utf8')).not.toContain(marker);
  const brief = fs.readFileSync(files[1],'utf8');
  expect(brief.indexOf('R16 (')).toBeLessThan(brief.indexOf('# Factory brief'));
  expect(brief).toContain('gpt-6.2-sol'); expect(brief).not.toContain('<PLAN ticket ID>');
  expect(brief).not.toContain('**Reviewer, replay.**');
},120000); // Exercises all three CLI verbs and a real process restart.
it('reconciles an already committed slice once and preserves unexplained effects', () => {
  const base = inspect(tree), card = ticketCard(tree,fixture);
  const state = {base:base.head,card,ticket:fixture,run:'run-test'};
  fs.appendFileSync(path.join(tree,card.paths[0]),'\n');
  git(tree,'add',card.paths[0]); git(tree,'commit','-qm',fixture+' Change practice','-m','Give the learner a next step.\n\nFactory-Run: run-test');
  for(let i=0;i<2;i++) expect(observeSlice(inspect(tree),state)).toEqual([card.paths[0]]);
  expect(git(tree,'rev-list','--count',base.head+'..HEAD')).toBe('1');
  expect(()=>observeSlice(inspect(tree),{...state,run:'other'})).toThrow(/Unexplained/);
});
it('a stale green plus a failed launch holds and stops before the next gate', () => {
  const {head} = inspect(tree), dir = path.join(lab,'gate');
  const electron = path.join(tree,'node_modules/electron/install.js');
  fs.mkdirSync(path.dirname(electron),{recursive:true}); fs.writeFileSync(electron,'');
  const state:any = {root:tree,candidate:head,verdict:'PASS',gate:{phase:'build',sha:'old',status:'green',receipts:[]}};
  const disk = path.join(dir,'run.json');
  const calls:string[] = [];
  const launch = (name:string) => { calls.push(name); return name==='vitest' ? null : 0; };
  expect(()=>runGates(state,dir,'verify',()=>save(disk,state),false,launch)).toThrow(/Gate failed: vitest/);
  expect(json(disk)).toMatchObject({verdict:'HOLD',firstFailure:{exit:null,sha:head},gate:{status:'failed'}});
  expect(calls).toEqual(gateNames.slice(0,4));
  expect(()=>runGates(state,dir,'verify',()=>{},false,launch)).toThrow(/gate is red/);
  const green = structuredClone(state.gate.receipts);
  const retried:string[] = [];
  runGates(state,dir,'verify',()=>save(disk,state),true,(name:string)=>{
    expect(json(disk).gate.status).toBe('running');
    retried.push(name); return 0;
  });
  expect(retried).toEqual(gateNames.slice(3));
  expect(state.gate.receipts.slice(0,3)).toEqual(green);
  expect(state.failedCandidate).toBeUndefined();
  expect(json(disk).gate.receipts).toHaveLength(gateNames.length);
  const completed = json(disk).gate.receipts[0];
  const saved = json(completed.path);
  const interrupted = {...json(disk),intent:saved,gate:{phase:'verify',sha:head,status:'running',receipts:[]}};
  const resumed:string[] = [];
  runGates(interrupted,dir,'verify',()=>{},false,(name:string)=>{resumed.push(name);return 0;});
  expect(resumed).toEqual(gateNames.slice(1));
  expect(interrupted.gate.receipts[0]).toEqual(completed);
});

function packetState(dry = true) {
  const t = inspect(tree);
  return {root:tree, branch:t.branch, base:t.head, candidate:t.head, run:'round-one', ticket:fixture,
    card:ticketCard(tree,fixture), risk:{level:'Light',reason:'Practice'}, dry};
}

it('prints the isolated Windows command and preserves both native exit codes after stderr', () => {
  const folder = path.join(lab,"dispatch d'été"), out = path.join(folder,'reply.json');
  fs.mkdirSync(folder);
  const exe = path.join(folder,'codex.exe');
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  try {
    if (process.platform !== 'win32') return;
    const cs = path.join(folder,'Fake.cs');
    fs.writeFileSync(cs, `using System;
using System.IO;
class Fake {
  static int Main(string[] args) {
    string home = Environment.GetEnvironmentVariable("CODEX_HOME");
    bool key = !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("CODEX_API_KEY"));
    bool login = File.Exists(Path.Combine(home, "synthetic-login"));
    if (Environment.GetEnvironmentVariable("UNRELATED_SECRET") != null) return 38;
    if (args[0] == "login" && args[1] == "status") {
      Console.Error.WriteLine(login ? "Logged in using ChatGPT" : "Not logged in");
      if (login) File.WriteAllText(Path.Combine(home, "probed"), "yes");
      return login ? 0 : 1;
    }
    string reviewer = Environment.GetEnvironmentVariable("OPENROUTER_API_KEY");
    if (Environment.GetEnvironmentVariable("FILOW_FACTORY_ENV") != null ||
        Environment.GetEnvironmentVariable("UNRELATED_FILE_VALUE") != null) return 41;
    if (reviewer != null) {
      if (key || login || reviewer != "rotated#fixture") return 42;
    } else if (key == login) return 39;
    Console.InputEncoding = new System.Text.UTF8Encoding(false);
    Console.Error.WriteLine("synthetic private progress");
    Console.WriteLine(@"{""type"":""turn.started"",""private"":""private-file-marker""}");
    int schema = Array.IndexOf(args, "--output-schema");
    if (schema < 0 || !File.Exists(args[schema + 1])) return 23;
    string output = args[Array.IndexOf(args, "-o") + 1];
    if (File.Exists(output)) return 17;
    File.WriteAllText(output, Console.In.ReadToEnd());
    return 0;
  }
}`);
    const compiler = path.join(process.env.SystemRoot!,'Microsoft.NET','Framework','v4.0.30319','csc.exe');
    execFileSync(compiler,['/nologo','/out:'+exe,cs],{cwd:folder});
    vi.stubEnv('CODEX_API_KEY',''); vi.stubEnv('OPENAI_API_KEY','');
    vi.stubEnv('CODEX_HOME',folder); vi.stubEnv('UNRELATED_SECRET',marker);
    fs.writeFileSync(path.join(folder,'synthetic-login'),'');
    packet(packetState(false),'Builder',folder,'A synthetic assignment.',out,()=>exe);
    const commandLine = log.mock.calls.map(args=>String(args[0])).find(line=>line.startsWith('powershell.exe '));
    const script = path.join(folder,'dispatch.ps1');
    expect(commandLine).toBe("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '" + script.replaceAll("'","''") + "'");
    const body = fs.readFileSync(script,'utf8');
    expect(body).toContain("'--json'");
    expect(body).toContain(exe.replaceAll("'","''"));
    expect(fs.existsSync(path.join(folder,'probed'))).toBe(true);
    const launch = () => spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',commandLine + '\nexit $LASTEXITCODE'],{
      cwd:folder,encoding:'utf8',env:process.env,timeout:30000,windowsHide:true});
    const success = launch();
    expect(success.status,success.stderr).toBe(0);
    expect(success.stdout).toContain('dispatch.log');
    expect(fs.readFileSync(path.join(folder,'dispatch.log'),'utf8')).toContain('turn.started');
    expect(fs.readFileSync(path.join(folder,'dispatch.log'),'utf8')).toMatch(/Builder.*exit 0/);
    expect(fs.readFileSync(out,'utf8')).toContain("dispatch d'été");
    const profile = path.join(lab,'operator profile'), defaultHome = path.join(profile,'.codex');
    fs.mkdirSync(defaultHome,{recursive:true});
    fs.writeFileSync(path.join(defaultHome,'synthetic-login'),'');
    vi.stubEnv('USERPROFILE',profile);
    vi.stubEnv('CODEX_HOME','');
    expect(ready('OpenAI',process.env,exe,path.join(lab,'default probe'))).toBe(true);
    expect(fs.existsSync(path.join(defaultHome,'probed'))).toBe(true);
    fs.unlinkSync(out);
    expect(launch().status).toBe(0);
    vi.stubEnv('FILOW_CODEX_HOME',folder);
    vi.stubEnv('CODEX_HOME',path.join(lab,'wrong home'));
    expect(ready('OpenAI',process.env,exe,path.join(lab,'override probe'))).toBe(true);
    fs.unlinkSync(out);
    expect(launch().status).toBe(0);
    vi.stubEnv('OPENAI_API_KEY',marker);
    fs.unlinkSync(out);
    expect(launch().status).toBe(0);
    const failure = launch();
    expect(failure.status,failure.stderr).toBe(17);
    expect(failure.stdout).toContain('HOLD');
    expect(success.stderr + success.stdout + failure.stderr + failure.stdout).not.toContain('synthetic private progress');
    const dotenv = path.join(lab,'credentials outside the packet.env');
    const reviewer = path.join(lab,'reviewer dispatch'), reply = path.join(reviewer,'reply.json');
    fs.writeFileSync(dotenv,'OPENROUTER_API_KEY=original-reviewer-marker');
    vi.stubEnv('OPENROUTER_API_KEY','');
    vi.stubEnv('FILOW_FACTORY_ENV',dotenv);
    log.mockClear();
    const state = {...packetState(false),risk:{level:'Heavy',reason:'Independent review'}};
    packet(state,'Reviewer, blind case',reviewer,'Independent case.',reply,()=>exe);
    const reviewerCommand = log.mock.calls.flat().find(line=>String(line).startsWith('powershell.exe '));
    expect(reviewerCommand).toBeTruthy();
    expect(fs.readFileSync(path.join(reviewer,'dispatch.ps1'),'utf8')).toContain("'-m' 'google/gemini-4-carbon'");
    fs.writeFileSync(dotenv,'OPENROUTER_API_KEY="rotated#fixture" # new value\nUNRELATED_FILE_VALUE=private-file-marker');
    const dispatched = spawnSync('powershell.exe',['-NoProfile','-Command',reviewerCommand+'\nexit $LASTEXITCODE'],
      {encoding:'utf8',cwd:lab,timeout:30000,windowsHide:true});
    expect(dispatched.status,dispatched.stderr).toBe(0);
    expect(fs.existsSync(reply)).toBe(true);
    const saved = fs.readdirSync(reviewer,{recursive:true,encoding:'utf8'})
      .map(name=>path.join(reviewer,name)).filter(file=>fs.statSync(file).isFile())
      .map(file=>fs.readFileSync(file,'utf8')).join('\n');
    expect(saved+dispatched.stdout+dispatched.stderr+log.mock.calls.flat().join('\n'))
      .not.toMatch(/original-reviewer-marker|rotated#fixture|private-file-marker|synthetic-secret-value/);
  } finally { log.mockRestore(); vi.unstubAllEnvs(); }
},60000); // Compiles and runs a native Windows CLI fixture.

it('gives each role its own section and the single raw object reply contract', () => {
  const roles = ['Coordinator','Builder','Reviewer, blind case','Reviewer, replay','Judge'];
  for (const role of roles) {
    const folder = path.join(lab,'packets',role);
    const result = packet(packetState(),role,folder,'Assignment fields.',path.join(folder,'reply.json'),()=>null);
    const brief = fs.readFileSync(result.brief,'utf8');
    expect(brief).toContain('**' + role + '.**');
    expect(brief.slice(brief.indexOf('Assignment fields.'))).toMatch(/exactly one raw JSON object and nothing else/i);
    for (const other of roles.filter(r=>r!==role)) expect(brief).not.toContain('**' + other + '.**');
    expect(brief).not.toContain('60 words');
  }
});

it('requires a usable coordinator card even for a ticket that only records evidence', () => {
  const validate = new Ajv().compile(json(path.join(source,'tools/factory/card.schema.json')));
  const card = {...ticketCard(tree,fixture),ticket:'N-01',bugFix:false,paths:['HANDOFF.md'],callers:['.github/workflows/desktop.yml']};
  expect(validate(card)).toBe(true);
  expect(validate({...card,paths:[]})).toBe(false);
  expect(validate({...card,callers:['The workflow calls Vitest.']})).toBe(false);
});

it('accepts a tracked GitHub workflow as an N-01 caller while protecting repository metadata', () => {
  const file = path.join(lab,'n01-card.json'), workflow = '.github/workflows/desktop.yml';
  const card = {...ticketCard(tree,fixture),ticket:'N-01',paths:['HANDOFF.md'],callers:[workflow]};
  save(file,card);
  expect(ticketCard(tree,'N-01',file).callers).toEqual([workflow]);
  for (const entry of ['.git/config','.github/../.git/config','.github/.env','.Git/config']) {
    save(file,{...card,callers:[entry]});
    expect(()=>ticketCard(tree,'N-01',file)).toThrow(/literal repository file paths/);
  }
  save(file,{...card,paths:[workflow]});
  expect(()=>ticketCard(tree,'N-01',file)).toThrow(/literal repository file paths/);
});

it('dispatches each JSON packet with the schema that accepts its receipt', () => {
  const state = packetState(false);
  const actor = {provider:'OpenAI',model:'gpt-6.2-astra',effort:'high',session:'test'};
  const common = {assignment:'sealed',candidate:state.candidate,verdict:'PASS'};
  const report = {...actor,...common,caseDigest:'digest',findings:[],observations:['Matched the receipt.'],
    skillRevision:null,packagePath:null,packageSha512:null,os:null,device:null};
  const cases = [
    ['Coordinator','card',{...state.card,bugFix:false}], ['Builder','builder',{...actor,verdict:'COMMITTED',candidate:state.candidate,
      baseObservation:'Before',candidateObservation:'After',incident:null,expected:null,observed:null,affectedCommand:null,
      skillRevision:null,neighboringReplay:null}],
    ['Reviewer, blind case','blind',{...actor,assignment:'sealed',case:'input',expected:'result'}],
    ['Reviewer, replay','replay',report], ['Judge','replay',report],
  ] as const;
  const exe = () => process.execPath;
  vi.stubEnv('CODEX_API_KEY',marker); vi.stubEnv('OPENROUTER_API_KEY',marker);
  onTestFinished(()=>vi.unstubAllEnvs());
  const validateDispatch = (folder:string, schema:string, receipt:object, independent:boolean) => {
    const script = fs.readFileSync(path.join(folder,'dispatch.ps1'),'utf8');
    expect(script).toContain("'--output-schema' '" + schema.replaceAll("'","''") + "'");
    expect(script.includes('model_provider=openrouter')).toBe(independent);
    const check = new Ajv().compile(json(schema));
    expect(check(receipt),JSON.stringify(check.errors)).toBe(true);
    expect(check({})).toBe(false);
  };
  state.risk.level = 'Heavy';
  for (const [role,name,sample] of cases) {
    const folder = path.join(lab,'schema',role);
    packet(state,role,folder,'Receipt test.',path.join(folder,'reply.json'),exe);
    validateDispatch(folder,path.join(source,'tools/factory',name+'.schema.json'),sample,role.startsWith('Reviewer'));
  }
  const folder = path.join(lab,'release-review');
  fs.mkdirSync(folder);
  const brief = path.join(folder,'brief.md'), blind = path.join(folder,'blind.json'), file = path.join(folder,'report.json');
  fs.writeFileSync(brief,'Release replay'); save(blind,{case:'sealed'});
  const digest = hash(fs.readFileSync(blind));
  const receipt = {...common,blindDigest:digest,findings:[],missingEvidence:[]};
  prepareReplay(folder,brief,exe);
  validateDispatch(folder,path.join(source,'tools/release/replay.schema.json'),receipt,true);
  const verify = () => verifyReplay(file,common.assignment,common.candidate,blind,digest);
  save(file,receipt); expect(verify).not.toThrow();
  save(file,{...receipt,assignment:'stale'}); expect(verify).toThrow(/another assignment/);
  save(file,{...receipt,verdict:'HOLD'}); expect(verify).toThrow(/HOLD/);
  fs.writeFileSync(file,'Markdown preamble\n'+JSON.stringify(receipt)); expect(verify).toThrow();
});

it.each(['report','card'])('reads one optionally fenced %s object and gives a specific HOLD for other replies', kind => {
  const file = path.join(lab,kind+'.json');
  const practice = ticketCard(tree,fixture);
  const object = kind==='card' ? practice : {session:'test'};
  const parseFile = () => kind==='card' ? ticketCard(tree,fixture,file) : getReport(file);
  for (const fence of ['json','','JSON']) {
    fs.writeFileSync(file,['\ufeff```'+fence,JSON.stringify(object),'```',''].join('\r\n'));
    expect(parseFile()).toEqual(object);
  }
  for (const invalid of ['', 'null','[]','3','{} {}','preface\n{}','```json\n{}\n```\nextra','```\n```\n{}\n```\n```']) {
    fs.writeFileSync(file,invalid);
    expect(parseFile).toThrow(/one JSON object/i);
  }
});

it('accepts a bug-fix card with an implicit append-only grant', () => {
  const file = path.join(lab,'bug-card.json');
  save(file,{...ticketCard(tree,fixture),bugFix:true});
  expect(ticketCard(tree,fixture,file).bugFix).toBe(true);
});

function changeSlice(state:ReturnType<typeof packetState>, subject:string, rules?:string) {
  fs.appendFileSync(path.join(tree,state.card.paths[0]),'\n// Practice slice\n');
  if (rules !== undefined) fs.writeFileSync(path.join(tree,'docs/REVIEW.md'),rules);
  git(tree,'commit','-qam',fixture+' '+subject,'-m','Factory-Run: '+state.run);
  return inspect(tree);
}

function freshSlice() {
  const branch = git(tree,'branch','--show-current');
  git(tree,'switch','-qc','practice/'+randomUUID());
  onTestFinished(()=>{ git(tree,'switch','-q',branch); });
  return packetState();
}

it.each(['tracked','ignored','absent'])('runs the generation gate workers with a %s dictionary and keeps the checkout clean', kind => {
  const root = path.join(lab,'bundles-'+kind);
  git(clone,'worktree','add','-qb','bundles/'+kind,root);
  save(path.join(root,'package.json'),{private:true});
  git(root,'add','package.json');
  fs.copyFileSync(path.join(source,'.gitignore'),path.join(root,'.gitignore'));
  const vendor = path.join(root,'apps/desktop/vendor');
  fs.mkdirSync(vendor,{recursive:true});
  const dictionary = path.join(vendor,'i18n.js');
  const welcome = path.join(vendor,'welcome.js');
  fs.writeFileSync(welcome,'tracked welcome');
  if (kind !== 'absent') fs.writeFileSync(dictionary,'original dictionary');
  git(root,'add','-f','apps/desktop/vendor/welcome.js');
  if (kind === 'tracked') git(root,'add','-f','apps/desktop/vendor/i18n.js');
  git(root,'commit','-qam','Track fixture output');
  const before = inspect(root);
  const dir = path.join(lab,'bundle receipts '+kind);
  const install = path.join(root,'node_modules/electron/install.js');
  const vitest = path.join(root,'node_modules/vitest/vitest.mjs');
  for (const file of [install,vitest]) fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(install,'');
  fs.writeFileSync(vitest,"import fs from 'node:fs'; process.exitCode = Number(fs.existsSync('apps/desktop/vendor/i18n.js') || fs.readFileSync('apps/desktop/vendor/welcome.js','utf8') !== 'generated')");
  const npm = path.join(lab,'fixture-npm.cjs');
  fs.writeFileSync(npm,"if (['vendor','build:welcome'].includes(process.argv[3])) for (const file of ['i18n.js','welcome.js','profile.js']) require('node:fs').writeFileSync('apps/desktop/vendor/'+file,'generated')");
  vi.stubEnv('npm_execpath',npm);
  try {
    const state = {root,candidate:before.head};
    runGates(state,dir,'verify',()=>{},false);
    expect(inspect(root)).toEqual(before);
    expect(fs.readFileSync(welcome,'utf8')).toBe('tracked welcome');
    if (kind !== 'absent') expect(fs.readFileSync(dictionary,'utf8')).toBe('original dictionary');
  } finally { vi.unstubAllEnvs(); }
},120000); // Each dictionary case launches the seven real gate workers.

it('enforces Windows volume limits except for explicitly opted-in test processes', () => {
  const disk = vi.spyOn(fs,'statfsSync');
  try {
    vi.stubEnv('NODE_ENV','production');
    vi.stubEnv('FILOW_FACTORY_ALLOW_ANY_VOLUME','1');
    disk.mockReturnValue({bavail:21e9,bsize:1} as ReturnType<typeof fs.statfsSync>);
    const onC = () => checkWindowsVolumes('G:/factory','C:/worktree');
    expect(onC).toThrow(/outside C:/);
    expect(()=>checkWindowsVolumes('C:/factory','G:/worktree')).toThrow(/outside C:/);
    disk.mockReturnValue({bavail:19e9,bsize:1} as ReturnType<typeof fs.statfsSync>);
    expect(()=>checkWindowsVolumes('G:/factory','G:/worktree')).toThrow(/20 GB/);
    vi.stubEnv('NODE_ENV','test');
    vi.stubEnv('FILOW_FACTORY_ALLOW_ANY_VOLUME','');
    expect(onC).toThrow(/20 GB/);
    vi.stubEnv('FILOW_FACTORY_ALLOW_ANY_VOLUME','1');
    expect(onC).not.toThrow();
    expect(privateEnv(lab)).not.toHaveProperty('FILOW_FACTORY_ALLOW_ANY_VOLUME');
  } finally {
    disk.mockRestore(); vi.unstubAllEnvs();
  }
});

it('passes the Windows drive and machine name into isolated children', () => {
  try {
    vi.stubEnv('SystemDrive','C:');
    vi.stubEnv('COMPUTERNAME','FACTORY-TEST');
    const env = Object.fromEntries(Object.entries(privateEnv(lab)).map(([k,v])=>[k.toUpperCase(),v]));
    expect(env).toMatchObject({SYSTEMDRIVE:'C:',COMPUTERNAME:'FACTORY-TEST'});
  } finally { vi.unstubAllEnvs(); }
});

it.each(['duplicate','12 trials','four discards','today'])('persists the paused offline schedule for %s', async reason => {
  const home = path.join(lab,'schedule '+reason), dir = path.join(home,'offline');
  const file = path.join(dir,'schedule.json'), ended = '2026-01-15T10:00:00Z';
  const count = reason==='12 trials' ? 12 : reason==='four discards' ? 4 : 1;
  const today = new Date().toISOString().slice(0,10);
  for (let i=1;i<=count;i++) {
    const date = reason==='today' ? today : '2000-01-'+String(i).padStart(2,'0');
    save(path.join(dir,date+'.json'),{candidate:String(i),ended,result:reason==='four discards' ? 'discard' : 'keep'});
  }
  save(path.join(dir,'proposal.json'),{candidate:reason==='duplicate' ? '1' : 'next'});
  if (reason==='12 trials') save(file,{status:'blocked',next:'2000-01-01'});
  const schedule = await daily(home,clone);
  expect(schedule).toMatchObject({status:'paused',track:'AR-3',last:ended,reason:expect.any(String),
    next:new Date(Date.now()+86400000).toISOString().slice(0,10)});
  expect(json(file)).toEqual(schedule);
});

it.each([1,3])('checks the new-round allowance before touching a completed verify with %i slots used', used => {
  const state = freshSlice();
  vi.stubEnv('FACTORY_TEST_CREDENTIAL',marker);
  try {
    const plan = command('plan',fixture);
    const file = plan.stdout.match(/State: ([^\r\n]+)/)![1], dir = path.dirname(file);
    const saved = json(file), candidate = state.candidate;
    const ledger = path.join(path.dirname(path.dirname(dir)),'reviews',fixture+'.json');
    const rounds = Array.from({length:used},(_,i)=>({number:i+1,id:randomUUID(),candidate,verdict:'PASS'}));
    save(ledger,rounds);
    const builder = path.join(dir,'builder.json'); save(builder,{session:'author'});
    const gateState:any = {root:tree,candidate};
    const install = path.join(tree,'node_modules/electron/install.js');
    fs.mkdirSync(path.dirname(install),{recursive:true}); fs.writeFileSync(install,'');
    runGates(gateState,dir,'verify',()=>{},false,()=>0);
    const gate = gateState.gate;
    save(file,{...saved,step:'complete',candidate,verdict:'PASS',gate,buildEvidence:{...gate,phase:'build'},
      builder:{session:'author'},builderEvidence:{file:builder,digest:hash(fs.readFileSync(builder))},round:rounds.at(-1)});
    const result = command('verify',saved.run,'--new-round');
    // The synthetic CLI PATH intentionally excludes desktop app discovery.
    const missingCli = 'Install the Codex desktop app';
    expect(result.stderr).toContain(used===3 ? 'Three review rounds' : missingCli);
    expect(result.stdout).not.toContain('Running ');
    expect(json(file).gate).toEqual(gate);
    expect(json(file).failedCandidate).toBeUndefined();
    if (used===3) {
      expect(json(file)).toMatchObject({step:'complete',verdict:'PASS',round:rounds.at(-1)});
      expect(json(ledger)).toEqual(rounds);
    } else {
      const reserved = json(file).round.id;
      expect(command('verify',saved.run,'--new-round').stderr).toContain(missingCli);
      expect(json(file).round.id).toBe(reserved);
      expect(json(ledger)).toHaveLength(2);
    }
  } finally { vi.unstubAllEnvs(); }
},120000); // Resumes the saved verify through separate CLI processes.

it('starts the tour relative to the worktree from plan', () => {
  const guide = fs.readFileSync(path.join(source,'docs/GUIDE-START-HERE.md'),'utf8');
  expect(guide).toContain("Set-Location -LiteralPath (Join-Path $tree 'apps\\web')");
});

it('resumes a frozen pre-Coordinator template with the JSON reply contract', () => {
  const state = freshSlice();
  const file = path.join(tree,'docs/factory/BRIEF-TEMPLATE.md');
  const old = fs.readFileSync(file,'utf8').replace(/^\*\*Coordinator\.\*\*.*\r?\n/m,'')
    .replace(/^\*\*Report\.\*\*[\s\S]*/m,'**Report.** Reply in 60 words or fewer with the result, receipt location and any unverified claim.\n');
  fs.writeFileSync(file,old);
  git(tree,'commit','-qam','Freeze earlier template');
  state.base = git(tree,'rev-parse','HEAD');
  const folder = path.join(lab,'legacy-plan');
  const {brief} = packet(state,'Coordinator',folder,'Fill the card.',path.join(folder,'card.json'),()=>null);
  const contents = fs.readFileSync(brief,'utf8');
  expect(contents).toContain('**Coordinator.**');
  expect(contents).toMatch(/exactly one raw JSON object and nothing else/i);
  expect(contents).not.toContain('60 words');
});

it('accepts Fix in an ordinary feature subject and requires a rule only on the corrective slice', () => {
  const state = freshSlice();
  const first = changeSlice(state,'Fix practice wording');
  expect(observeSlice(first,state)).toEqual([state.card.paths[0]]);
  const corrected = changeSlice(state,'Handle the replay');
  for (const fault of [{round:{candidate:first.head,closed:true,findings:['Missing cue']}},
    {gate:{sha:first.head,status:'failed',failure:'vitest'}},
    {failedCandidate:first.head,round:{number:2,candidate:first.head}}]) {
    const failed = {...state,candidate:first.head,...fault};
    expect(()=>observeSlice(corrected,failed)).toThrow(/rule/i);
  }
});

it('checks new rule numbers and the exact prior text even with an explicit REVIEW grant', () => {
  const state = freshSlice(), file = path.join(tree,'docs/REVIEW.md');
  state.card.paths.push('docs/REVIEW.md');
  const previous = fs.readFileSync(file,'utf8');
  const number = 1 + Math.max(...Array.from(previous.matchAll(/^- R(\d+) /gm), m=>Number(m[1])));
  const rule = '- R'+number+' (2026-11-19, test): Keep receipt. Check: Repeat.\n';
  const changed = changeSlice(state,'Correct first finding',previous.replace('Every reviewer','Some reviewers') + rule);
  expect(()=>observeSlice(changed,{...state,card:{...state.card,bugFix:true}})).toThrow(/append/i);
  const other = packetState();
  const duplicate = changeSlice(other,'Correct second finding',fs.readFileSync(file,'utf8') + rule);
  expect(()=>observeSlice(duplicate,{...other,card:{...state.card,bugFix:true}})).toThrow(/R\d+/);
  const incomplete = packetState();
  const noCheck = changeSlice(incomplete,'Preserve progress',fs.readFileSync(file,'utf8') + '- R'+(number+1)+' (test): Preserve progress.\n');
  expect(()=>observeSlice(noCheck,incomplete)).toThrow(/Check/);
});

it('permits a same-commit rule outside the card and gives the candidate rules only to exposed roles', () => {
  const state = freshSlice(), first = changeSlice(state,'Show confirmation');
  const file = path.join(tree,'docs/REVIEW.md'), previous = fs.readFileSync(file,'utf8');
  const number = 1 + Math.max(...Array.from(previous.matchAll(/^- R(\d+) /gm), m=>Number(m[1])));
  const rule = '- R'+number+' (2026-11-19, test): Check the late click. Check: Replay the late click.';
  const head = changeSlice(state,'Preserve confirmation',previous + rule + '\n');
  const failed = {...state,candidate:first.head,round:{candidate:first.head,closed:true,findings:['Late click']}};
  expect(observeSlice(head,failed)).toContain('docs/REVIEW.md');
  for (const role of ['Reviewer, blind case','Reviewer, replay','Judge','Builder']) {
    const folder = path.join(lab,'candidate',role);
    const {brief} = packet({...state,candidate:head.head},role,folder,'Replay.',path.join(folder,'report.json'),()=>null);
    const contents = fs.readFileSync(brief,'utf8');
    expect(contents.includes(rule)).toBe(role!=='Reviewer, blind case');
    if (role==='Builder') expect(contents).toContain(file);
  }
});

it('reissues a builder packet on a closed review and holds a ruleless correction on resume', () => {
  const state = freshSlice();
  vi.stubEnv('FACTORY_TEST_CREDENTIAL',marker);
  onTestFinished(()=>vi.unstubAllEnvs());
  const plan = command('plan',fixture);
  expect(plan.status,plan.stderr).toBe(0);
  const file = plan.stdout.match(/State: ([^\r\n]+)/)![1];
  const saved = json(file);
  state.run = saved.run;
  const first = changeSlice(state,'Show practice result');
  save(file,{...saved,...state,dry:false,step:'verify',candidate:first.head,readiness:{builder:true,reviewer:true},
    round:{number:1,closed:true,candidate:first.head,findings:['Duplicate practice confirmation.']}});
  const issued = command('build',state.run);
  expect(issued.stdout,issued.stderr).toContain('Builder brief:');
  const brief = fs.readFileSync(path.join(path.dirname(file),'builder',first.head,'brief.md'),'utf8');
  expect(brief).toContain('Duplicate practice confirmation.');
  const rules = fs.readFileSync(path.join(tree,'docs/REVIEW.md'),'utf8');
  const next = 1 + Math.max(...Array.from(rules.matchAll(/^- R(\d+) /gm), m=>Number(m[1])));
  expect(brief).toContain('include R' + next + ' and its Check');
  const corrected = changeSlice(state,'Debounce practice confirmation');
  const resume = command('build',state.run);
  expect(resume.status).toBe(1);
  expect(resume.stderr).toMatch(/HOLD: .*rule.*same commit/i);
  expect(inspect(tree).head).toBe(corrected.head);
});

it('rejects a dirty builder reply, preserves the ticket and accepts only the ticketed private commit', async () => {
  const { builderCheckout, builderResult } = await import('./builder.mjs');
  const state = {root:tree,branch:git(tree,'branch','--show-current'),base:git(tree,'rev-parse','HEAD'),ticket:'N-01',
    run:'run-private',card:{paths:['HANDOFF.md']},builderRoute:route('Heavy','Builder')};
  const dir = path.join(lab,'builder handoff');
  const copy = builderCheckout(state,dir,state.base);
  const file = path.join(copy,'HANDOFF.md');
  fs.appendFileSync(file,'\nSpecific baseline check\n');
  const report = {verdict:'COMMITTED',candidate:state.base};
  expect(()=>builderResult(state,dir,report)).toThrow(/git -C .* diff HEAD/);
  expect(git(tree,'status','--porcelain')).toBe('');
  expect(()=>builderResult(state,dir,{...report,verdict:'HOLD'})).toThrow(/uncommitted/);
  git(copy,'add','HANDOFF.md');
  git(copy,'commit','-qm','Unprefixed draft','-m','Factory-Run: run-private');
  expect(()=>builderResult(state,dir,{...report,candidate:git(copy,'rev-parse','HEAD')})).toThrow(/Unexplained commit[\s\S]*dispatch\.ps1/);
  git(copy,'commit','--amend','-qm','N-01 Record the baseline','-m','Factory-Run: run-private');
  report.candidate = git(copy,'rev-parse','HEAD');
  expect(()=>builderResult(state,dir,{...report,candidate:state.base})).toThrow(/candidate/i);
  expect(builderResult(state,dir,report)).toBe(report.candidate);
  expect(git(tree,'rev-parse','HEAD')).toBe(state.base);
},30000); // Two isolated checkouts and the real commit validation.

it('inventories operator remote and archive inputs, including an absent archived head', async () => {
  const { baselineInputs } = await import('./baseline.mjs');
  const archived = 'refs/heads/audit/fixes-0.9.42';
  const bundle = path.join(lab,'original.bundle');
  git(clone,'branch','audit/fixes-0.9.42','HEAD');
  git(clone,'bundle','create',bundle,archived);
  git(tree,'remote','add','origin',clone);
  try {
    const evidence = baselineInputs(tree,bundle);
    expect(evidence.remote).toBe(git(clone,'rev-parse','main'));
    expect(evidence.archive).toBe(git(clone,'rev-parse',archived));
    expect(evidence.bundleSha256).toBe(hash(fs.readFileSync(bundle)));
    expect(baselineInputs(tree,path.join(lab,'missing')).missing.join(' ')).toMatch(/bundle.*audit/i);
    git(clone,'bundle','create',bundle,'main');
    expect(baselineInputs(tree,bundle).missing.join(' ')).toContain(archived);
  } finally { git(tree,'remote','remove','origin'); }
},30000); // Uses real local upload-pack and bundle verification.


it.runIf(process.platform === 'win32')('names the file and live process on a Windows install lock', async () => {
  const { installLock } = await import('./gates.mjs');
  const file = path.join(lab,'held runtime.exe');
  fs.copyFileSync(process.execPath,file);
  const { spawn } = await import('node:child_process');
  const holder = spawn(file,['-e',"console.log('ready');setInterval(()=>{},1000)"],{windowsHide:true});
  try {
    await new Promise<void>((resolve,reject)=>{holder.stdout.once('data',()=>resolve()); holder.once('error',reject);});
    expect(installLock('npm error code EPERM\nnpm error syscall unlink\nnpm error path ' + file,lab)).toContain(String(holder.pid));
    const neighbor = path.join(lab,'unused','held runtime.exe');
    fs.mkdirSync(path.dirname(neighbor));
    fs.writeFileSync(neighbor,'unused fixture');
    expect(installLock('npm error code EPERM\nnpm error path ' + neighbor,lab)).toContain('No live lock owner identified');
    expect(installLock('npm error path ' + file,lab)).toBe('');
    vi.stubEnv('SystemRoot',path.join(lab,'missing Windows installation'));
    expect(installLock('npm error code EPERM\nnpm error path ' + file,lab)).toContain('Lock probe compilation failed (ENOENT)');
  } finally { const done = new Promise(resolve=>holder.once('exit',resolve)); holder.kill(); await done; }
},90000); // Includes two compilations and the native process and Restart Manager queries on Windows CI.
