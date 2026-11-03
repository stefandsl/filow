type RGB = { r: number; g: number; b: number };
type RGBA = RGB & { a: number };

export function compositeOver(tint: RGBA, backdrop: RGB): RGB {
  return {
    r: tint.r * tint.a + backdrop.r * (1 - tint.a),
    g: tint.g * tint.a + backdrop.g * (1 - tint.a),
    b: tint.b * tint.a + backdrop.b * (1 - tint.a),
  };
}

export function contrastRatio(fg: RGB, bg: RGB): number {
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c: RGB) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function parseRgba(css: string): RGBA {
  const match = css.trim().match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  if (!match) throw new Error(`Invalid rgba tint: ${css}`);
  const [r, g, b, a] = match.slice(1).map(Number);
  if ([r, g, b].some(value => value > 255) || a > 1) throw new Error(`Invalid rgba tint: ${css}`);
  return { r, g, b, a };
}
