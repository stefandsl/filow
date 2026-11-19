import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from 'vitest';
import { parse, stakes, ticketCard } from './plan.mjs';
import { childEnv, inspect, json, save, withLock } from './worktree.mjs';
import { observeSlice, select } from './factory.mjs';
import { actor, checkPackage, getReport, reserve, review } from './review.mjs';
import { packet, ready, route } from './brief.mjs';
import { gateNames, privateEnv, runGates } from './gates.mjs';
import { tmpRoot } from '../../apps/desktop/test-tmp';
import { decideTrial } from './offline.mjs';

const source = process.cwd();
const lab = tmpRoot('factory');
const clone = path.join(lab,'clone'), tree = path.join(lab,'ticket tree');
const git = (cwd: string, ...args: string[]) => execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();
const fixture = 'N-08-PRACTICE';
const marker = 'synthetic-secret-value-123456';
const command = (verb: string, ...args: string[]) => spawnSync(process.execPath,['tools/factory/factory.mjs',verb,...args],{
  cwd: tree, encoding:'utf8',timeout:30000,windowsHide:true,env:{...childEnv(), ...privateEnv(path.join(lab,'runtime')), GH_TOKEN:marker,
    CODEX_API_KEY:process.env.FACTORY_TEST_CREDENTIAL || '',ANTHROPIC_API_KEY:process.env.FACTORY_TEST_CREDENTIAL || ''},
});

beforeAll(() => {
  fs.mkdirSync(clone);
  git(clone,'init','-b','main');
  git(clone,'config','user.name','Practice');
  git(clone,'config','user.email','practice@example.invalid');
  const files = ['docs/factory/BRIEF-TEMPLATE.md','docs/REVIEW.md','docs/PLAN.md','docs/METHODOLOGY.md','HANDOFF.md',
    'packages/core/src/i18n/en.ts','apps/web/app/tour/page.tsx','tools/factory/N-08-PRACTICE.json',
    ...fs.readdirSync(path.join(source,'tools/factory')).filter(f=>f.endsWith('.mjs')).map(f=>'tools/factory/'+f)];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(clone,f)),{recursive:true});
    fs.copyFileSync(path.join(source,f),path.join(clone,f));
  }
  fs.writeFileSync(path.join(clone,'.gitignore'),'node_modules/\n');
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
  expect(ready('OpenAI',{CODEX_API_KEY:marker})).toBe(true);
  expect(ready('Anthropic',{OPENAI_API_KEY:marker})).toBe(false);
  expect(ready('Anthropic',{ANTHROPIC_API_KEY:marker})).toBe(true);
  expect(privateEnv(lab)).not.toHaveProperty('GH_TOKEN');
  const identity = {...route('Light','Judge'),session:'same'};
  expect(()=>actor(identity,identity,[identity])).toThrow(/fresh/);
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
    const configured = command('plan',json(file).run);
    expect(configured.status,configured.stderr).toBe(0);
    expect(json(file).readiness).toEqual({builder:true,reviewer:true});
    expect(configured.stdout + fs.readFileSync(file,'utf8')).not.toContain(marker);
  } finally { vi.unstubAllEnvs(); }
});
it('seals the blind case before exposing the candidate and refuses a stale replay or missing judge', async () => {
  const dir = path.join(lab,'independent'), ledger = path.join(dir,'ledger.json');
  const t = inspect(tree), card = ticketCard(tree,fixture);
  const state:any = {run:'test-run',ticket:fixture,root:tree,branch:t.branch,base:t.head,candidate:t.head,card,
    risk:{level:'Medium',reason:card.reason},builder:{session:'builder'},gate:{receipts:[]}};
  const verify = () => review(state,dir,ledger,{},()=>{});
  try {
    vi.stubEnv('ANTHROPIC_API_KEY','');
    await expect(verify()).rejects.toThrow(/reviewer unavailable/);
    expect(fs.existsSync(ledger)).toBe(false);
    vi.stubEnv('ANTHROPIC_API_KEY',marker);
    await expect(verify()).rejects.toThrow(/Awaiting blind/);
    const root = path.join(dir,state.round.id);
    const brief = fs.readFileSync(path.join(root,'blind','brief.md'),'utf8');
    expect(brief).not.toContain(t.head); expect(brief).not.toContain(tree); expect(brief).not.toContain(marker);
    const reviewer = {provider:'Anthropic',model:'claude-opus-4-7',effort:'high'};
    save(path.join(root,'blind','report.json'),{...reviewer,session:'blind',assignment:state.round.packets.blind,case:'Double press Enter.',expected:'One confirmation.'});
    await expect(verify()).rejects.toThrow(/Awaiting replay/);
    const file = path.join(root,'replay','report.json');
    const replay = {...reviewer,session:'replay',assignment:state.round.packets.replay,caseDigest:state.round.blind.digest,
      candidate:'a'.repeat(40),verdict:'PASS',findings:[],observations:Array(4+card.checks.length).fill('Recorded fixture observation.')};
    save(file,replay); await expect(verify()).rejects.toThrow(/stale/);
    vi.stubEnv('CODEX_API_KEY',''); vi.stubEnv('OPENAI_API_KEY','');
    save(file,{...replay,candidate:t.head}); await expect(verify()).rejects.toThrow(/Judge unavailable/);
    expect(json(ledger)).toHaveLength(1);
  } finally { vi.unstubAllEnvs(); }
});
it('takes all three public verbs through a dry run, repeats build in another process and leaves one private run', () => {
  const before = inspect(tree);
  const plan = command('plan',fixture,'--dry-run');
  expect(plan.status,plan.stderr).toBe(0);
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
},120000);
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
  runGates(state,dir,'verify',()=>save(disk,state),true,()=>0);
  expect(json(disk).gate.receipts).toHaveLength(gateNames.length);
  const completed = json(disk).gate.receipts[0];
  const saved = json(completed.path);
  const interrupted = {...json(disk),intent:saved,gate:{phase:'verify',sha:head,status:'running',receipts:[]}};
  const resumed:string[] = [];
  runGates(interrupted,dir,'verify',()=>{},false,(name:string)=>{resumed.push(name);return 0;});
  expect(resumed).toEqual(gateNames.slice(1));
  expect(interrupted.gate.receipts[0]).toEqual(completed);
});

