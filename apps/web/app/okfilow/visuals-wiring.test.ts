// The overlay's cards, the pointer, the exit and the 3D view: the CSS and the pages say what the pure helpers say.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_EXIT, CARD_WIDTH } from "@/lib/buddy/cards";
import { flightMs, pointerLanding, pointLabelFlip } from "@/lib/buddy/motion";

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

  it("go away like the marks: cards and leaders fade together as one piece", () => {
    expect(rule(".okf-cards.okf-cards--leaving, .okf-card-leaders.okf-cards--leaving")).toContain(`okf-fade-out ${sec(CARD_EXIT.fadeMs)}`);
    expect(rule(".okf-cards--leaving .okf-card-leader line")).toContain("stroke-dashoffset: 0; animation: none;");
  });
});

describe("the exit", () => {
  it("fades whole marks to nothing, with no erase that could leave a stub", () => {
    expect(keyframes("okf-fade-out")).toBe("@keyframes okf-fade-out { from { opacity: 1; } to { opacity: 0; } }");
    expect(css).not.toContain("okf-erase");
  });
});

describe("the pointer", () => {
  it("is a bigger outlined glyph with a light halo, its tip on the spot", () => {
    expect(overlay).toContain('viewBox="3 2 23 23" width="36" height="36"');
    expect(overlay).toContain('<path className="okf-arrow-halo" d={ARROW} /><path d={ARROW} />');
    expect(rule(".okf-arrow .okf-arrow-halo")).toContain("stroke: rgba(255, 255, 255, 0.92)");
    expect(rule(".okf-arrow path")).toContain("stroke: #08090b");
  });

  it("plays one ring per arrival, and docks its label as it lands", () => {
    expect(overlay).toContain("arrivalPhase(now - g.start, g.dur,");
    expect(overlay).toContain('<i ref={ringEl} className="okf-arrival" />');
    expect(overlay).toContain("labelEl.current.style.left");
    expect(rule(".okf-label")).toContain("animation: none");
  });

  it("flies for longer the further it goes, so no frame jumps far, and stops beside the spot", () => {
    expect(flightMs(0)).toBe(380);
    expect(flightMs(400)).toBe(620);
    expect(flightMs(5000)).toBe(900);
    // at 60 Hz the ease-in-out peaks at twice the mean speed: a 490 px flight moves at most ~30 px a frame
    expect((2 * 490 * 16.7) / flightMs(490)).toBeLessThan(30);
    const at = pointerLanding({ x: 1200, y: 500 });
    expect(at.x).toBeGreaterThan(1200);
    expect(at.y).toBeGreaterThan(500);
    expect(Math.hypot(at.x - 1200, at.y - 500)).toBeLessThan(14);
    expect(overlay).toContain("const plan = planFlight(");
    expect(overlay).toContain("const dur = plan.duration;");
  });

  it("docks its label on the side with room", () => {
    const view = { width: 1920, height: 1080 };
    expect(pointLabelFlip({ x: 800, y: 500 }, view)).toEqual({ left: false, down: false });
    expect(pointLabelFlip({ x: 1800, y: 500 }, view)).toEqual({ left: true, down: false });
    expect(pointLabelFlip({ x: 800, y: 20 }, view)).toEqual({ left: false, down: true });
  });
});

describe("the 3D view", () => {
  it("fills its opaque stage without transparent corner cutouts, title bar or footer", () => {
    expect(model).not.toContain("okf-model-head");
    expect(model).not.toContain("okf-model-foot");
    expect(rule(".okf-model")).toContain("background: rgb(16, 17, 20); border-radius: 0;");
  });

  it("routes the final leader polylines and keeps their initial reading-order identities", () => {
    expect(model).toContain("numbers ??= readingOrder(slots);");
    expect(model).toContain("routeWorker.postMessage({lines:proposed");
    expect(model).toContain("routeWorker.terminate()");
    expect(model).toContain("const points = routes[i].map");
    expect(model).not.toContain("shown[i].x + (s.x - shown[i].x)");
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
