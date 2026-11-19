import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { childEnv, ensure, git } from './worktree.mjs';
import { privateEnv } from './gates.mjs';

export function route(level, role) {
  if (role.startsWith('Reviewer') && level !== 'Light') return { provider: 'Anthropic', model: 'Claude Opus', effort: 'high' };
  return role === 'Builder' && level !== 'Heavy' ? { provider: 'OpenAI', model: 'gpt-6.2-sol', effort: 'medium' }
    : { provider: 'OpenAI', model: 'gpt-6.2-astra', effort: level === 'Heavy' ? 'xhigh' : 'high' };
}
export function ready(provider, env = process.env) {
  return Boolean((provider === 'OpenAI' ? env.CODEX_API_KEY || env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY)?.trim());
}
export function desktopCodex() {
  if (process.platform !== 'win32') return null;
  const found = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
    "(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation)"], {
    env: childEnv(), timeout: 15000, windowsHide: true, encoding: 'utf8', stdio: ['ignore','pipe','ignore'],
  });
  if (found.status !== 0 || !found.stdout.trim()) return null;
  const exe = path.join(found.stdout.trim(), 'app','resources','codex.exe');
  return fs.existsSync(exe) ? exe : null;
}
const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
export function packet(state, role, folder, instructions, output) {
  const blind = role === 'Reviewer, blind case';
  const builder = role === 'Builder';
  const cwd = builder ? state.root : folder;
  const model = route(state.risk.level, role);
  const readyNow = ready(model.provider);
  const rules = git(state.root, 'show', state.base + ':docs/REVIEW.md');
  const template = git(state.root, 'show', state.base + ':docs/factory/BRIEF-TEMPLATE.md');
  const sections = template.split(/(?=^\*\*(?:Builder|Reviewer, blind case|Reviewer, replay|Judge|Report)\.\*\*)/m);
  const fields = [state.ticket + '. ' + state.card.goal,
    [role, state.run, model.provider, model.model, model.effort, 'record the actual session ID in your report'].join(', '),
    blind ? folder : [state.root, state.branch, state.base, state.candidate].filter(Boolean).join(', '),
    folder, [output, ...(builder ? state.card.paths.map(f => path.join(state.root, f)) : [])].join(', '),
    'Write only the listed paths. Protect other worktrees and processes. Local ticket only. 25 minutes per command, one setup retry. No publish grants. Spend unknown.',
    [state.card.initial,state.card.action,state.card.positive,state.card.negative,...(state.card.checks || []),
      state.risk.level, state.risk.reason, 'Run every matching Check in REVIEW.md.', state.round ? 'Round ' + state.round.number + '/3.' : ''].join(' '),
    'Use the assigned private profile. Provider ' + (readyNow ? 'configured.' : 'missing.') + ' Record observations in ' + output];
  let i = 0;
  const header = sections[0].replace(/^\| ([^|\n]+) \| (.*<.*) \|\r?$/gm, (_, label) => '| ' + label + ' | ' + fields[i++] + ' |');
  ensure(i === fields.length, 'Brief template changed. Check its fields before dispatch.');
  const brief = path.join(folder,'brief.md');
  const contents = [rules, header, sections.find(s => s.startsWith('**' + role + '.**')), instructions, sections.at(-1)].join('\n\n');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.writeFileSync(brief, contents, { mode: 0o600 });
  console.log(role + ' brief: ' + brief + '\n' + model.provider + ' ' + model.model + ' ' + model.effort + ' | ' + (readyNow ? 'configured' : 'missing credential'));
  if (model.provider === 'OpenAI') {
    const exe = desktopCodex();
    if (exe) {
      const args = ['exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','-C',cwd,
        '-s',builder ? 'workspace-write' : 'read-only','-m',model.model,'-c','model_reasoning_effort=' + model.effort,
        '-c','shell_environment_policy.inherit=all','-c',"shell_environment_policy.exclude=['*KEY*','*TOKEN*','*SECRET*','*PASSWORD*','*AUTH*','*CREDENTIAL*']",'-o',output,'-'];
      const command = 'Get-Content -Raw -Encoding UTF8 -LiteralPath ' + quote(brief) + ' | & ' + quote(exe) + ' ' + args.map(quote).join(' ');
      console.log(command);
      // Use a child process so that credential isolation never modifies the parent shell.
      const env = privateEnv(path.join(folder,'runtime'));
      const script = ["$ErrorActionPreference = 'Stop'", "$providerKey = $env:CODEX_API_KEY",
        "if (!$providerKey) { $providerKey = $env:OPENAI_API_KEY }",
        "if (!$providerKey) { throw 'Configure the OpenAI provider first.' }",
        "Get-ChildItem Env: | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }",
        ...Object.entries(env).map(([k,v]) => '[Environment]::SetEnvironmentVariable(' + quote(k) + ', ' + quote(v) + ", 'Process')"),
        "$env:CODEX_API_KEY = $providerKey", "$OutputEncoding = [Text.UTF8Encoding]::new($false)",command + ' *> $null',
        "if ($LASTEXITCODE) { Write-Output 'HOLD: Codex dispatch failed. Check provider setup and the private brief.' }", 'exit $LASTEXITCODE'];
      fs.writeFileSync(path.join(folder,'dispatch.ps1'),script.join('\r\n') + '\r\n', { mode: 0o600 });
      console.log('For a credential-isolated dispatch use powershell.exe -NoProfile -File ' + quote(path.join(folder,'dispatch.ps1')));
    } else {
      const message = 'Install the Codex desktop app on Windows to resolve its bundled CLI.';
      console.log(message);
      ensure(state.dry, message);
    }
  } else console.log('Give only this packet to a fresh Claude Opus session. Save its JSON reply to ' + output);
  return { ...model, configured: readyNow, brief };
}
