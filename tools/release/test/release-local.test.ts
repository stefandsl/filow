import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, expect, it } from 'vitest';

const temp = path.resolve('tmp');
fs.mkdirSync(temp, { recursive: true });
const root = fs.mkdtempSync(path.join(temp, 'offline-release-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const version = '1.2.3';
const tag = 'v' + version;
const env = { ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'), GIT_TERMINAL_PROMPT: '0' };

it.each([
  'clean', 'moved tag', 'moved remote tag', 'rejected push', 'missing evidence',
  'non-main', 'dirty', 'stale SHA', 'remote main moved', 'wrong owner SHA',
  'missing owner SHA', 'short owner SHA', 'wrong origin',
])(
  'runs tag offline with %s', scenario => {
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const repo = path.join(dir, 'checkout');
    const remote = path.join(dir, 'remote.git');
    const evidence = path.join(dir, 'evidence');
    fs.mkdirSync(repo);
    fs.mkdirSync(evidence);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'fixture@example.invalid');
    const script = path.join(repo, 'tools/release/release.ps1');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync('tools/release/release.ps1', script);
    git('add', '.');
    git('commit', '-m', 'first');
    const earlier = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'verified candidate');
    const sha = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', remote);
    git('push', 'origin', 'main');
    const record = JSON.stringify({ version, tagSha: sha });
    fs.writeFileSync(path.join(evidence, 'verified.json'), record);
    if (scenario !== 'missing evidence') fs.writeFileSync(path.join(evidence, 'preflight.json'), record);
    if (scenario === 'moved tag') {
      git('tag', tag, sha);
      git('tag', '-f', tag, earlier);
    }
    if (scenario === 'rejected push') fs.writeFileSync(path.join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    if (scenario === 'moved remote tag') git('--git-dir', remote, 'update-ref', 'refs/tags/' + tag, earlier);
    if (scenario === 'non-main') git('switch', '-c', 'topic');
    if (scenario === 'dirty') fs.writeFileSync(path.join(repo, 'untracked'), 'dirty');
    if (scenario === 'stale SHA') git('commit', '--allow-empty', '-m', 'later');
    if (scenario === 'remote main moved') git('--git-dir', remote, 'update-ref', 'refs/heads/main', earlier);
    const before = git('--git-dir', remote, 'show-ref');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Version', version, '-Work', evidence, '-Stage', 'tag'];
    if (scenario === 'wrong owner SHA') args.push('-ExpectedSha', earlier);
    else if (scenario === 'short owner SHA') args.push('-ExpectedSha', sha.slice(0, 12));
    else if (scenario !== 'missing owner SHA') args.push('-ExpectedSha', sha);
    const runEnv = scenario === 'wrong origin' ? env : { ...env, FILOW_RELEASE_TEST_ORIGIN: remote };
    const runner = spawnSync('pwsh', args, { cwd: repo, env: runEnv, encoding: 'utf8', timeout: 20000 });
    if (runner.error) throw runner.error;
    if (scenario === 'clean') {
      expect(runner.status, runner.stderr).toBe(0);
      expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/' + tag)).toBe(sha);
    } else {
      expect(runner.status, scenario).toBe(1);
      expect(git('--git-dir', remote, 'show-ref')).toBe(before);
      if (scenario === 'rejected push') expect(runner.stderr).toMatch(/Tag push failed/);
      if (scenario === 'wrong origin') expect(runner.stderr).toMatch(/stefandsl\/filow/);
    }
  });

if (process.platform === 'win32') {
  it('refuses Windows PowerShell 5.1 for tag before touching remote refs', () => {
    const dir = fs.mkdtempSync(path.join(root, 'ps51-'));
    const repo = path.join(dir, 'checkout');
    const remote = path.join(dir, 'remote.git');
    const evidence = path.join(dir, 'evidence');
    fs.mkdirSync(repo);
    fs.mkdirSync(evidence);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'fixture@example.invalid');
    const script = path.join(repo, 'tools/release/release.ps1');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync('tools/release/release.ps1', script);
    git('add', '.');
    git('commit', '-m', 'first');
    const sha = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', remote);
    git('push', 'origin', 'main');
    const record = JSON.stringify({ version, tagSha: sha });
    fs.writeFileSync(path.join(evidence, 'verified.json'), record);
    fs.writeFileSync(path.join(evidence, 'preflight.json'), record);
    const before = git('--git-dir', remote, 'show-ref');
    const runner = spawnSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Version', version,
        '-Work', evidence, '-Stage', 'tag', '-ExpectedSha', sha],
      { cwd: repo, env: { ...env, FILOW_RELEASE_TEST_ORIGIN: remote }, encoding: 'utf8', timeout: 20000 });
    if (runner.error) throw runner.error;
    expect(runner.status).toBe(1);
    expect(runner.stderr).toMatch(/PowerShell 7/);
    expect(git('--git-dir', remote, 'show-ref')).toBe(before);
  });
}
