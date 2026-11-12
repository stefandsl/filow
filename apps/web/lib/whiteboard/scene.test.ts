import { describe, expect, it } from "vitest";
import cloud from "./fixtures/cloud-r3.json";
import { layoutBoard } from "./layout";
import { validateLesson, type Lesson } from "./lesson";
import { sceneFromLayout, stepOf, type ExEl } from "./scene";
import { texToText } from "./tex";
import { applyEdits, applyOps, cameraFor, diffEdits, excalidrawFile, noEdits, parseExcalidrawFile, readScene } from "./doc";
import { checkScene, countProblems, fixOps } from "./check";

const lessons = (cloud as Array<{ question: string; lesson: unknown }>).map((r) => validateLesson(r.lesson, { maxSteps: 12, sketch: true })).filter((l): l is Lesson => Boolean(l));
const sceneOf = (l: Lesson, upto = l.steps.length - 1) => sceneFromLayout(layoutBoard(l, upto, "wide"));

describe("texToText", () => {
  it("writes the usual formulas of a lesson in Unicode", () => {
    expect(texToText("a^2 + b^2 = c^2")).toBe("a² + b² = c²");
    expect(texToText("I = \\frac{V}{R}")).toBe("I = V/R");
    expect(texToText("A = P\\left(1 + \\frac{r}{n}\\right)^{nt}")).toBe("A = P(1 + r/n)ⁿᵗ");
    expect(texToText("\\frac{a+b}{c}")).toBe("(a+b)/c");
    expect(texToText("x_{1} \\times \\pi \\le \\sqrt{2}")).toBe("x₁ × π ≤ √2");
    expect(texToText("E = mc^{2}\\,\\text{ J}")).toBe("E = mc² J");
    // what has no superscript letters keeps a readable mark
    expect(texToText("e^{-zq}")).toBe("e^(-zq)");
  });
});

describe("sceneFromLayout", () => {
  it("draws every lesson as standard Excalidraw elements with ids, steps and bound labels", () => {
    expect(lessons.length).toBeGreaterThanOrEqual(8);
    for (const l of lessons) {
      const { elements } = sceneOf(l);
      const ids = new Set<string>();
      for (const e of elements) {
        expect(e.id).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(ids.has(e.id), e.id).toBe(false);
        ids.add(e.id);
        expect(["rectangle", "ellipse", "text", "arrow", "line", "image"]).toContain(e.type);
        expect(typeof e.customData?.wb?.step).toBe("number");
      }
      const byId = new Map(elements.map((e) => [e.id, e]));
      for (const e of elements) {
        // a label points at its box and the box lists the label: Excalidraw keeps them together
        if (e.containerId) expect(byId.get(e.containerId)?.boundElements?.some((b) => b.id === e.id)).toBe(true);
        for (const b of e.boundElements ?? []) expect(byId.has(b.id), `${e.id} -> ${b.id}`).toBe(true);
        if (e.type === "arrow" && e.startBinding) expect(byId.get(e.startBinding.elementId)?.boundElements?.some((b) => b.id === e.id)).toBe(true);
      }
      // shapes are transparent with a coloured stroke (the skill's first rule); only marks, dots and the pointed cell are filled
      for (const e of elements.filter((x) => x.type === "rectangle" && x.customData?.wb?.role === "node")) expect(e.backgroundColor).toBe("transparent");
    }
  });

  it("draws each thing as shape, then its label, then the arrows it allows", () => {
    for (const l of lessons) {
      const { elements } = sceneOf(l);
      const at = new Map(elements.map((e, i) => [e.id, i]));
      for (const e of elements) {
        if (e.type === "arrow" && e.customData?.wb?.role === "edge") {
          for (const end of [e.startBinding?.elementId, e.endBinding?.elementId]) if (end) expect(at.get(end)!).toBeLessThan(at.get(e.id)!);
        }
        if (e.containerId && e.type === "text") expect(at.get(e.containerId)!).toBeLessThan(at.get(e.id)!);
      }
      // steps never go backwards
      const steps = elements.map(stepOf);
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    }
  });

  it("is deterministic and keeps ids when the lesson grows", () => {
    const l = lessons[0];
    expect(JSON.stringify(sceneOf(l))).toBe(JSON.stringify(sceneOf(l)));
    const early = new Set(sceneOf(l, 1).elements.filter((e) => e.type === "rectangle").map((e) => e.id));
    const late = new Set(sceneOf(l).elements.map((e) => e.id));
    for (const id of early) expect(late.has(id), id).toBe(true);
  });
});

