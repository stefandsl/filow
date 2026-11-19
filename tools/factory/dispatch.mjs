import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { privateEnv } from './gates.mjs';

export const reviewerFix = 'Set OPENROUTER_API_KEY or point FILOW_FACTORY_ENV at a dotenv file containing it';

export function reviewerKey(env) {
  const direct = env.OPENROUTER_API_KEY?.trim();
  if (direct || !env.FILOW_FACTORY_ENV) return direct;
  try {
    const file = fs.readFileSync(env.FILOW_FACTORY_ENV, 'utf8');
    return parseEnv(file).OPENROUTER_API_KEY?.trim();
  } catch {
    // An unreadable file takes the same presence-only preflight path as a missing key.
    return undefined;
  }
}

export function providerEnv(provider, env, runtime) {
  const child = privateEnv(runtime);
  if (provider === 'Anthropic') {
    const key = reviewerKey(env);
    if (key) child.OPENROUTER_API_KEY = key;
  } else {
    const key = env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
    if (key) child.CODEX_API_KEY = key;
    else child.CODEX_HOME = path.resolve(env.FILOW_CODEX_HOME || env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  }
  return child;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [provider, runtime, exe, ...args] = process.argv.slice(2);
  const env = providerEnv(provider, process.env, runtime);
  if (provider === 'Anthropic' && !env.OPENROUTER_API_KEY) process.exitCode = 1;
  else process.exitCode = spawnSync(exe, args, { env, stdio: 'inherit', windowsHide: true }).status ?? 1;
}