function packetState() {
  const t = inspect(tree);
  return {root:tree, branch:t.branch, base:t.head, candidate:t.head, run:'round-one', ticket:fixture,
    card:ticketCard(tree,fixture), risk:{level:'Light',reason:'Practice'}, dry:true};
}

it('prints the isolated Windows command and preserves both native exit codes after stderr', () => {
  const folder = path.join(lab,"dispatch d'été"), out = path.join(folder,'reply.json');
  fs.mkdirSync(folder);
  const exe = path.join(folder,'codex.exe');
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  try {
    packet(packetState(),'Builder',folder,'A synthetic assignment.',out,()=>exe);
    const commandLine = log.mock.calls.map(args=>String(args[0])).find(line=>line.startsWith('powershell.exe '));
    const script = path.join(folder,'dispatch.ps1');
    expect(commandLine).toBe("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '" + script.replaceAll("'","''") + "'");
    const body = fs.readFileSync(script,'utf8');
    expect(body).toContain(exe.replaceAll("'","''"));
    expect(body).toMatch(/\$ErrorActionPreference = 'Continue'\r?\n[^\n]+\*> \$null\r?\n\$code = \$LASTEXITCODE/);
    if (process.platform !== 'win32') return;
    const cs = path.join(folder,'Fake.cs');
    fs.writeFileSync(cs, `using System;
using System.IO;
class Fake {
  static int Main(string[] args) {
    Console.InputEncoding = new System.Text.UTF8Encoding(false);
    Console.Error.WriteLine("synthetic private progress");
    string output = args[Array.IndexOf(args, "-o") + 1];
    if (File.Exists(output)) return 17;
    File.WriteAllText(output, Console.In.ReadToEnd());
    return 0;
  }
}`);
    const compiler = path.join(process.env.SystemRoot!,'Microsoft.NET','Framework','v4.0.30319','csc.exe');
    execFileSync(compiler,['/nologo','/out:'+exe,cs],{cwd:folder});
    const launch = () => spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',commandLine + '\nexit $LASTEXITCODE'],{
      cwd:folder,encoding:'utf8',env:{...process.env,CODEX_API_KEY:marker},timeout:30000,windowsHide:true});
    const success = launch();
    expect(success.status,success.stderr).toBe(0);
    expect(fs.readFileSync(out,'utf8')).toContain("dispatch d'été");
    const failure = launch();
    expect(failure.status,failure.stderr).toBe(17);
    expect(failure.stdout).toContain('HOLD');
    expect(success.stderr + success.stdout + failure.stderr + failure.stdout).not.toContain('synthetic private progress');
  } finally { log.mockRestore(); }
});

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
  const plan = command('plan',fixture);
  const file = plan.stdout.match(/State: ([^\r\n]+)/)![1];
  const saved = json(file);
  state.run = saved.run;
  const first = changeSlice(state,'Show practice result');
  save(file,{...saved,...state,dry:false,step:'verify',candidate:first.head,readiness:{builder:true,reviewer:true},
    round:{number:1,closed:true,candidate:first.head,findings:['Duplicate practice confirmation.']}});
  command('build',state.run);
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
