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

function runStage(
  work: string,
  version = '1.2.3',
  mockGit = '',
  stage = 'tag',
  failWelcome = false,
  { expectedSha = sha as string | null, shell = 'pwsh', originUrl = 'https://github.com/stefandsl/filow.git' } = {},
) {
  const checkout = path.join(work, 'checkout');
  const fixtureScript = path.join(checkout, 'tools/release/release.ps1');
  fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
  fs.copyFileSync(script, fixtureScript);
  fs.mkdirSync(path.join(checkout, 'apps/desktop/vendor'), { recursive: true });
  fs.copyFileSync(desktopPackage, path.join(checkout, 'apps/desktop/package.json'));
  const shaArg = expectedSha === null ? '' : '-ExpectedSha $env:TEST_EXPECTED_SHA';
  // Shadow Git in the child process. Even an unexpected Git command cannot touch a ref.
  const command = `
    $ErrorActionPreference = 'Stop'
    $global:resolved = $false
    function git {
      Add-Content -LiteralPath (Join-Path $env:TEST_WORK 'git.log') -Value ($args -join ' ')
      $global:LASTEXITCODE = 0
      if ($args[0] -eq 'remote' -and $args[1] -eq 'get-url' -and $args[2] -eq 'origin') { $env:TEST_ORIGIN_URL; return }
      ${mockGit}
    }
    function npm {
      if (($args -join ' ') -eq 'run build:welcome -w apps/desktop' -and $env:TEST_FAIL_WELCOME -eq '1') {
        $global:LASTEXITCODE = 1
        return
      }
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
    & $env:TEST_SCRIPT -Stage $env:TEST_STAGE -Version $env:TEST_VERSION -Work $env:TEST_WORK ${shaArg}
    exit $LASTEXITCODE
  `;
  const result = spawnSync(shell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, TEST_WORK: work, TEST_SCRIPT: fixtureScript, TEST_STAGE: stage, TEST_VERSION: version,
        TEST_FAIL_WELCOME: failWelcome ? '1' : '0', TEST_EXPECTED_SHA: expectedSha ?? '', TEST_ORIGIN_URL: originUrl },
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

it.each([false, true])('pushes only the recorded full commit (rejected=%s)', rejected => {
  const work = fs.mkdtempSync(path.join(scratch, 'tag-'));
  fs.writeFileSync(path.join(work, 'preflight.json'), JSON.stringify({ version: '1.2.3', tagSha: sha }));
  fs.copyFileSync(path.join(work, 'preflight.json'), path.join(work, 'verified.json'));
  const mockGit = `
    if ($args[0] -eq 'tag' -or $args[0] -eq 'status') { return }
    if ($args[0] -eq 'ls-remote') { "${sha}$([char]9)refs/heads/main"; return }
    if ($args[0] -eq 'symbolic-ref') { 'refs/heads/main'; return }
    if ($args[0] -eq 'rev-parse') { '${sha}'; return }
    if ($args[-1] -ne '${sha}:refs/tags/v1.2.3') { throw 'Moved local tag' }
    $global:LASTEXITCODE = ${rejected ? 1 : 0}
  `;
  const result = runStage(work, '1.2.3', mockGit);
  expect(result.calls.filter(call => call.startsWith('push '))).toEqual([`push --no-follow-tags origin ${sha}:refs/tags/v1.2.3`]);
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

it.each(['clean', 'integration', 'detached', 'different-main', 'switched', 'moved', 'dirty', 'rejected', 'failed-welcome'])('verifies and pins the main push (%s)', scenario => {
  const work = fs.mkdtempSync(path.join(scratch, scenario + '-'));
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
  const result = runStage(work, version, mockGit, 'verify-main', scenario === 'failed-welcome');
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

it.each(['verify-main', 'preflight', 'tag'] as const)('requires a full 40-char ExpectedSha for %s before invoking Git', stage => {
  const version = JSON.parse(fs.readFileSync(desktopPackage, 'utf8')).version;
  for (const badSha of [null, '', 'abcd', 'A'.repeat(40)]) {
    const work = fs.mkdtempSync(path.join(scratch, `sha-${stage}-`));
    const record = JSON.stringify({ version, tagSha: sha });
    fs.writeFileSync(path.join(work, 'verified.json'), record);
    fs.writeFileSync(path.join(work, 'preflight.json'), record);
    const result = runStage(work, version, '', stage, false, { expectedSha: badSha });
    expect(result.status, `${stage} with ${String(badSha)}`).toBe(1);
    expect(result.calls).toEqual([]);
  }
});

it.each(['verify-main', 'tag'] as const)('refuses an origin remote other than stefandsl/filow in %s', stage => {
  const work = fs.mkdtempSync(path.join(scratch, `origin-${stage}-`));
  const version = JSON.parse(fs.readFileSync(desktopPackage, 'utf8')).version;
  if (stage === 'tag') {
    const record = JSON.stringify({ version, tagSha: sha });
    fs.writeFileSync(path.join(work, 'verified.json'), record);
    fs.writeFileSync(path.join(work, 'preflight.json'), record);
  }
  const mockGit = `
    if ($args[0] -eq 'symbolic-ref') { 'refs/heads/main'; return }
    if ($args[0] -eq 'rev-parse') { '${sha}'; return }
    if ($args[0] -eq 'ls-remote') { "${sha}$([char]9)refs/heads/main"; return }
  `;
  const result = runStage(work, version, mockGit, stage, false, { originUrl: 'https://github.com/other/filow.git' });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/stefandsl\/filow/);
  expect(result.calls.filter(call => call.startsWith('push '))).toEqual([]);
});

if (process.platform === 'win32') {
  it.each(['verify-main', 'tag'] as const)('refuses Windows PowerShell 5.1 for %s before invoking Git', stage => {
    const work = fs.mkdtempSync(path.join(scratch, `ps51-${stage}-`));
    const version = JSON.parse(fs.readFileSync(desktopPackage, 'utf8')).version;
    const record = JSON.stringify({ version, tagSha: sha });
    fs.writeFileSync(path.join(work, 'verified.json'), record);
    fs.writeFileSync(path.join(work, 'preflight.json'), record);
    const result = runStage(work, version, '', stage, false, { shell: 'powershell.exe' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/PowerShell 7/);
    expect(result.calls).toEqual([]);
  });
}
