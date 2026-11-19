import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { childEnv, ensure, git } from './worktree.mjs';
import { privateEnv } from './gates.mjs';
import { editGrant } from './plan.mjs';

export function route(level, role) {
  if (role.startsWith('Reviewer') && level !== 'Light') return { provider: 'Anthropic', model: 'Claude Opus', effort: 'high' };
  return role === 'Builder' && level !== 'Heavy' ? { provider: 'OpenAI', model: 'gpt-6.2-sol', effort: 'medium' }
    : { provider: 'OpenAI', model: 'gpt-6.2-astra', effort: level === 'Heavy' ? 'xhigh' : 'high' };
}
export const loginFix = 'Run codex login with ChatGPT or set OPENAI_API_KEY';
export const desktopFix = 'Install the Codex desktop app on Windows to resolve its bundled CLI.';
export function ready(provider, env = process.env, exe, folder) {
  if (provider !== 'OpenAI') return Boolean(env.OPENROUTER_API_KEY?.trim());
  const key = env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!exe) return false;
  const probeEnv = privateEnv(folder);
  if (!key) probeEnv.CODEX_HOME = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  // An explicit exec API key works even when the private CLI home is signed out.
  // Status can write to stderr and can identify credentials. Keep both streams in memory.
  const probe = spawnSync(exe, ['login','status'], { env: probeEnv, cwd: folder, windowsHide: true,
    timeout: 15000, maxBuffer: 16384, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  return !probe.error && probe.status !== null && (Boolean(key) || probe.status === 0 &&
    /^Logged in using ChatGPT\s*$/im.test(probe.stdout + '\n' + probe.stderr));
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
const schemas = {
  Coordinator: 'card', Builder: 'builder', 'Reviewer, blind case': 'blind', 'Reviewer, replay': 'replay', Judge: 'replay',
};

export function writeDispatch({ exe, model, cwd, folder, brief, output, schema, builder = false }) {
  ensure(fs.existsSync(schema), 'Missing packet schema: ' + schema);
  const independent = model.provider === 'Anthropic';
  const providerArgs = independent ? ['-c','model_provider=openrouter',
    '--disable','multi_agent','-c','web_search=disabled',
    '-c','model_providers.openrouter.name=OpenRouter','-c','model_providers.openrouter.base_url=https://openrouter.ai/api/v1',
    '-c','model_providers.openrouter.env_key=OPENROUTER_API_KEY','-c','model_providers.openrouter.wire_api=responses',
    '-c','model_providers.openrouter.request_max_retries=0','-c','model_providers.openrouter.stream_max_retries=0'] : [];
  const args = ['exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','-C',cwd,
    '-s',builder ? 'workspace-write' : 'read-only',...providerArgs,'-m',independent ? 'anthropic/claude-opus-5.5' : model.model,'-c','model_reasoning_effort=' + model.effort,
    '-c','log_dir=' + path.join(folder,'runtime','logs'),'-c','shell_environment_policy.inherit=all','-c',"shell_environment_policy.exclude=['*KEY*','*TOKEN*','*SECRET*','*PASSWORD*','*AUTH*','*CREDENTIAL*','CODEX_HOME']",'--output-schema',schema,'-o',output,'-'];
  // Use a child process so that credential isolation never modifies the parent shell.
  const env = privateEnv(path.join(folder,'runtime'));
  const key = independent ? 'OPENROUTER_API_KEY' : 'CODEX_API_KEY';
  const script = ["$ErrorActionPreference = 'Stop'", '$providerKey = $env:' + key,
    ...(independent ? ["if ([string]::IsNullOrWhiteSpace($providerKey)) { throw 'Set OPENROUTER_API_KEY for this dispatch.' }"] : [
      "if ([string]::IsNullOrWhiteSpace($providerKey)) { $providerKey = $env:OPENAI_API_KEY }",
      '$loginHome = $env:CODEX_HOME',
      "if (!$loginHome) { $loginHome = Join-Path $env:USERPROFILE '.codex' }",
    ]),
    "Get-ChildItem Env: | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }",
    ...Object.entries(env).map(([k,v]) => '[Environment]::SetEnvironmentVariable(' + quote(k) + ', ' + quote(v) + ", 'Process')"),
    ...(independent ? ['$env:' + key + ' = $providerKey'] : [
      "if ([string]::IsNullOrWhiteSpace($providerKey)) { $env:CODEX_HOME = $loginHome } else { $env:CODEX_API_KEY = $providerKey }",
    ]), "$OutputEncoding = [Text.UTF8Encoding]::new($false)",
    '$briefText = Get-Content -Raw -Encoding UTF8 -LiteralPath ' + quote(brief),
    // Windows PowerShell 5.1 routes redirected native stderr through its error stream.
    "$ErrorActionPreference = 'Continue'", '$briefText | & ' + quote(exe) + ' ' + args.map(quote).join(' ') + ' *> $null',
    '$code = $LASTEXITCODE', "$ErrorActionPreference = 'Stop'", 'if ($null -eq $code) { $code = 1 }',
    "if ($code) { Write-Output 'HOLD: Codex dispatch failed. Check provider setup and the private brief.' }", 'exit $code'];
  const scriptPath = path.join(folder,'dispatch.ps1');
  fs.writeFileSync(scriptPath,'\ufeff' + script.join('\r\n') + '\r\n', { mode: 0o600 });
  console.log('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + quote(scriptPath));
  return scriptPath;
}

export function packet(state, role, folder, instructions, output, resolveCodex = desktopCodex) {
  const blind = role === 'Reviewer, blind case';
  const builder = role === 'Builder';
  const cwd = builder || role === 'Coordinator' ? state.root : folder;
  const model = route(state.risk.level, role);
  const exe = resolveCodex();
  const readyNow = Boolean(exe) && ready(model.provider,process.env,exe,path.join(folder,'runtime'));
  const revision = blind || role === 'Coordinator' ? state.base : state.candidate || state.base;
  const rules = git(state.root, 'show', revision + ':docs/REVIEW.md');
  const template = git(state.root, 'show', state.base + ':docs/factory/BRIEF-TEMPLATE.md');
  const sections = template.split(/(?=^\*\*(?:Coordinator|Builder|Reviewer, blind case|Reviewer, replay|Judge|Report)\.\*\*)/m);
  // Runs planned before the JSON contract still pin the old template at their base SHA.
  const legacyReply = 'Reply in 60 words or fewer with the result, receipt location and any unverified claim.';
  if (sections.at(-1).includes(legacyReply)) {
    sections[sections.length - 1] = sections.at(-1).replace(legacyReply, 'Reply with exactly one raw JSON object and nothing else.');
    sections.splice(1, 0, '**Coordinator.** Return the scoped ticket card using the requested fields.');
  }
  const roleSection = sections.find(s => s.startsWith('**' + role + '.**'));
  ensure(roleSection, 'Missing role section in the factory brief template.');
  const writable = [output];
  if (builder) {
    const grant = editGrant(state.card);
    for (const file of grant.paths) writable.push(path.join(state.root,file) +
      (grant.appendOnly.includes(file) ? ' (append numbered rules and checks for fixes only)' : ''));
  }
  const fields = [state.ticket + '. ' + state.card.goal,
    [role, state.run, model.provider, model.model, model.effort, 'record the actual session ID in your report'].join(', '),
    blind ? folder : [state.root, state.branch, state.base, state.candidate].filter(Boolean).join(', '),
    folder, writable.join(', '),
    'Write only the listed paths. Protect other worktrees and processes. Local ticket only. 25 minutes per command, one setup retry. No publish grants. Spend unknown.',
    [state.card.initial,state.card.action,state.card.positive,state.card.negative,...(state.card.checks || []),
      state.risk.level, state.risk.reason, 'Run every matching Check in REVIEW.md.', state.round ? 'Round ' + state.round.number + '/3.' : ''].join(' '),
    'Use the assigned private profile. Provider ' + (readyNow ? 'configured.' : 'missing.') + ' Record observations in ' + output];
  let i = 0;
  const header = sections[0].replace(/^\| ([^|\n]+) \| (.*<.*) \|\r?$/gm, (_, label) => '| ' + label + ' | ' + fields[i++] + ' |');
  ensure(i === fields.length, 'Brief template changed. Check its fields before dispatch.');
  const brief = path.join(folder,'brief.md');
  const contents = [rules, header, roleSection, instructions, sections.at(-1)].join('\n\n');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.writeFileSync(brief, contents, { mode: 0o600 });
  console.log(role + ' brief: ' + brief + '\n' + model.provider + ' ' + model.model + ' ' + model.effort + ' | ' + (readyNow ? 'configured' : 'missing credential'));
  if (readyNow) {
    const schema = path.join(import.meta.dirname, schemas[role] + '.schema.json');
    writeDispatch({ exe, model, cwd, folder, brief, output, schema, builder });
  } else if (!state.dry) {
    const fix = !exe ? desktopFix : model.provider === 'OpenAI' ? loginFix + '.' : 'Set OPENROUTER_API_KEY.';
    ensure(false, role + ' dispatch unavailable. ' + fix);
  }
  return { ...model, configured: readyNow, brief };
}
