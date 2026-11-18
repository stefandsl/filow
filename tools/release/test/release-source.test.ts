import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../release.ps1', import.meta.url));
const desktopPackage = fileURLToPath(new URL('../../../apps/desktop/package.json', import.meta.url));
const temp = fileURLToPath(new URL('../../../tmp/', import.meta.url));
fs.mkdirSync(temp, { recursive: true });
const scratch = fs.mkdtempSync(path.join(temp, 'release-source-'));
const sha = 'a'.repeat(40);
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function runStage(work: string, version = '1.2.3', mockGit = '', stage = 'tag') {
  const checkout = path.join(work, 'checkout');
  const fixtureScript = path.join(checkout, 'tools/release/release.ps1');
  fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
  fs.copyFileSync(script, fixtureScript);
  fs.mkdirSync(path.join(checkout, 'apps/desktop/vendor'), { recursive: true });
  fs.copyFileSync(desktopPackage, path.join(checkout, 'apps/desktop/package.json'));
  // Shadow Git in the child process. Even an unexpected Git command cannot touch a ref.
  const command = `
    $ErrorActionPreference = 'Stop'
    $global:resolved = $false
    function git { Add-Content -LiteralPath (Join-Path $env:TEST_WORK 'git.log') -Value ($args -join ' '); $global:LASTEXITCODE = 0; ${mockGit} }
    function npm {
      if (($args -join ' ') -eq 'run vendor -w apps/desktop') {
        New-Item apps/desktop/vendor/hardware.js,apps/desktop/vendor/i18n.js -ItemType File | Out-Null
      }
      $global:LASTEXITCODE = 0
    }
    function npx {
      if (!(Test-Path apps/desktop/vendor/hardware.js)) { throw 'Vitest needs the generated hardware bundle' }
      if (Test-Path apps/desktop/vendor/i18n.js) { throw 'CI runs Vitest without the generated dictionary' }
      $global:LASTEXITCODE = 0
    }
    & $env:TEST_SCRIPT -Stage $env:TEST_STAGE -Version $env:TEST_VERSION -Work $env:TEST_WORK
    exit $LASTEXITCODE
  `;
  const result = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, TEST_WORK: work, TEST_SCRIPT: fixtureScript, TEST_STAGE: stage, TEST_VERSION: version },
    });
  if (result.error) throw result.error;
  const log = path.join(work, 'git.log');
  return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : [] };
}

it.each([
  ['missing', undefined], ['malformed', '{'], ['missing-sha', '{"version":"1.2.3"}'],
  ['abbreviated', JSON.stringify({ version: '1.2.3', tagSha: 'abcd' })],
  ['wrong-version', JSON.stringify({ version: '1.2.2', tagSha: sha })],
  ['invalid-version', JSON.stringify({ version: '01.2.3', tagSha: sha })],
] as const)('refuses %s evidence before invoking Git', (name, evidence) => {
  const work = fs.mkdtempSync(path.join(scratch, name));
  fs.writeFileSync(path.join(work, 'verified.json'), JSON.stringify({ version: '1.2.3', tagSha: sha }));
  if (evidence !== undefined) fs.writeFileSync(path.join(work, 'preflight.json'), evidence);
  const result = runStage(work, name === 'invalid-version' ? '01.2.3' : '1.2.3');
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});

it.each([false, true])('pushes the recorded commit despite a moved local tag (rejected=%s)', rejected => {
  const work = fs.mkdtempSync(path.join(scratch, 'tag-'));
  fs.writeFileSync(path.join(work, 'preflight.json'), JSON.stringify({ version: '1.2.3', tagSha: sha }));
  fs.copyFileSync(path.join(work, 'preflight.json'), path.join(work, 'verified.json'));
  // A source ref resolves to a different commit. Only the literal verified SHA is safe.
  const mockGit = `
    if ($args[-1] -ne '${sha}:refs/tags/v1.2.3') { throw 'Moved local tag' }
    $global:LASTEXITCODE = ${rejected ? 1 : 0}
  `;
  const result = runStage(work, '1.2.3', mockGit);
  expect(result.calls).toEqual([`push --no-follow-tags origin ${sha}:refs/tags/v1.2.3`]);
  expect(result.status).toBe(rejected ? 1 : 0);
  if (rejected) expect(result.stderr).toContain('Tag push failed');
});

it('requires matching local verification and preflight before pushing the tag', () => {
  const work = fs.mkdtempSync(path.join(scratch, 'verification-'));
  fs.writeFileSync(path.join(work, 'preflight.json'), JSON.stringify({ version: '1.2.3', tagSha: sha }));
  const missingLocal = runStage(work);
  expect(missingLocal.status).toBe(1);
  expect(missingLocal.calls).toEqual([]);
  fs.writeFileSync(path.join(work, 'verified.json'), JSON.stringify({ version: '1.2.3', tagSha: 'b'.repeat(40) }));
  const result = runStage(work);
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});

it.each(['clean', 'integration', 'detached', 'different-main', 'switched', 'moved', 'dirty', 'rejected'])('verifies and pins the main push (%s)', scenario => {
  const work = fs.mkdtempSync(path.join(scratch, 'main-'));
  const version = JSON.parse(fs.readFileSync(desktopPackage, 'utf8')).version;
  const mockGit = `
    if ($args[0] -eq 'status' -and '${scenario}' -eq 'dirty') { ' M file' }
    if ($args[0] -eq 'symbolic-ref') {
      if ('${scenario}' -eq 'detached') { $global:LASTEXITCODE = 1 }
      elseif ('${scenario}' -eq 'integration' -or ('${scenario}' -eq 'switched' -and $global:resolved)) { 'refs/heads/integration/2026-11-18' }
      else { 'refs/heads/main' }
    }
    if ($args[0] -eq 'rev-parse') {
      $main = $args[-1] -eq 'refs/heads/main^{commit}'
      if ($main -and '${scenario}' -in 'integration','different-main') { '${'b'.repeat(40)}' }
      elseif ($global:resolved -and '${scenario}' -eq 'moved') { '${'b'.repeat(40)}' }
      else { '${sha}' }
      if ($main) { $global:resolved = $true }
    }
    if ($args[0] -eq 'push' -and '${scenario}' -eq 'rejected') { $global:LASTEXITCODE = 1 }
  `;
  const result = runStage(work, version, mockGit, 'verify-main');
  expect(result.status, result.stderr).toBe(scenario === 'clean' ? 0 : 1);
  const pushes = result.calls.filter(call => call.startsWith('push '));
  if (scenario === 'clean' || scenario === 'rejected') {
    expect(pushes).toEqual([`push --no-follow-tags origin ${sha}:refs/heads/main`]);
    expect(JSON.parse(fs.readFileSync(path.join(work, 'verified.json'), 'utf8'))).toEqual({ version, tagSha: sha });
  } else {
    expect(pushes).toEqual([]);
    expect(fs.existsSync(path.join(work, 'verified.json'))).toBe(false);
  }
});
