import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export function ensure(ok, message) {
  if (!ok) throw new Hold(message);
}
export class Hold extends Error {}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export function read(file) { return fs.readFileSync(file, 'utf8'); }
export function json(file) { return JSON.parse(read(file)); }
export function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flush: true, flag: 'wx' });
  fs.renameSync(temp, file);
}

export function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    /^(path|pathext|systemdrive|systemroot|computername|windir|comspec|programfiles(?:\(x86\))?|processor_architecture|number_of_processors|os|lang)$/i.test(k)));
}
export function git(cwd, ...args) {
  return gitOutput(cwd, ...args).trimEnd();
}
export function gitOutput(cwd, ...args) {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.longpaths=true', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  ensure(result.status === 0, 'Git check failed. Open the root of the assigned linked worktree on its ticket branch.');
  return result.stdout;
}
export function inspect(cwd) {
  const root = fs.realpathSync(cwd);
  const resolveGit = flag => fs.realpathSync(git(root, 'rev-parse', '--path-format=absolute', flag));
  ensure(root === resolveGit('--show-toplevel') && resolveGit('--git-dir') !== resolveGit('--git-common-dir'),
    'Use the root of a linked worktree. See the git worktree add step in the guide.');
  const branch = git(root, 'branch', '--show-current');
  ensure(branch && !/^(main|master)$/i.test(branch), 'Switch to the assigned ticket branch.');
  ensure(!git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'),
    "Dirty worktree. Preserve existing edits. Run git -C '" + root.replaceAll("'","''") + "' status --short");
  return { root, branch, common: resolveGit('--git-common-dir'), head: git(root, 'rev-parse', 'HEAD') };
}
export function checkWindowsVolumes(dir, root) {
  if (process.env.NODE_ENV === 'test' && process.env.FILOW_FACTORY_ALLOW_ANY_VOLUME === '1') return;
  for (const drive of new Set(['C:\\', path.win32.parse(dir).root, path.win32.parse(root).root])) {
    const disk = fs.statfsSync(drive);
    ensure(disk.bavail * disk.bsize >= 20e9, 'A required volume has less than 20 GB free. Stop and free workspace capacity.');
  }
  ensure(!/^c:/i.test(dir) && !/^c:/i.test(root), 'Use a workspace volume outside C: for the clone and worktree.');
}
export function storage(tree) {
  // One shared index per clone, across all its linked worktrees and sessions.
  const primary = path.dirname(tree.common);
  const dir = path.join(path.dirname(primary), '.filow-factory', hash(tree.common).slice(0, 16));
  for (const root of git(tree.root, 'worktree', 'list', '--porcelain').split('\n').filter(s => s.startsWith('worktree '))) {
    const rel = path.relative(root.slice(9).trimEnd(), dir);
    ensure(rel.startsWith('..' + path.sep) || path.isAbsolute(rel), 'Private factory storage must be outside all checkouts.');
  }
  if (process.platform === 'win32') checkWindowsVolumes(dir,tree.root);
  return dir;
}

// Kernel-owned socket releases even on abrupt exit. Never steal a lock using a stale PID.
export async function withLock(key, action) {
  const name = hash(key).slice(0, 32);
  const address = process.platform === 'win32' ? '\\\\.\\pipe\\filow-' + name :
    process.platform === 'linux' ? '\0filow-' + name : { host: '127.0.0.1', port: 20000 + parseInt(name.slice(0, 4), 16) % 35000 };
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Hold('Another factory writer holds the lock. Repeat the same command after it exits.')));
    server.listen(address, resolve);
  });
  try { return await action(); } finally { await new Promise(resolve => server.close(resolve)); }
}
export const writer = () => ({ host: os.hostname(), pid: process.pid, started: new Date(Date.now() - process.uptime() * 1000).toISOString() });
