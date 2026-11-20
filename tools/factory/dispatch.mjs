import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Hold, operatorIdentity } from './worktree.mjs';
import { privateEnv } from './gates.mjs';

export const reviewerFix = 'Set OPENROUTER_API_KEY or point FILOW_FACTORY_ENV at a dotenv file containing it';

export function reviewerKey(env) {
  const direct = env.OPENROUTER_API_KEY?.trim();
  if (direct || !env.FILOW_FACTORY_ENV) return direct;
  try {
    const file = fs.readFileSync(env.FILOW_FACTORY_ENV, 'utf8');
    let key;
    for (const line of file.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const assignment = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!assignment) continue;
      const value = assignment[1];
      if (/^["'\x60]/.test(value)) {
        const end = value.indexOf(value[0], 1);
        if (end > 0 && /^\s*(?:#.*)?$/.test(value.slice(end + 1))) key = value.slice(1, end).trim();
      } else {
        key = value.split('#', 1)[0].trim();
      }
    }
    return key;
  } catch {
    // An unreadable file takes the same presence-only preflight path as a missing key.
    return undefined;
  }
}

export function providerEnv(provider, env, runtime, operatorRoot) {
  const child = privateEnv(runtime);
  if (provider === 'Anthropic' || provider === 'Google') {
    const key = reviewerKey(env);
    if (key) child.OPENROUTER_API_KEY = key;
  } else {
    const key = env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
    if (key) child.CODEX_API_KEY = key;
    else child.CODEX_HOME = path.resolve(env.FILOW_CODEX_HOME || env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  }
  if (operatorRoot) Object.assign(child,operatorIdentity(operatorRoot));
  return child;
}

export function startProgress(step, file) {
  const started = Date.now();
  const record = message => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const line = step + ' | ' + elapsed + 's | ' + message;
    fs.appendFileSync(file, line + '\n', { mode: 0o600 });
    console.log(line);
  };
  record('Live log: ' + file);
  const timer = setInterval(() => record('Waiting for the packet reply'), 30000);
  return code => {
    clearInterval(timer);
    record('Finished with exit ' + code);
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [provider, runtime, ...args] = process.argv.slice(2);
  // Previously issued scripts start directly with the executable.
  const step = args[0] === '--step' ? args.splice(0,2)[1] : 'Dispatch';
  const operatorRoot = args[0] === '--operator-root' ? args.splice(0,2)[1] : undefined;
  const exe = args.shift();

  const file = path.join(runtime,'..','dispatch.log');
  const finish = startProgress(step, file);
  let code = 1;
  try {
    const env = providerEnv(provider,process.env,runtime,operatorRoot);
    if (provider === 'OpenAI' || env.OPENROUTER_API_KEY) {
      const child = spawn(exe, args, { env, windowsHide: true, stdio: ['inherit','pipe','ignore'] });
      // Persist only known CLI event names. Payloads and stderr can contain private inputs.
      const events = createInterface({ input: child.stdout });
      const known = new Set(['thread.started','turn.started','item.started','item.completed','turn.completed','turn.failed','error']);
      events.on('line', line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (known.has(event?.type)) fs.appendFileSync(file, new Date().toISOString() + ' ' + event.type + '\n');
      });
      code = await new Promise(resolve => {
        child.once('error', () => resolve(1));
        child.once('close', status => resolve(status ?? 1));
      });
    }
  } catch (error) {
    console.error(error instanceof Hold ? error.message : 'Factory dispatch failed to launch.');
  } finally {
    finish(code);
    process.exitCode = code;
  }
}
