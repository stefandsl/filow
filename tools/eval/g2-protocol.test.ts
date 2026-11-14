import { describe, expect, it } from 'vitest';
// The benchmark is an executable Node module, shared with these contract checks.
// @ts-expect-error no declaration file for the standalone evaluation module
import { blindRecord, percentile, repairBudget } from './g2-protocol.mjs';

describe('g2 frozen evaluation contract', () => {
  it('refuses a second repair across different pipeline calls', () => {
    const budget = repairBudget();
    const outline = { system: 'outline', user: 'topic' };
    const pick = { system: 'pick', user: 'step' };
    budget.visit(outline);
    budget.visit(outline);
    budget.visit(pick);
    expect(() => budget.visit(pick)).toThrow('single local repair');
  });
  it('does not treat checking calls as retries', () => {
    const budget = repairBudget();
    budget.visit({ system: 'check one', user: 'facts' });
    budget.visit({ system: 'check two', user: 'facts' });
    expect(budget.used).toBe(0);
  });
  it('never leaks model identities or raw provider metadata into blind records', () => {
    const result = blindRecord({ model: 'secret-arm', raw: { model: 'secret-arm' }, error: 'secret-arm failed', lesson: null, validity: false });
    expect(JSON.stringify(result)).not.toContain('secret-arm');
    expect(result.error).toBe('generation_failed');
  });
  it('uses nearest-rank percentiles and leaves empty samples unmeasured', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
  });
});
