import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { contrastRatio } from './contrast';
const css = readFileSync(new URL('../app/theme-tokens.css', import.meta.url), 'utf8');
const rgb = (hex: string) => ({ r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) });
for (const selector of [':root', ':root[data-theme="light"]']) {
  it(`${selector} protects flat surface contrast`, () => {
    const block = css.slice(css.indexOf(`${selector} {`)).match(/\{([^}]+)\}/)![1];
    const token = (name: string) => {
      const value = block.match(new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6});`))?.[1];
      expect(value, name).toBeDefined();
      return rgb(value!);
    };
    for (const surface of ['bg', 'surface', 'surface-2', 'sidebar', 'row-current']) {
      expect(contrastRatio(token('text'), token(surface))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(token('muted'), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(token('on-accent'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  });
}
