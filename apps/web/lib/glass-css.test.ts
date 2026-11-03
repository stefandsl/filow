import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import postcss from 'postcss';
import ts from 'typescript';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const sheet = postcss.parse(css);
it('uses a fixed rem scale, tabular readings and token browser surfaces', () => {
  const tokens = readFileSync(new URL('../app/theme-tokens.css', import.meta.url), 'utf8');
  const sizes = [...tokens.matchAll(/--type-[\w]+:\s*([\d.]+)rem/g)].map(m => Number(m[1]));
  expect(sizes.length).toBeGreaterThan(5);
  for (let i = 1; i < sizes.length; i++) {
    expect(sizes[i] / sizes[i - 1]).toBeGreaterThanOrEqual(1.125);
    expect(sizes[i] / sizes[i - 1]).toBeLessThanOrEqual(1.2);
  }
  for (const source of [css, readFileSync(new URL('../../desktop/welcome.css', import.meta.url), 'utf8')]) {
    expect(source).toContain('font-variant-numeric: tabular-nums');
    expect(source).toContain('caret-color: var(--accent)');
    expect(source).toContain('scrollbar-color: var(--muted) var(--panel)');
    expect(source).toContain('::selection');
    postcss.parse(source).walkDecls('letter-spacing', d => {
      if (d.value.endsWith('em')) expect(parseFloat(d.value)).toBeGreaterThanOrEqual(-0.03);
    });
  }
  expect(css).toContain('font-size: 1.375rem; font-weight: 700');
  const component = readFileSync(new URL('../components/Teleprompter.tsx', import.meta.url), 'utf8');
  expect(component).not.toContain('t("stage.eyebrow")');
});
it('uses quiet labels, keyboard focus and bounded control transitions', () => {
  for (const source of [css, readFileSync(new URL('../../desktop/welcome.css', import.meta.url), 'utf8')]) {
    postcss.parse(source).walkDecls('text-transform', d => { expect(d.value.toLowerCase()).not.toBe('uppercase'); });
    expect(source).toContain('outline: 2px solid var(--accent); outline-offset: 2px');
    expect(source).toContain('opacity: 0.5; cursor: default');
    postcss.parse(source).walkDecls('transition', d => {
      if (d.value.startsWith('none')) return;
      for (const part of d.value.split(',')) expect(part.trim()).toMatch(/^(background|box-shadow|transform|opacity) 1[5-9]0ms ease-out$/);
    });
    expect(source).not.toContain('animation: pulse');
  }
});
it('uses drawn icons and plain visible strings across all polish surfaces', () => {
  const paths = ['../components/Teleprompter.tsx', '../components/LangSwitch.tsx', '../components/ResourcesPanel.tsx', '../components/PairPanel.tsx', '../app/settings/local/page.tsx', '../app/mirror/page.tsx', '../../../packages/ui/src/StageView.tsx', '../../../packages/ui/src/OnScreenStrip.tsx'];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        expect(node.text, `${path}: ${node.getStart(ast)}`).not.toMatch(/[☀◐☾✓✕×→←—]/u);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  expect(readFileSync(new URL('../../desktop/welcome.html', import.meta.url), 'utf8')).not.toMatch(/[☀◐☾✓✕×→←—]/u);
});
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
  const allowed = ['.glass-raised', '.point:not(.far)', '.modal', '.glass-sheet', '.strip.preview', '.strip.onscreen', '.footer', '.dock', '.settings .strip', '.settings input.btn', '.settings select.btn', '.code-input', '.overlay-bar'];
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
it('keeps mirror controls borderless and overlay points on the protected material', () => {
  sheet.walkRules(rule => {
    if (!rule.selectors.some(s => /\.(?:overlay|stage|compact|pair|code-input)/.test(s))) return;
    rule.walkDecls(/^border(?:-(?:top|right|bottom|left))?$/, d => {
      expect.fail(`Mirror layer ${rule.selector} declares ${d.toString()}`);
    });
    rule.walkDecls('opacity', d => { expect(d.value).toBe('1'); });
  });
  const stage = readFileSync(new URL('../../../packages/ui/src/StageView.tsx', import.meta.url), 'utf8');
  expect(stage).toContain('i >= 10 && !compact ? "far"');
  expect(stage).toContain('className="strip preview"');
  const mirror = readFileSync(new URL('../app/mirror/page.tsx', import.meta.url), 'utf8');
  expect(mirror).not.toMatch(/border\s*:\s*["']?1px solid|opacity\s*:/);
});
it('keeps welcome materials borderless and ships shared splash tokens', () => {
  const welcome = readFileSync(new URL('../../desktop/welcome.css', import.meta.url), 'utf8');
  postcss.parse(welcome).walkDecls(/^border(?:-(?:top|right|bottom|left))?$/, d => {
    expect.fail(`Welcome layer declares ${d.toString()}`);
  });
  expect(welcome).toContain('background: var(--glass-raised)');
  expect(welcome).toContain('background: var(--glass-sheet)');
  expect(welcome).not.toMatch(/var\(--glass(?:-blur)?\)/);
  const splash = readFileSync(new URL('../../desktop/splash.html', import.meta.url), 'utf8');
  expect(splash).toContain('href="vendor/theme-tokens.css"');
  expect(splash).toContain('background: var(--glass-sheet)');
  expect(splash).not.toMatch(/border:\s*1px solid/);
  const pkg = JSON.parse(readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8'));
  expect(pkg.scripts['build:welcome']).toContain('--outfile=vendor/theme-tokens.css');
  expect(pkg.build.files).toContain('vendor/*.css');
});
it('keeps splash text opaque and nearby loading graphics still', () => {
  const splash = readFileSync(new URL('../../desktop/splash.html', import.meta.url), 'utf8');
  const styles = postcss.parse(splash.match(/<style>([\s\S]*?)<\/style>/)![1]);
  styles.walkDecls('animation', d => { expect(d.value).toBe('none'); });
  styles.walkRules('.version', rule => {
    rule.walkDecls('opacity', d => { expect(d.value).toBe('1'); });
  });
  expect(splash).toContain('prefers-reduced-motion: reduce');
  expect(splash).not.toContain('--bg:');
});
