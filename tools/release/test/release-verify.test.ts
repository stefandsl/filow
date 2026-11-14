import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { digest, loadAssets } from '../release-verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../release-verify.mjs');
const base = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/good.json'), 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/failures.json'), 'utf8'));
fs.mkdirSync(path.resolve(here, '../../../tmp'), { recursive: true });
const scratch = fs.mkdtempSync(path.resolve(here, '../../../tmp/r2-fixtures-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
function run(e: any, name: string) {
  const input = path.join(scratch, `${name}.json`);
  fs.writeFileSync(input, JSON.stringify(e));
  return spawnSync(process.execPath, [cli, 'fixture', '--input', input], { encoding: 'utf8', timeout: 10000 });
}
describe('release verification CLI against offline fixtures', () => {
  it('streams actual file hashes and parses all three on-disk manifests', async () => {
    const dir = path.join(scratch, 'on-disk');
    fs.mkdirSync(dir);
    const bytes = Buffer.from('installer fixture bytes');
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    for (const name of Object.keys(base.assets)) fs.writeFileSync(path.join(dir, name), bytes);
    const documents = structuredClone(base.manifests);
    for (const [name, doc] of Object.entries(documents) as [string, any][]) {
      doc.sha512 = sha512;
      doc.size = bytes.length;
      doc.files.forEach((f: any) => { f.sha512 = sha512; f.size = bytes.length; });
      // JSON is a YAML subset; exercises the same safe loader without depending on a writer.
      fs.writeFileSync(path.join(dir, name), JSON.stringify(doc));
    }
    expect(await digest(path.join(dir, 'Filow-1.2.3-win-x64.exe'))).toEqual({ sha512, size: bytes.length });
    expect(Object.keys(await loadAssets(dir, '1.2.3'))).toHaveLength(17);
    fs.appendFileSync(path.join(dir, 'Filow-1.2.3-win-x64.exe'), 'corrupt');
    await expect(loadAssets(dir, '1.2.3')).rejects.toThrow('wrong sha512');
  });
  it('ships the explicit no-downgrade setting in the runtime', () => {
    const main = fs.readFileSync(path.resolve(here, '../../../apps/desktop/main.js'), 'utf8');
    expect(main).toMatch(/^\s*updater\.allowDowngrade = false;/m);
  });
  it('accepts the complete correct fixture', () => {
    const result = run(base, 'good');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS');
  });
  it.each(cases)('$rule: $message', (c: any) => {
    const input = structuredClone(base);
    for (const patch of c.patches) {
      const keys = patch.path;
      const target = keys.slice(0, -1).reduce((o: any, k: string) => o[k], input);
      if (patch.remove) delete target[keys.at(-1)];
      else target[keys.at(-1)] = patch.value;
    }
    const result = run(input, c.rule);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(c.message);
  });
});
