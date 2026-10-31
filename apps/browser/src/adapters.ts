// Slide adapters for HTML decks (ARCHITECTURE.md §8.3). Each knows how to read the current slide,
// count slides and move. Content scripts live in an isolated world, so adapters use the DOM, the
// URL and synthetic key events, never the deck's JavaScript objects. All text is untrusted data.

export type SlideInfo = { index: number; total: number; title?: string; text: string; adapter: string };

export type Adapter = {
  name: string;
  detect(): boolean;
  current(): SlideInfo;
  next(): void;
  prev(): void;
};

const visibleText = (el: Element | null) => (el ? (el as HTMLElement).innerText.replace(/\s+\n/g, "\n").trim() : "");
const firstHeading = (el: Element | null) => el?.querySelector("h1, h2, h3")?.textContent?.trim() || undefined;
const key = (k: string, code = k) => {
  const ev = new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(ev);
  document.body.dispatchEvent(ev);
  document.dispatchEvent(ev);
};
const numFromHash = () => {
  const m = location.hash.match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
};

export const reveal: Adapter = {
  name: "reveal.js",
  detect: () => Boolean(document.querySelector(".reveal .slides")),
  current() {
    const sections = [...document.querySelectorAll(".reveal .slides section")].filter((s) => !s.querySelector("section"));
    const present = document.querySelector(".reveal .slides section.present:not(:has(section.present))") ?? document.querySelector(".reveal .slides section.present");
    const index = Math.max(0, sections.indexOf(present as Element));
    return { index, total: sections.length, title: firstHeading(present), text: visibleText(present), adapter: this.name };
  },
  next: () => key("ArrowRight"),
  prev: () => key("ArrowLeft"),
};

export const slidev: Adapter = {
  name: "Slidev",
  detect: () => Boolean(document.querySelector("#slide-content, .slidev-layout, .slidev-page")),
  current() {
    const el = document.querySelector("#slide-content .slidev-layout, .slidev-layout, #slide-content");
    const n = Number(location.pathname.match(/\/(\d+)(?:\/|$)/)?.[1] ?? 1);
    const total = Number(document.querySelector(".slidev-page-indicator, [class*='page']")?.textContent?.match(/\/\s*(\d+)/)?.[1] ?? 0);
    return { index: Math.max(0, n - 1), total, title: firstHeading(el), text: visibleText(el), adapter: this.name };
  },
  next: () => key("ArrowRight"),
  prev: () => key("ArrowLeft"),
};

export const marp: Adapter = {
  name: "Marp",
  detect: () => Boolean(document.querySelector(".marpit section, .bespoke-marp-slide")),
  current() {
    const slides = [...document.querySelectorAll(".marpit section, .bespoke-marp-slide")];
    const active = slides.find((s) => s.classList.contains("bespoke-marp-active") || s.getAttribute("aria-hidden") === "false") ?? slides[Math.max(0, (Number.isNaN(numFromHash()) ? 1 : numFromHash()) - 1)] ?? null;
    const index = Math.max(0, slides.indexOf(active as Element));
    return { index, total: slides.length, title: firstHeading(active), text: visibleText(active), adapter: this.name };
  },
  next: () => key("ArrowRight"),
  prev: () => key("ArrowLeft"),
};

export const impress: Adapter = {
  name: "impress.js",
  detect: () => Boolean(document.querySelector("#impress .step")),
  current() {
    const steps = [...document.querySelectorAll("#impress .step")];
    const active = document.querySelector("#impress .step.active");
    const index = Math.max(0, steps.indexOf(active as Element));
    return { index, total: steps.length, title: firstHeading(active), text: visibleText(active), adapter: this.name };
  },
  next: () => key("ArrowRight"),
  prev: () => key("ArrowLeft"),
};

/** Canva / Pitch present pages and anything else: the text of what is on screen right now. */
export const generic: Adapter = {
  name: "generic",
  detect: () => true,
  current() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const texts: string[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"].includes(node.tagName)) {
        node = walker.nextNode() as HTMLElement | null;
        continue;
      }
      const r = node.getBoundingClientRect();
      const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      if (onScreen && node.childElementCount === 0) {
        const t = (node.innerText || node.textContent || "").trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          texts.push(t);
        }
      }
      node = walker.nextNode() as HTMLElement | null;
    }
    const n = numFromHash();
    const fromPath = Number(location.pathname.match(/\/(\d+)(?:\/|$)/)?.[1]);
    const index = !Number.isNaN(n) ? Math.max(0, n - 1) : !Number.isNaN(fromPath) ? Math.max(0, fromPath - 1) : 0;
    return { index, total: 0, title: texts[0]?.slice(0, 80), text: texts.join("\n"), adapter: this.name };
  },
  next: () => key("ArrowRight"),
  prev: () => key("ArrowLeft"),
};

export const ADAPTERS: Adapter[] = [reveal, slidev, marp, impress, generic];

export function pickAdapter(): Adapter {
  return ADAPTERS.find((a) => a.detect()) ?? generic;
}
