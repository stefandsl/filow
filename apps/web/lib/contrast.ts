type RGB = { r: number; g: number; b: number };

/** WCAG contrast ratio between two opaque colours (1 to 21). */
export function contrastRatio(fg: RGB, bg: RGB): number {
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c: RGB) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
