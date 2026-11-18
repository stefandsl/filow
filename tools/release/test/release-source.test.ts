import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../release.ps1', import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-'));
const sha = 'a'.repeat(40);
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function runStage(work: string, version = '1.2.3', mockGit = '', stage = 'tag') {
  // Shadow Git in the child process. Even an unexpected Git command cannot touch a ref.
  const command = `
    $ErrorActionPreference = 'Stop'
    function git { Add-Content -LiteralPath (Join-Path $env:TEST_WORK 'git.log') -Value ($args -join ' '); $global:LASTEXITCODE = 0; ${mockGit} }
    & $env:TEST_SCRIPT -Stage $env:TEST_STAGE -Version $env:TEST_VERSION -Work $env:TEST_WORK
    exit $LASTEXITCODE
  `;
  const result = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, TEST_WORK: work, TEST_SCRIPT: script, TEST_STAGE: stage, TEST_VERSION: version },
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
  if (evidence !== undefined) fs.writeFileSync(path.join(work, 'preflight.json'), evidence);
  const result = runStage(work, name === 'invalid-version' ? '01.2.3' : '1.2.3');
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});
