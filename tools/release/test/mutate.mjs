// Deliberately remove each validation rule, require a red assertion, and restore in finally.
// Run from the repository root. No network or installer execution.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'tools/release/release-verify.mjs';
const original = fs.readFileSync(file, 'utf8');
const rules = [...original.matchAll(/\/\/ rule:([a-z0-9-]+)/g)].map(m => m[1]);
const results = [];
fs.mkdirSync('tmp/r2-mutations', { recursive: true });
try {
  for (const rule of rules) {
    const lines = original.split('\n');
    const end = lines.findIndex(l => l.trimEnd().endsWith(`// rule:${rule}`));
    let start = end;
    while (!lines[start].includes('check(')) start--;
    lines.splice(start, end - start + 1);
    fs.writeFileSync(file, lines.join('\n'));
    const report = `tmp/r2-mutations/${rule}.json`;
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tools/release/test/release-verify.test.ts', '--reporter=json', `--outputFile=${report}`],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    const data = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : {};
    const killed = run.status === 1 && data.numFailedTests > 0;
    results.push({ rule, killed, failedTests: data.numFailedTests ?? 0 });
    console.log(`${rule}: ${killed ? 'KILLED' : 'SURVIVED/ERROR'}`);
    if (!killed) throw new Error(`${rule}: ${run.stderr} ${run.stdout}`);
  }
} finally {
  fs.writeFileSync(file, original);
  fs.writeFileSync('tmp/r2-mutations/results.json', JSON.stringify(results, null, 2));
}
console.log(`${results.length}/${rules.length} mutations killed; original restored`);
