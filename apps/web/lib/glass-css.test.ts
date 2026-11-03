import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
it('uses shadows instead of drawn borders on glass layers', () => {
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1].split(',').some(selector => /^\.(point|strip|chip|modal|btn)(?:[.:][\w()-]+)*$/.test(selector.trim()))) {
      expect(rule[2]).not.toMatch(/border:\s*1px solid/);
    }
  }
});
it('keeps far rows flat and excludes them from blurred selectors', () => {
  expect(css.match(/\.point\.far\s*\{([^}]+)\}/)?.[1]).toContain('var(--glass-flat)');
  expect(css.match(/\.point\.far\s*\{([^}]+)\}/)?.[1]).not.toContain('backdrop-filter');
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[2].includes('backdrop-filter') && rule[1].includes('.point')) expect(rule[1]).toContain('.point:not(.far)');
  }
  const component = readFileSync(new URL('../components/Teleprompter.tsx', import.meta.url), 'utf8');
  expect(component).toMatch(/i\s*>=\s*10\s*\?\s*"far"/);
});
it('disables control refraction for reduced motion', () => {
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.dock \.btn::before\s*\{[^}]*filter:\s*none/);
});
