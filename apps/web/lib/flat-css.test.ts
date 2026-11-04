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
it('retires all glass effects and uses opaque desktop windows', () => {
  expect(css).not.toMatch(/backdrop-filter|data-glass|filter:\s*url\(/);
  const tokens = readFileSync(new URL('../app/theme-tokens.css', import.meta.url), 'utf8');
  expect(tokens).not.toContain('--glass');
  const main = readFileSync(new URL('../../desktop/main.js', import.meta.url), 'utf8');
  expect(main).not.toMatch(/backgroundMaterial|vibrancy|--filow-glass/);
  expect(main.match(/backgroundColor: uiTheme\(\) === "dark" \? "#121212" : "#f6f7f9"/g)?.length).toBeGreaterThanOrEqual(2);
});

it('keeps the light transcript heading hidden after general button styling', () => {
  expect(css).toContain('[data-layout="sidebar"] .prompter .transcript-heading { display: none; }');
});
