import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { expectedAssets } from '../release-verify.mjs';

const version = '1.2.3';
const sha = 'a'.repeat(40);
const tool = fileURLToPath(new URL('../release-verify.mjs', import.meta.url));
const tmp = fileURLToPath(new URL('../../../tmp/', import.meta.url));
fs.mkdirSync(tmp, { recursive: true });
const scratch = fs.mkdtempSync(path.join(tmp, 'draft-assets-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

it.each([
  ['good', 'PASS'], ['missing', 'missing named asset'], ['extension', 'differs from source'],
  ['manifest', 'wrong sha512'], ['platform', 'latest-linux.yml'], ['extra', 'unexpected draft'],
  ['smoke', 'Windows smoke test failed'], ['different-commit', 'Windows smoke test failed'],
])('checks downloaded draft bytes and separate Windows smoke evidence (%s)', (scenario, expected) => {
  const work = path.join(scratch, scenario);
  const source = path.join(work, 'source');
  const draft = path.join(work, 'draft');
  const smoke = path.join(work, 'smoke.json');
  fs.mkdirSync(source, { recursive: true });
  for (const name of expectedAssets(version)) fs.writeFileSync(path.join(source, name), name);
  function entry(suffix: string) {
    const url = `Filow-${version}-${suffix}`;
    const bytes = fs.readFileSync(path.join(source, url));
    return { url, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length };
  }
  const installer = entry('win-x64.exe');
  const docs = {
    'latest.yml': [installer],
    'latest-linux.yml': [entry('linux-x86_64.AppImage')],
    'latest-mac.yml': [entry('mac-arm64.zip'), entry('mac-x64.zip')],
  };
  if (scenario === 'platform') docs['latest-linux.yml'] = [installer];
  for (const [name, files] of Object.entries(docs)) {
    fs.writeFileSync(path.join(source, name), JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }));
  }
  fs.cpSync(source, draft, { recursive: true });
  fs.writeFileSync(smoke, JSON.stringify({ installed: true, started: true, exitCode: 0,
    sourceSha: scenario === 'different-commit' ? 'b'.repeat(40) : sha,
    installerSha512: scenario === 'smoke' ? 'other' : installer.sha512 }));
  if (scenario === 'missing') fs.unlinkSync(path.join(draft, 'latest-mac.yml'));
  if (scenario === 'extension') fs.appendFileSync(path.join(draft, `Filow-extension-${version}.zip`), '!');
  if (scenario === 'manifest') fs.appendFileSync(path.join(draft, installer.url), '!');
  if (scenario === 'extra') fs.writeFileSync(path.join(draft, 'builder-debug.yml'), 'debug');
  const result = spawnSync(process.execPath, [tool, 'assets', '--version', version, '--commit', sha,
    '--source', source, '--dir', draft, '--smoke', smoke], { encoding: 'utf8', timeout: 15000 });
  expect(result.status, result.stderr).toBe(scenario === 'good' ? 0 : 1);
  expect(result.stdout + result.stderr).toContain(expected);
});
