// Prover C15: each card's leader must end at that card's own box, also once the move bar is shown.
// A minimal fake DOM (the repo runs vitest in node, no jsdom) with offsetTop/offsetHeight laid out as the
// .okf-cards flex column does (gap 12 px, bar 24 px, each card 100 px).
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";

class FakeNode {
  nodeType: number;
  nodeName: string;
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  ownerDocument: unknown;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> & { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void };
  attrs: Record<string, string> = {};
  className = "";
  _text = "";
  constructor(type: number, name: string, doc: unknown) {
    this.nodeType = type; this.nodeName = name.toUpperCase(); this.ownerDocument = doc;
    const s: Record<string, unknown> = {};
    s.setProperty = (k: string, v: string) => { s[k] = v; };
    s.removeProperty = (k: string) => { delete s[k]; };
    this.style = s as never;
  }
  get tagName() { return this.nodeName; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): FakeNode | null { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; }
  appendChild(c: FakeNode) { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c: FakeNode, ref: FakeNode | null) { if (!ref) return this.appendChild(c); c.parentNode?.removeChild(c); this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); c.parentNode = this; return c; }
  removeChild(c: FakeNode) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); if (k === "class") this.className = String(v); }
  setAttributeNS(_ns: string, k: string, v: string) { this.setAttribute(k, v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  hasAttribute(k: string) { return k in this.attrs; }
  addEventListener() {}
  removeEventListener() {}
  set textContent(v: string) { this.childNodes = []; this._text = v; }
  get textContent() { return this._text; }
  set nodeValue(v: string) { this._text = v; }
  get nodeValue() { return this._text; }
  /** Laid out as the flex column: bar 24 px, card 100 px, gap 12 px. */
  get offsetHeight(): number {
    if (this.className.includes("okf-cards-bar")) return 24;
    if (this.className.includes("okf-card") && this.nodeName === "ARTICLE") return 100;
    if (this.className.includes("okf-cards")) { const k = this.children; return k.reduce((s, c) => s + c.offsetHeight, 0) + Math.max(0, k.length - 1) * 12; }
    return 0;
  }
  get offsetTop(): number {
    const p = this.parentNode; if (!p) return 0;
    let top = 0;
    for (const c of p.children) { if (c === this) return top; top += c.offsetHeight + 12; }
    return top;
  }
}

function fakeDocument() {
  const doc: Record<string, unknown> = {};
  doc.createElement = (t: string) => new FakeNode(1, t, doc);
  doc.createElementNS = (_ns: string, t: string) => { const n = new FakeNode(1, t, doc); n.namespaceURI = _ns; return n; };
  doc.createTextNode = (s: string) => { const n = new FakeNode(3, "#text", doc); n._text = s; return n; };
  doc.createComment = (s: string) => { const n = new FakeNode(8, "#comment", doc); n._text = s; return n; };
  doc.addEventListener = () => {}; doc.removeEventListener = () => {};
  doc.documentElement = new FakeNode(1, "html", doc);
  doc.body = new FakeNode(1, "body", doc);
  doc.activeElement = doc.body;
  return doc;
}

const all = (n: FakeNode, out: FakeNode[] = []) => { out.push(n); n.childNodes.forEach((c) => all(c, out)); return out; };

describe("OK Filow cards: each leader ends at its own card", () => {
  it("with the move bar shown, card 1's leader ends at card 1's box, not card 0's", async () => {
    const doc = fakeDocument();
    const g = globalThis as Record<string, unknown>;
    g.document = doc;
    g.window = Object.assign(globalThis, { innerWidth: 1920, innerHeight: 1080, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} });
    g.IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    const { CardsLayer } = await import("@/components/okfilow/cards-layer");
    const { cardLeader, leadersFor, CARD_WIDTH } = await import("@/lib/buddy/cards");

    const container = new FakeNode(1, "div", doc);
    (doc.body as FakeNode).appendChild(container);
    // Two cards about two spots far apart (each gets its own leader).
    const cards = [
      { title: "A", text: "first", photo: "", x: 300, y: 300 },
      { title: "B", text: "second", photo: "", x: 300, y: 800 },
    ];
    const move = { moved: {}, onBox: () => {}, onReset: () => {} };
    const root = createRoot(container as never);
    await act(async () => {
      root.render(createElement(CardsLayer, { cards: cards as never, avoid: () => [], move: move as never, t: (k: string) => k } as never));
    });
    await act(async () => { await Promise.resolve(); });

    const nodes = all(container);
    const col = nodes.find((n) => n.nodeName === "DIV" && n.className.split(" ").includes("okf-cards"))!;
    expect(col.children.some((c) => c.className.includes("okf-cards-bar"))).toBe(true); // the overlay's move bar is shown
    const left = parseFloat(col.style.left), top = parseFloat(col.style.top);
    const articles = col.children.filter((c) => c.nodeName === "ARTICLE");
    expect(articles).toHaveLength(2);
    const box = (a: FakeNode) => ({ left, top: top + a.offsetTop, right: left + CARD_WIDTH, bottom: top + a.offsetTop + a.offsetHeight });
    const lines = nodes.filter((n) => n.nodeName === "LINE" && n.attrs.class === "okf-card-ink");
    expect(leadersFor(cards)).toEqual([true, true]);
    expect(lines).toHaveLength(2);
    const ends = lines.map((l) => ({ x: Number(l.attrs.x2), y: Number(l.attrs.y2) }));
    const width = CARD_WIDTH;
    const want = cards.map((c, i) => cardLeader(c, { ...box(articles[i]), right: left + width }).to);
    expect(ends).toEqual(want);
    await act(async () => root.unmount());
  });
});