describe("the board document", () => {
  const l = lessons[0];
  const base = sceneOf(l);
  const arrowEl = base.elements.find((e) => e.type === "arrow" && e.customData?.wb?.role === "edge")!;
  const node = base.elements.find((e) => e.customData?.wb?.role === "node")!;

  it("keeps edits by id across a new layout", () => {
    const { edits } = applyOps(base, noEdits(), [{ op: "update", id: arrowEl.id, props: { strokeColor: "#e03131" } }]);
    const again = applyEdits(sceneOf(l), edits);
    expect(again.elements.find((e) => e.id === arrowEl.id)?.strokeColor).toBe("#e03131");
    // and a colour that is not one is refused
    const bad = applyOps(base, noEdits(), [{ op: "update", id: arrowEl.id, props: { strokeColor: "url(javascript:alert(1))" } }]);
    expect(bad.edits.patch[arrowEl.id]?.strokeColor).toBeUndefined();
  });

  it("deletes a box with its label and its arrows, and reports unknown ids", () => {
    const { edits, skipped } = applyOps(base, noEdits(), [{ op: "delete", id: node.id }, { op: "delete", id: "nope" }]);
    const now = applyEdits(base, edits).elements;
    expect(now.some((e) => e.id === node.id || e.containerId === node.id)).toBe(false);
    expect(now.some((e) => e.startBinding?.elementId === node.id || e.endBinding?.elementId === node.id)).toBe(false);
    expect(skipped).toEqual(["nope"]);
  });

  it("finds what the user changed on the canvas", () => {
    const moved = base.elements.map((e) => (e.id === node.id ? { ...e, x: e.x + 30 } : e)).filter((e) => e.id !== arrowEl.id);
    const drawn: ExEl = { ...node, id: "hand-1", customData: undefined };
    const d = diffEdits(base, noEdits(), [...moved, drawn]);
    expect(d.patch[node.id]).toEqual({ x: node.x + 30 });
    expect(d.deleted).toContain(arrowEl.id);
    expect(d.added.map((e) => e.id)).toEqual(["hand-1"]);
  });

  it("writes and reads .excalidraw files, dropping links and what is not an element", () => {
    const file = excalidrawFile(base);
    const back = parseExcalidrawFile(file)!;
    expect(back.elements.length).toBe(base.elements.length - 1);
    const evil = parseExcalidrawFile(JSON.stringify({ type: "excalidraw", elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, link: "javascript:alert(1)", strokeColor: "red;}" }, { id: "b", type: "script" }], files: { f: { dataURL: "data:text/html;base64,PHNjcmlwdD4=" } } }))!;
    expect(evil.elements).toHaveLength(1);
    expect(evil.elements[0].link).toBeNull();
    expect(evil.elements[0].strokeColor).toBe("#1e1e1e");
    expect(evil.files).toEqual({});
    expect(parseExcalidrawFile("{\"type\":\"other\",\"elements\":[]}")).toBeNull();
    expect(parseExcalidrawFile("not json")).toBeNull();
  });

  it("reads the scene in a few words and frames a step for the camera", () => {
    const words = readScene(base);
    expect(words.some((w) => w.type === "arrow" && w.from && w.to)).toBe(true);
    expect(words.find((w) => w.id === node.id)?.text).toBeTruthy();
    const cam = cameraFor(base, { step: 1 }, { w: 1200, h: 720 })!;
    expect(cam.w / cam.h).toBeCloseTo(1200 / 720, 1);
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.x + cam.w).toBeLessThanOrEqual(1200.01);
  });
});

describe("checkScene and fixOps", () => {
  const l = lessons[0];
  const base = sceneOf(l);
  const node = base.elements.find((e) => e.customData?.wb?.role === "node")!;
  const label = base.elements.find((e) => e.containerId === node.id)!;

  it("counts text that spills out of its box and fixes it with smaller type", () => {
    const broken = { ...base, elements: base.elements.map((e) => (e.id === label.id ? { ...e, width: node.width + 40, x: node.x - 20 } : e)) };
    const ps = checkScene(broken);
    expect(ps.some((p) => p.kind === "overflow" && p.ids[0] === label.id)).toBe(true);
    const ops = fixOps(broken, ps);
    const fixed = applyEdits(broken, applyOps(broken, noEdits(), ops).edits);
    expect(checkScene(fixed).some((p) => p.kind === "overflow" && p.ids[0] === label.id)).toBe(false);
  });

  it("counts an arrow through a box and bends it round", () => {
    const a = node;
    const others = base.elements.filter((e) => e.customData?.wb?.role === "node" && e.id !== a.id);
    const target = others[0];
    // an arrow from above to below, straight through `a`
    const through: ExEl = { ...base.elements.find((e) => e.type === "arrow")!, id: "x-arrow", boundElements: null, customData: { wb: { step: 0, key: "x", role: "edge" } }, x: a.x + a.width / 2, y: a.y - 60, points: [[0, 0], [0, a.height + 120]], roundness: null, startBinding: null, endBinding: { elementId: target.id, focus: 0, gap: 4 } };
    const scene = { ...base, elements: [...base.elements, through] };
    const ps = checkScene(scene).filter((p) => p.kind === "crossing" && p.ids[0] === "x-arrow");
    expect(ps.map((p) => p.ids[1])).toContain(a.id);
    const fixed = applyEdits(scene, applyOps(scene, noEdits(), fixOps(scene, ps)).edits);
    expect(checkScene(fixed).filter((p) => p.kind === "crossing" && p.ids[0] === "x-arrow" && p.ids[1] === a.id)).toHaveLength(0);
  });

  it("counts overlaps and things off the board, and brings them back", () => {
    const off = { ...base, elements: base.elements.map((e) => (e.id === "wb-title" ? { ...e, x: -80 } : e)) };
    const ps = checkScene(off);
    expect(countProblems(ps).offscreen).toBeGreaterThan(0);
    const fixed = applyEdits(off, applyOps(off, noEdits(), fixOps(off, ps)).edits);
    expect(countProblems(checkScene(fixed)).offscreen).toBe(0);
    const twin = base.elements.find((e) => e.type === "text" && !e.containerId && e.id !== "wb-title");
    if (twin) {
      const on = { ...base, elements: [...base.elements, { ...twin, id: "twin", customData: { wb: { step: 0, key: "twin", role: "block" as const } } }] };
      expect(countProblems(checkScene(on)).overlap).toBeGreaterThan(0);
    }
  });
});
