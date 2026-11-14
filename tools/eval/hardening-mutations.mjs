import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const cases = [
  ['empty-retry', 'apps/web/lib/buddy/providers.ts', 'attempt < 2', 'attempt < 1', 'apps/web/lib/buddy/empty-local.test.ts'],
  ['empty-words', 'apps/web/lib/buddy/providers.ts', 'if (/[\\p{L}\\p{N}]/u.test(parseBuddyAnswer(raw, req.screens).text)) return;', 'if (raw) return;', 'apps/web/lib/buddy/empty-local.test.ts'],
  ['empty-message', 'apps/web/lib/buddy/providers.ts', 'yield t("local.noAnswer", answerLang(req.question, req.language));', 'return;', 'apps/web/lib/buddy/empty-local.test.ts'],
  ...['addressHour', 'emailQuarter', 'emailDay', 'deviceHour'].map(key => [key, 'apps/cloud/abuse.mjs', `limits.${key}`, 'Number.MAX_SAFE_INTEGER', 'apps/cloud/abuse.test.ts']),
  ['device-cap', 'apps/cloud/abuse.mjs', '>= limits.devices', '>= Number.MAX_SAFE_INTEGER', 'apps/cloud/abuse.test.ts'],
  ['runtime-check', 'apps/web/lib/buddy/providers.ts', 'if (runtime.state !== "ready")', 'if (false)', 'apps/desktop/ollama-runtime.test.ts'],
  ['ownership-delete', 'apps/web/app/api/local/pull/route.ts', 'if (!found || !record.ownsModel(base, name, found.digest))', 'if (false)', 'apps/web/lib/localOwnership.test.ts'],
  ['ownership-preexisting', 'apps/desktop/local-ownership.js', 'preexisting: Boolean(found)', 'preexisting: false', 'apps/web/lib/localOwnership.test.ts'],
  ['ownership-digest', 'apps/desktop/local-ownership.js', 'entry.digest === digest', 'true', 'apps/web/lib/localOwnership.test.ts'],
];
const root = 'G:/FILOW/tmp/hardening';
const results = [];
for (const [name, file, from, to, test] of cases) {
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(from)) throw Error('Missing mutation ' + name);
  try {
    fs.writeFileSync(file, original.replace(from, to));
    const report = `${root}/mutation-${name}.json`;
    const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', test, '--maxWorkers=1', '--reporter=json', '--outputFile=' + report], { windowsHide: true, timeout: 60000, encoding: 'utf8', env: { ...process.env, TEMP: root, TMP: root } });
    const data = JSON.parse(fs.readFileSync(report, 'utf8'));
    const killed = r.status === 1 && data.numFailedTests > 0;
    results.push({ name, killed, failed: data.numFailedTests });
    console.log(name, killed, data.numFailedTests);
    if (!killed) throw Error('Survived ' + name);
  } finally { fs.writeFileSync(file, original); fs.writeFileSync(`${root}/mutations.json`, JSON.stringify(results, null, 2)); }
}
