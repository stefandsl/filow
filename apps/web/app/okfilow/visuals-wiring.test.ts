// The overlay's cards, the pointer, the exit and the 3D view: the CSS and the pages say what the pure helpers say.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_EXIT, CARD_WIDTH } from "@/lib/buddy/cards";
import { POINT_LABEL_AT, pointLabelFlip } from "@/lib/buddy/motion";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8").replace(/\r\n/g, "\n");
const css = read("okfilow.css");
const overlay = read("overlay/page.tsx");
const model = read("model/page.tsx");
const cardsLayer = read("../../components/okfilow/cards-layer.tsx");
const rule = (sel: string) => {
  const at = css.indexOf("\n" + sel + " {");
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};
const keyframes = (name: string) => {
  const at = css.indexOf(`@keyframes ${name} {`);
  expect(at, name).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("\n", at));
};
const sec = (n: number) => `${+(n / 1000).toFixed(3)}s`;

describe("the cards", () => {
  it("are opaque from their first frame: an opaque body, an entry that moves only size and position", () => {
    const card = rule(".okf-card");
    expect(card).toMatch(/background: rgb\(/);
    expect(card).not.toMatch(/opacity/);
    expect(card).toContain("animation: okf-card-in");
    const entry = keyframes("okf-card-in");
    expect(entry).not.toContain("opacity");
    expect(entry).toContain("transform");
  });

  it("decode their picture before they show, and have no picture area without one", () => {
    expect(cardsLayer).toContain("img.decode()");
    expect(cardsLayer).toContain("{s.photos[i] && <img");
    expect(cardsLayer).toContain("Promise.all(cards.map((c) => decoded(c.photo)))");
  });

  it("are placed beside their subject with a leader, by the pure placement", () => {
    expect(overlay).toContain("<CardsLayer cards={cards} avoid={cardAvoid} />");
    expect(cardsLayer).toContain("placeCards(subjects[0], size, view, avoid(), subjects)");
    expect(cardsLayer).toContain("cardLeader(p, boxes[i])");
    expect(rule(".okf-card")).toContain(`width: ${CARD_WIDTH}px`);
    expect(rule(".okf-card")).toContain("font: 14px/1.45");
  });

  it("go away like the marks: a fade, then the leader erases", () => {
    expect(rule(".okf-cards--leaving .okf-card")).toContain(`okf-out ${sec(CARD_EXIT.cardMs)}`);
    const leader = rule(".okf-cards--leaving .okf-card-leader line");
    expect(leader).toContain(`okf-erase ${sec(CARD_EXIT.leaderMs)}`);
    expect(leader).toContain(`${sec(CARD_EXIT.leaderDelayMs)} forwards`);
  });
});

describe("the exit", () => {
  it("fades the ink while it erases, so no full-strength stub is left mid-exit", () => {
    const erase = keyframes("okf-erase");
    expect(erase).toMatch(/100% \{ stroke-dashoffset: 1; opacity: 0; \}/);
    expect(erase).toMatch(/40% \{ opacity: 0\.45; \}/);
  });
});

describe("the pointer", () => {
  it("is a bigger outlined glyph with a light halo, its tip on the spot", () => {
    expect(overlay).toContain('viewBox="0.5 -0.5 23 23" width="36" height="36"');
    expect(overlay).toContain('<path className="okf-arrow-halo" d={ARROW} /><path d={ARROW} />');
    expect(rule(".okf-arrow .okf-arrow-halo")).toContain("stroke: rgba(255, 255, 255, 0.92)");
    expect(rule(".okf-arrow path")).toContain("stroke: #08090b");
  });

  it("plays one ring per arrival, and docks its label as it lands", () => {
    expect(overlay).toContain("if (k >= 1 && !g.arrived)");
    expect(overlay).toContain("{arrivals > 0 && <i key={arrivals} className=\"okf-arrival\" />}");
    expect(overlay).toContain("if (k >= POINT_LABEL_AT)");
    expect(POINT_LABEL_AT).toBeGreaterThan(0.5);
    expect(POINT_LABEL_AT).toBeLessThan(1);
    expect(rule(".okf-label")).toContain("left: 14px; top: -24px");
  });

  it("docks its label on the side with room", () => {
    const view = { width: 1920, height: 1080 };
    expect(pointLabelFlip({ x: 800, y: 500 }, view)).toEqual({ left: false, down: false });
    expect(pointLabelFlip({ x: 1800, y: 500 }, view)).toEqual({ left: true, down: false });
    expect(pointLabelFlip({ x: 800, y: 20 }, view)).toEqual({ left: false, down: true });
  });
});

describe("the 3D view", () => {
  it("has no panel: no title bar, no footer, a transparent page", () => {
    expect(model).not.toContain("okf-model-head");
    expect(model).not.toContain("okf-model-foot");
    expect(rule(".okf-model")).toContain("background: transparent");
  });

  it("is lit by three lights with filmic tone mapping and an environment", () => {
    expect(model).toContain("THREE.ACESFilmicToneMapping");
    expect(model).toContain("new RoomEnvironment()");
    expect(model.match(/new THREE\.DirectionalLight\(/g)?.length).toBe(3);
    expect(model).toContain("new THREE.EdgesGeometry(");
  });

  it("labels its parts on leaders laid out every frame, as buttons the keyboard reaches", () => {
    expect(model).toContain("layoutPartLabels(pts,");
    expect(model).toContain('className="okf-part"');
    expect(model).toContain("onClick={() => ask(l.name)}");
    expect(rule(".okf-part")).toContain("transition: none");
  });

  it("does not turn by itself under reduced motion", () => {
    expect(model).toContain("controls.autoRotate = !still;");
  });
});
