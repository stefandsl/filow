import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export function ensure(ok, message) {
  if (!ok) throw new Hold(message);
}
export class Hold extends Error {}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export function read(file) { return fs.readFileSync(file, 'utf8'); }
export function json(file) { return JSON.parse(read(file)); }
export const shortId = () => randomBytes(4).toString('hex');
export const compactRun = id => /^run-[0-9a-f]{8}$/.test(id);
export function reserveRun(parent, next = shortId) {
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  for (;;) {
    const id = 'run-' + next();
    try {
      fs.mkdirSync(path.join(parent,id),{mode:0o700});
      return id;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

// Include a preserved repair checkout, its refs and the gate's own checkout.
export function checkRunPaths(dir, root, branch, files, branches = [], extra = []) {
  const backup = path.join(dir,'b','ffffffff','old-XXXXXX');
  const paths = [path.join(dir,'v3','replay','rt','l','ModuleAnalysisCache'), ...extra];
  for (const name of [branch,...branches]) {
    paths.push(path.join(backup,'git-data','logs','refs','remotes','origin',name + '.lock'));
  }
  for (const file of files) paths.push(path.join(backup,'checkout',file),path.join(root,file));
  const length = paths.reduce((max,file) => Math.max(max,file.length),0);
  ensure(length <= 240,'Factory path needs ' + length + ' characters (limit 240). Use a shorter workspace root such as G:\\ff.');
}

export function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(file),shortId() + '.tmp');
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flush: true, flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return save(file,value);
    throw error;
  }
  fs.renameSync(temp, file);
}

export function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    /^(path|pathext|systemdrive|systemroot|computername|windir|comspec|programfiles(?:\(x86\))?|processor_architecture|number_of_processors|os|lang)$/i.test(k)));
}
export function operatorIdentity(root) {
  const configured = key => {
    const result = spawnSync('git',['-c','core.longpaths=true','config','--get',key],{
      cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],
    });
    const value = result.stdout?.trim();
    ensure(result.status === 0 && value && !/[\r\n]/.test(value),
      'Missing Git identity. Configure git config user.name and git config user.email in the operator checkout.');
    return value;
  };
  const name = configured('user.name'), email = configured('user.email');
  return {GIT_AUTHOR_NAME:name,GIT_AUTHOR_EMAIL:email,GIT_COMMITTER_NAME:name,GIT_COMMITTER_EMAIL:email};
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
  const flags = ['--show-toplevel', '--git-dir', '--git-common-dir'];
  const paths = gitOutput(root, 'rev-parse', '--path-format=absolute', ...flags).slice(0,-1).split('\n');
  // A POSIX directory name can contain a newline. Read those paths individually.
  const [top, dir, common] = (paths.length === flags.length ? paths :
    flags.map(flag => gitOutput(root, 'rev-parse', '--path-format=absolute', flag).slice(0,-1)))
    .map(p => fs.realpathSync(p));
  ensure(root === top && dir !== common,
    'Use the root of a linked worktree. See the git worktree add step in the guide.');
  // One status snapshot supplies the branch, candidate and dirty check at every gate.
  const records = git(root, 'status', '--porcelain=v2', '--branch', '--no-ahead-behind',
    '--untracked-files=all', '--ignore-submodules=none').split('\n');
  const header = key => records.find(line => line.startsWith(key))?.slice(key.length);
  const label = header('# branch.head ');
  const branch = label === '(detached)' ? git(root, 'branch', '--show-current') : label;
  ensure(branch && !/^(main|master)$/i.test(branch), 'Switch to the assigned ticket branch.');
  ensure(records.every(line => line.startsWith('# ')),
    "Dirty worktree. Preserve existing edits. Run git -C '" + root.replaceAll("'","''") + "' status --short");
  const head = header('# branch.oid ');
  ensure(head && head !== '(initial)', 'Git check failed. The assigned branch needs a candidate commit.');
  return { root, branch, common, head };
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
  const key = hash(tree.common).slice(0,16);
  const legacy = path.join(path.dirname(primary),'.filow-factory',key);
  const dir = fs.existsSync(legacy) ? legacy : path.join(path.dirname(primary),'.f-' + key);
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
