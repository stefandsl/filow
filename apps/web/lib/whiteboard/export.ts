// Saving the board: the SVG as a PNG picture, and a text file. Everything happens in the page;
// nothing is sent anywhere. Browser only.

/** A safe file name from a lesson title ("Ohm's law" -> "ohm-s-law"). */
export function fileStem(title: string): string {
  const stem = title.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60);
  return stem || "whiteboard";
}

/** The KaTeX style rules and the fonts the formulas on the board use, as CSS with the fonts inlined. */
async function formulaCss(svg: SVGSVGElement): Promise<string> {
  const used = new Set<string>();
  svg.querySelectorAll(".katex, .katex *").forEach((el) => {
    const family = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
    if (family) used.add(family);
  });
  if (!used.size) return "";
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // a sheet from another origin: not ours
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        if (!used.has(family)) continue;
        const url = /url\("?([^")]+\.woff2)"?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
        if (!url) continue;
        try {
          const bytes = new Uint8Array(await (await fetch(new URL(url, sheet.href ?? location.href))).arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          css += `@font-face{font-family:"${family}";font-style:${rule.style.getPropertyValue("font-style") || "normal"};font-weight:${rule.style.getPropertyValue("font-weight") || "normal"};src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2");}\n`;
        } catch { /* the formula is drawn with a fallback font */ }
      } else if (/\.katex/.test(rule.cssText)) css += rule.cssText + "\n";
    }
  }
  return css;
}

/** The board as it is drawn now (all its steps finished, no animation), as a PNG. */
export async function boardPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const box = svg.viewBox.baseVal;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", String(box.width));
  copy.setAttribute("height", String(box.height));
  copy.removeAttribute("class");
  // The copy carries none of the page's style sheets: strokes are whole and nothing is mid-animation.
  const css = await formulaCss(svg);
  if (css) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    copy.insertBefore(style, copy.firstChild);
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the board could not be drawn as a picture"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the picture could not be encoded"))), "image/png"));
}

/** Hands a file to the browser's own save path (a download; the desktop app shows its save dialog). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
