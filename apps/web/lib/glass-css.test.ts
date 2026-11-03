import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import postcss from 'postcss';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const sheet = postcss.parse(css);
it('uses shadows instead of drawn borders on glass layers', () => {
  sheet.walkRules(rule => {
    if (rule.selectors.some(selector => /(?:^|\s)(?:[\w-]+)?\.(?:glass-raised|glass-sheet|glass-flat|point|strip|chip|modal|btn|dock|source|footer|missed-item)(?:[.:][\w()-]+)*$/.test(selector))) {
      rule.walkDecls('border', declaration => {
        expect.fail(`Glass layer ${rule.selector} declares ${declaration.toString()}`);
      });
    }
  });
});
it('keeps opaque raised and sheet fallbacks outside feature queries', () => {
  for (const [selector, token] of [['.glass-raised', '--panel'], ['.glass-sheet', '--panel-2'], ['.dock', '--panel']]) {
    const backgrounds: string[] = [];
    sheet.walkRules(rule => {
      if (rule.parent?.type === 'root' && rule.selectors.includes(selector)) {
        rule.walkDecls('background', declaration => { backgrounds.push(declaration.value); });
      }
    });
    expect(backgrounds.at(-1)).toBe(`var(${token})`);
  }
});
it('limits blur to the point budget, preview, Screen Sense, footer and dock or modal', () => {
  const allowed = ['.glass-raised', '.point:not(.far)', '.modal', '.glass-sheet', '.strip.preview', '.strip.onscreen', '.footer', '.dock', '.settings .strip', '.settings input.btn', '.settings select.btn'];
  sheet.walkDecls(/backdrop-filter$/, declaration => {
    const rule = declaration.parent;
    expect(rule?.type).toBe('rule');
    if (rule?.type === 'rule') for (const selector of rule.selectors) expect(allowed).toContain(selector);
  });
  expect(css).toContain('.app > .modal-bg:has(~ .modal-bg) { display: none; }');
  expect(css).toContain('.app:has(> .modal-bg) > .topbar .modal-bg { display: none; }');
});
it('keeps settings panels, model lists and controls borderless', () => {
  sheet.walkRules(rule => {
    if (!rule.selectors.some(s => s.includes('.settings') || s.includes('.keys kbd'))) return;
    rule.walkDecls(/^border(?:-(?:top|right|bottom|left))?$/, d => {
      expect.fail(`Settings layer ${rule.selector} declares ${d.toString()}`);
    });
  });
  const page = readFileSync(new URL('../app/settings/local/page.tsx', import.meta.url), 'utf8');
  const resources = readFileSync(new URL('../components/ResourcesPanel.tsx', import.meta.url), 'utf8');
  expect(page + resources).not.toMatch(/border\s*:\s*["']?1px solid/);
});
it('puts displacement only on decorative pseudo-elements and removes both effects for reduced motion', () => {
  sheet.walkDecls('filter', declaration => {
    if (!declaration.value.includes('url(')) return;
    const rule = declaration.parent;
    expect(rule?.type).toBe('rule');
    if (rule?.type === 'rule') expect(rule.selectors).toEqual(['.dock::before', '.dock .btn::before']);
  });
  const reduced = sheet.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(prefers-reduced-motion: reduce)');
  expect(reduced?.type).toBe('atrule');
  if (reduced?.type !== 'atrule') return;
  for (const selector of ['.dock::before', '.dock .btn::before']) {
    const values: Record<string, string> = {};
    reduced.walkRules(selector, rule => { rule.walkDecls(d => { values[d.prop] = d.value; }); });
    expect(values).toMatchObject({ filter: 'none', 'background-image': 'none' });
  }
  expect(reduced.toString()).toContain('animation: none !important');
});
it('never uses accent as a text colour and protects exposed metadata', () => {
  sheet.walkDecls('color', declaration => { expect(declaration.value).not.toMatch(/var\(--accent(?:-2)?\)/); });
  for (const selector of ['.log', '.section-count', '.subtitle']) {
    let protectedText = false;
    sheet.walkRules(rule => {
      if (rule.selectors.includes(selector)) rule.walkDecls('background', d => { protectedText ||= d.value === 'var(--glass-flat)'; });
    });
    expect(protectedText, selector).toBe(true);
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
