import crypto from 'node:crypto';
import fs from 'node:fs';

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function requireFrozen(root, sourceRoot) {
  const frozen = JSON.parse(fs.readFileSync(`${root}/FROZEN.json`, 'utf8'));
  for (const [file, hash] of Object.entries(frozen.sources)) {
    if (sha256(`${sourceRoot}/${file}`) !== hash) throw new Error(`Frozen source changed: ${file}`);
  }
  return frozen;
}
export function requireModel(model) {
  if (!fs.existsSync(model.path) || fs.statSync(model.path).size !== model.bytes || sha256(model.path) !== model.sha256) {
    throw new Error('Model bytes do not match the frozen manifest');
  }
}
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}
export function repairBudget() {
  const calls = new Set();
  let repairs = 0;
  return {
    visit(call) {
      const key = JSON.stringify([call.system, call.user]);
      if (calls.has(key) && ++repairs > 1) throw new Error('The single local repair budget is exhausted');
      calls.add(key);
      return repairs;
    },
    get used() { return repairs; },
  };
}
export function blindRecord(result) {
  // Do not copy provider responses, request payloads, paths, or runtime/model identities.
  return {
    lesson: result.lesson,
    validity: result.validity,
    repairUsed: result.repairUsed,
    repairMs: result.repairMs,
    firstMeaningfulStepMs: result.firstMeaningfulStepMs,
    totalMs: result.totalMs,
    memoryPeakBytes: result.memoryPeakBytes,
    memoryScope: 'model process only; total app acceptance not verified',
    error: result.error ? 'generation_failed' : null,
  };
}
