import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compositeOver, contrastRatio, parseRgba } from './glass-contrast';

const css = readFileSync(new URL('../app/theme-tokens.css', import.meta.url), 'utf8');
const themes = [
  { name: 'dark', selector: ':root', text: '#f7f7f5', muted: '#a4a8b3' },
  { name: 'light', selector: ':root[data-theme="light"]', text: '#08090b', muted: '#555e73' },
];
const rgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

describe('glass contrast gate', () => {
  it('gives white on black a ratio of 21', () => {
    expect(contrastRatio(rgb('#ffffff'), rgb('#000000'))).toBeCloseTo(21, 2);
  });
  for (const theme of themes) {
    for (const layer of ['raised', 'sheet', 'flat']) {
      for (const backdrop of ['#ffffff', '#000000']) {
        it(`${theme.name} ${layer} over ${backdrop} preserves text and muted contrast`, () => {
          const block = css.slice(css.indexOf(`${theme.selector} {`)).match(/\{([^}]+)\}/)![1];
          const value = block.match(new RegExp(`--glass-${layer}:\\s*([^;]+);`))![1];
          const background = compositeOver(parseRgba(value), rgb(backdrop));
          const token = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6});`))![1];
          expect(token('text')).toBe(theme.text);
          expect(token('muted')).toBe(theme.muted);
          expect(contrastRatio(rgb(token('text')), background)).toBeGreaterThanOrEqual(7);
          expect(contrastRatio(rgb(token('muted')), background)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
