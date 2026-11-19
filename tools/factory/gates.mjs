import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv, ensure, hash, inspect, json, now, read, save, withLock } from './worktree.mjs';

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
const commands = ['node node_modules/electron/install.js','npm run vendor -w apps/desktop',
  'remove apps/desktop/vendor/i18n.js if present','npx vitest run','npm run build:welcome -w apps/desktop','npm run typecheck','npm run lint'];
const worker = fileURLToPath(import.meta.url);
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

function writeReceipt(intent, env, run) {
  if (fs.existsSync(intent.destination)) return;
  const start = now();
  const exit = run(intent.name,intent.cwd,env);
  save(intent.destination,{...intent, command:commands[gateNames.indexOf(intent.name)], start, end:now(), exit, node:process.version});
}

// The child owns the branch gate lock and writes its receipt even if the coordinator disappears.
if (process.argv[1] && path.resolve(process.argv[1]) === worker) {
  try {
    const intent = JSON.parse(process.argv[2]);
    const tree = inspect(process.cwd());
    ensure(gateNames.includes(intent.name) && tree.head === intent.sha && tree.root === intent.cwd, 'Invalid gate intent.');
    await withLock(tree.common + '/gate/' + tree.branch, () => writeReceipt(intent,process.env,execute));
  } catch { process.exitCode = 1; }
}

// Only metadata crosses the child boundary. A child can print credentials even on an ordinary failure.
export function runGates(state, dir, phase, checkpoint, retry, run) {
  ensure(fs.existsSync(path.join(state.root, 'node_modules/electron/install.js')), 'Install dependencies with npm ci in the assigned worktree, then repeat this command.');
  const env = privateEnv(path.join(dir, 'runtime'));
  if (!state.gate || state.gate.phase !== phase || state.gate.sha !== state.candidate) {
    state.gate = { phase, sha: state.candidate, receipts: [], status: 'running' };
    checkpoint();
  }
  const g = state.gate;
  ensure(!g.failure || retry && !g.retried, 'The gate is red. Inspect the failing command. After correcting setup, use --retry once or prepare a corrected candidate.');
  if (g.failure) { g.retried = true; g.receipts = []; state.intent = null; delete g.failure; }
  for (const name of gateNames) {
    const old = g.receipts.find(r => r.name === name);
    if (old) {
      ensure(hash(read(old.path)) === old.digest && json(old.path).sha === state.candidate && json(old.path).exit === 0,
        'Gate receipt changed. Preserve evidence and start a fresh gate.');
      continue;
    }
    const pending = state.intent?.phase === phase && state.intent.name === name && state.intent.sha === state.candidate;
    if (!pending) {
      const id = randomUUID();
      state.intent = { id, name, phase, cwd:state.root, destination:path.join(dir,'receipts',id + '.json'),
        run:state.run, sha:state.candidate, npm:process.env.npm_config_user_agent?.split(' ')[0] || 'unknown' };
    }
    const intent = state.intent, file = intent.destination;
    state.verdict = 'HOLD';
    checkpoint();
    if (!fs.existsSync(file)) {
      ensure(!intent.retried, 'An interrupted gate has already been retried. Inspect the private intent and process.');
      if (pending) { intent.retried = true; checkpoint(); }
      console.log('Running ' + name);
      if (run) writeReceipt(intent,env,run);
      else {
        const child = spawnSync(process.execPath,[worker,JSON.stringify(intent)],{cwd:state.root,
          env:{...env,npm_execpath:process.env.npm_execpath},timeout:26*60000,windowsHide:true,stdio:'ignore'});
        ensure(child.status === 0 && fs.existsSync(file), 'Gate worker failed or is busy. Inspect the saved intent and repeat the same verb.');
      }
    }
    const receipt = json(file);
    ensure(['id','name','phase','cwd','destination','run','sha'].every(k=>receipt[k] === intent[k]), 'Receipt does not match the saved gate intent.');
    if (receipt.exit !== 0) {
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
