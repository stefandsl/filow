import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { childEnv, ensure, hash, inspect, json, now, read, save } from './worktree.mjs';

export function privateEnv(folder) {
  const env = { ...childEnv(), CI: 'true', NEXT_TELEMETRY_DISABLED: '1', GIT_TERMINAL_PROMPT: '0',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1', npm_config_audit: 'false', npm_config_fund: 'false' };
  const dirs = { TMP: 'temp', TEMP: 'temp', TMPDIR: 'temp', HOME: 'profile', USERPROFILE: 'profile',
    LOCALAPPDATA: 'local', APPDATA: 'roaming', npm_config_cache: 'npm', XDG_CACHE_HOME: 'cache',
    npm_config_devdir: 'gyp', ELECTRON_CACHE: 'electron', electron_config_cache: 'electron',
    HF_HOME: 'models', PLAYWRIGHT_BROWSERS_PATH: 'browsers', FILOW_USER_DATA_DIR: 'filow', FILOW_TEST_TMP: 'tests',
    DOTNET_CLI_HOME: 'dotnet', NUGET_PACKAGES: 'nuget', CODEX_HOME: 'codex' };
  for (const [key, sub] of Object.entries(dirs)) {
    env[key] = path.join(folder, sub);
    fs.mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  return env;
}

export const gateNames = ['electron install','desktop vendor','remove generated dictionary','vitest','build welcome','typecheck','lint'];
function execute(name, root, env) {
  const npm = process.env.npm_execpath;
  const node = (...args) => spawnSync(process.execPath, args, {
    cwd: root, env, windowsHide: true, timeout: 25 * 60000, stdio: 'ignore',
  }).status;
  if (name === 'remove generated dictionary') {
    fs.rmSync(path.join(root, 'apps/desktop/vendor/i18n.js'), { force: true });
    return 0;
  }
  if (name === 'electron install') return node('node_modules/electron/install.js');
  if (name === 'vitest') return node('node_modules/vitest/vitest.mjs', 'run');
  ensure(npm && fs.existsSync(npm), 'Start the gate through the documented npm command.');
  if (name === 'desktop vendor') return node(npm, 'run', 'vendor', '-w', 'apps/desktop');
  if (name === 'build welcome') return node(npm, 'run', 'build:welcome', '-w', 'apps/desktop');
  return node(npm, 'run', name);
}

// Only metadata crosses the child boundary. A child can print credentials even on an ordinary failure.
export function runGates(state, dir, phase, checkpoint, retry, run = execute) {
  ensure(fs.existsSync(path.join(state.root, 'node_modules/electron/install.js')), 'Install dependencies with npm ci in the assigned worktree, then repeat this command.');
  const env = privateEnv(path.join(dir, 'runtime'));
  if (!state.gate || state.gate.phase !== phase || state.gate.sha !== state.candidate) {
    state.gate = { phase, sha: state.candidate, receipts: [], status: 'running' };
    checkpoint();
  }
  const g = state.gate;
  ensure(!g.failure || retry && !g.retried, 'The gate is red. Inspect the failing command. After correcting setup, use --retry once or prepare a corrected candidate.');
  if (g.failure) { g.retried = true; delete g.failure; }
  for (const name of gateNames) {
    const old = g.receipts.find(r => r.name === name);
    if (old) {
      ensure(hash(read(old.path)) === old.digest && json(old.path).sha === state.candidate && json(old.path).exit === 0,
        'Gate receipt changed. Preserve evidence and start a fresh gate.');
      continue;
    }
    const file = path.join(dir, 'receipts', randomUUID() + '.json');
    state.intent = { id: randomUUID(), command: name, destination: file, sha: state.candidate };
    state.verdict = 'HOLD';
    checkpoint();
    const start = now();
    console.log('Running ' + name);
    const exit = run(name, state.root, env);
    const commands = ['node node_modules/electron/install.js','npm run vendor -w apps/desktop',
      'remove apps/desktop/vendor/i18n.js if present','npx vitest run','npm run build:welcome -w apps/desktop','npm run typecheck','npm run lint'];
    const receipt = { ...state.intent, command: commands[gateNames.indexOf(name)], name, sha: state.candidate, cwd: state.root, start, end: now(), exit,
      node: process.version, npm: process.env.npm_config_user_agent?.split(' ')[0] || 'unknown' };
    save(file, receipt);
    if (exit !== 0) {
      g.status = 'failed'; g.failure = name; state.firstFailure ??= receipt;
      checkpoint();
      ensure(false, 'Gate failed: ' + name + '. Inspect the receipt at ' + file);
    }
    ensure(inspect(state.root).head === state.candidate, 'Candidate changed during the gate. Return to build.');
    g.receipts.push({ name, path: file, digest: hash(read(file)) });
    state.lastCheck = name;
    state.intent = null;
    checkpoint();
  }
  g.status = 'green';
  checkpoint();
}
