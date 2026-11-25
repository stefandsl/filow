import { describe, expect, it } from "vitest";
import cloud from "./fixtures/cloud-r3.json";
import { applyEdits, excalidrawFile, noEdits, parseExcalidrawFile } from "./doc";
import { layoutBoard } from "./layout";
import { validateLesson } from "./lesson";
import { drawMsFor, sceneStepSchedule, stepSchedule } from "./pace";
import { boardLesson, sceneFromLayout } from "./scene";
import { readDiagram, sceneFromDiagram, workedExample } from "./templates";
import { pathPoints } from "./check";
import {
  createCueSession,
  cueAccentColor,
  cueSignalStyle,
  evaluateCues,
  extractStepCues,
  scheduleStepCues,
  staticStepCues,
  stripCueNodes,
  type Pt,
} from "./motion";

const records = cloud as Array<{ run: string; n: number; question: string; lesson: unknown }>;
const tcpRecord = records.find((r) => r.run === "r3-run1" && r.n === 3)!;
const tcpLesson = validateLesson(tcpRecord.lesson, { maxSteps: 12, sketch: true })!;
const photoRecord = records.find((r) => r.run === "r3-run1" && r.n === 1)!;
const photoLesson = validateLesson(photoRecord.lesson, { maxSteps: 12, sketch: true })!;
const pythagRecord = records.find((r) => r.run === "r3-run1" && r.n === 2)!;
const pythagLesson = validateLesson(pythagRecord.lesson, { maxSteps: 12, sketch: true })!;
const ohmRecord = records.find((r) => r.run === "r3-run1" && r.n === 9)!;
const ohmLesson = validateLesson(ohmRecord.lesson, { maxSteps: 12, sketch: true })!;

const tcpSequenceDiagram = readDiagram(
  {
    template: "sequence",
    title: "TCP three-way handshake",
    actors: ["Client", "Server"],
    messages: [
      { from: 0, text: "SYN" },
      { from: 1, text: "SYN-ACK" },
      { from: 0, text: "ACK" },
    ],
    result: "Connection established",
  },
  "TCP three-way handshake",
)!;

describe("X-10 directed edge and sequence-template metadata", () => {
  it("marks TCP handshake edges with explicit sender, receiver and reveal order", () => {
    const shown = boardLesson(tcpLesson);
    const scene = sceneFromLayout(layoutBoard(shown, shown.steps.length - 1, "wide"));

    const step0 = extractStepCues(scene, 0);
    const step1 = extractStepCues(scene, 1);
    const step2 = extractStepCues(scene, 2);
    const step3 = extractStepCues(scene, 3);

    expect(step0.map((c) => [c.fromId, c.toId, c.order])).toEqual([["n-client", "n-server", 0]]);
    expect(step1.map((c) => [c.fromId, c.toId, c.order])).toEqual([["n-server", "n-client", 0]]);
    expect(step2.map((c) => [c.fromId, c.toId, c.order])).toEqual([["n-client", "n-server", 0]]);
    // Step 3 has only notes and circle marks, no directed edge.
    expect(step3).toEqual([]);

    // Verify travel direction matches sender -> receiver geometry.
    const synStart = step0[0].points[0];
    const synEnd = step0[0].points[step0[0].points.length - 1];
    const replyStart = step1[0].points[0];
    const replyEnd = step1[0].points[step1[0].points.length - 1];
    expect(synEnd.x).toBeGreaterThan(synStart.x);
    expect(replyEnd.x).toBeLessThan(replyStart.x);
    expect(step1[0].receiver?.id).toBe("n-client");
  });

  it("marks local sequence-template messages with actor identities and reveal order", () => {
    const worked = workedExample(tcpSequenceDiagram);
    const scene = sceneFromDiagram(tcpSequenceDiagram, worked.facts, worked.facts.length - 1, worked.result);

    // Step 0 introduces actors, steps 1..3 are SYN, SYN-ACK, ACK, steps 4..5 are why/so.
    expect(extractStepCues(scene, 0)).toEqual([]);
    const syn = extractStepCues(scene, 1);
    const synAck = extractStepCues(scene, 2);
    const ack = extractStepCues(scene, 3);
    expect(extractStepCues(scene, 4)).toEqual([]);
    expect(extractStepCues(scene, 5)).toEqual([]);

    expect(syn.map((c) => [c.id, c.fromId, c.toId])).toEqual([["seq-msg0", "seq-actor0", "seq-actor1"]]);
    expect(synAck.map((c) => [c.id, c.fromId, c.toId])).toEqual([["seq-msg1", "seq-actor1", "seq-actor0"]]);
    expect(ack.map((c) => [c.id, c.fromId, c.toId])).toEqual([["seq-msg2", "seq-actor0", "seq-actor1"]]);

    // Direction reversal on the reply is geometric too: Server (right) -> Client (left).
    expect(syn[0].points[syn[0].points.length - 1].x).toBeGreaterThan(syn[0].points[0].x);
    expect(synAck[0].points[synAck[0].points.length - 1].x).toBeLessThan(synAck[0].points[0].x);
    expect(synAck[0].receiver?.id).toBe("seq-actor0");

    // Sequence-template step schedule provides a timing slot for the message key.
    const slots = sceneStepSchedule(scene, 2, drawMsFor(4500));
    expect(slots.has("msg1")).toBe(true);
  });

  it("produces zero cues for formula-only, plot-only and note-only steps", () => {
    // Pythagorean theorem step 4 is formula-only; step 5 is formula+note.
    const pythagScene = sceneFromLayout(layoutBoard(boardLesson(pythagLesson), pythagLesson.steps.length - 1, "wide"));
    expect(extractStepCues(pythagScene, 4)).toEqual([]);
    expect(extractStepCues(pythagScene, 5)).toEqual([]);

    // Ohm's law step 4 has formula + plot + note (plot axes must not animate as message edges).
    const ohmScene = sceneFromLayout(layoutBoard(boardLesson(ohmLesson), ohmLesson.steps.length - 1, "wide"));
    expect(extractStepCues(ohmScene, 4)).toEqual([]);
  });

  it("opens older boards without edge relationship metadata unchanged and plays zero cues", () => {
    const legacyFile = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [
        { id: "old-a", type: "rectangle", x: 100, y: 100, width: 140, height: 60, strokeColor: "#1971c2" },
        { id: "old-b", type: "rectangle", x: 420, y: 100, width: 140, height: 60, strokeColor: "#1971c2" },
        {
          id: "old-arrow",
          type: "arrow",
          x: 246,
          y: 130,
          width: 168,
          height: 0,
          points: [[0, 0], [168, 0]],
          endArrowhead: "arrow",
          startBinding: { elementId: "old-a", focus: 0, gap: 6 },
          endBinding: { elementId: "old-b", focus: 0, gap: 6 },
          customData: { wb: { step: 0, key: "e0", role: "edge" } },
        },
      ],
      files: {},
    });
    const parsed = parseExcalidrawFile(legacyFile);
    expect(parsed).not.toBeNull();
    expect(parsed!.elements).toHaveLength(3);
    expect(extractStepCues(parsed!, 0)).toEqual([]);
  });
});

describe("X-10 cue scheduling, replay, cancellation and reduced motion", () => {
  it("replays only the reply when returning to step 1 of TCP handshake", () => {
    const shown = boardLesson(tcpLesson);
    const layout = layoutBoard(shown, 1, "wide");
    const scene = sceneFromLayout(layout);
    const cues = extractStepCues(scene, 1);
    expect(cues).toHaveLength(1);
    expect(cues[0].fromId).toBe("n-server");
    expect(cues[0].toId).toBe("n-client");

    const stepMs = 5_000;
    const timing = stepSchedule(layout, 1, drawMsFor(stepMs));
    const scheduled = scheduleStepCues(cues, timing, stepMs);
    expect(scheduled).toHaveLength(1);
    const s = scheduled[0];
    expect(s.startMs).toBeGreaterThanOrEqual(0);
    expect(s.endMs).toBeLessThanOrEqual(drawMsFor(stepMs));

    // Start, midpoint, arrival, and settled post-cue frame.
    const startFrame = evaluateCues(scheduled, s.startMs + s.travelMs * 0.08);
    const midFrame = evaluateCues(scheduled, s.startMs + s.travelMs * 0.5);
    const arrivalFrame = evaluateCues(scheduled, s.startMs + s.travelMs + s.arrivalMs * 0.25);
    const doneFrame = evaluateCues(scheduled, s.endMs + 20);

    expect(startFrame.phase).toBe("travel");
    expect(startFrame.signals).toHaveLength(1);
    expect(startFrame.signals[0].edgeId).toBe(cues[0].id);
    expect(startFrame.signals[0].overLabel).toBe(false);

    expect(midFrame.phase).toBe("travel");
    expect(midFrame.signals[0].x).toBeLessThan(startFrame.signals[0].x);
    // Label-aware clearance keeps the midpoint signal off the bound SYN-ACK label text.
    expect(midFrame.signals[0].overLabel).toBe(false);

    expect(arrivalFrame.phase).toBe("arrival");
    expect(arrivalFrame.arrivals).toHaveLength(1);
    expect(arrivalFrame.arrivals[0].receiver.id).toBe("n-client");
    expect(arrivalFrame.arrivals[0].intensity).toBeGreaterThan(0.5);

    expect(doneFrame.active).toBe(false);
    expect(doneFrame.signals).toEqual([]);
    expect(doneFrame.arrivals).toEqual([]);
  });

  it("sequences multiple eligible edges in reveal order inside the step time slot", () => {
    const shown = boardLesson(photoLesson);
    const layout = layoutBoard(shown, 1, "wide");
    const scene = sceneFromLayout(layout);
    const cues = extractStepCues(scene, 1);
    expect(cues.length).toBe(3);
    expect(cues.map((c) => c.order)).toEqual([0, 1, 2]);

    const stepMs = 6_000;
    const timing = stepSchedule(layout, 1, drawMsFor(stepMs));
    const scheduled = scheduleStepCues(cues, timing, stepMs);
    expect(scheduled).toHaveLength(3);
    for (let i = 1; i < scheduled.length; i++) {
      expect(scheduled[i].startMs).toBeGreaterThanOrEqual(scheduled[i - 1].endMs);
    }
    expect(scheduled[scheduled.length - 1].endMs).toBeLessThanOrEqual(drawMsFor(stepMs));
  });

  it("cancels an active cue immediately on pause, step change or replay", () => {
    const shown = boardLesson(tcpLesson);
    const layout = layoutBoard(shown, 1, "wide");
    const scene = sceneFromLayout(layout);
    const cues = extractStepCues(scene, 1);
    const scheduled = scheduleStepCues(cues, stepSchedule(layout, 1, drawMsFor(5000)), 5000);

    let nowMs = 1000;
    let nextRafId = 1;
    const rafQueue = new Map<number, () => void>();
    const frames: Array<{ phase: string; signals: number; arrivals: number }> = [];

    const session = createCueSession({
      mode: "motion",
      cues,
      scheduled,
      now: () => nowMs,
      scheduleFrame: (cb) => {
        const id = nextRafId++;
        rafQueue.set(id, cb);
        return id;
      },
      cancelFrame: (id) => {
        rafQueue.delete(id);
      },
      onFrame: (f) => frames.push({ phase: f.phase, signals: f.signals.length, arrivals: f.arrivals.length }),
    });

    const stepClock = (delta: number) => {
      nowMs += delta;
      const pending = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of pending) cb();
    };

    // Advance into mid-flight travel.
    stepClock(scheduled[0].startMs + Math.round(scheduled[0].travelMs * 0.5));
    expect(frames[frames.length - 1]).toEqual({ phase: "travel", signals: 1, arrivals: 0 });
    expect(rafQueue.size).toBe(1);

    // Pause / step change / replay cancels immediately: no queued frames, settled empty frame emitted.
    session.cancel();
    expect(rafQueue.size).toBe(0);
    expect(frames[frames.length - 1]).toEqual({ phase: "idle", signals: 0, arrivals: 0 });

    // Advancing clock after cancel emits nothing more.
    const countAfterCancel = frames.length;
    stepClock(500);
    expect(frames.length).toBe(countAfterCancel);
  });

  it("keeps direction and recipient identifiable with zero motion in reduced motion and Lite", () => {
    const shown = boardLesson(tcpLesson);
    const scene = sceneFromLayout(layoutBoard(shown, 1, "wide"));
    const cues = extractStepCues(scene, 1);
    let scheduledFrames = 0;
    const seen: ReturnType<typeof staticStepCues>[] = [];

    const session = createCueSession({
      mode: "static",
      cues,
      scheduled: [],
      now: () => 0,
      scheduleFrame: () => {
        scheduledFrames++;
        return 1;
      },
      cancelFrame: () => {},
      onFrame: (f) => seen.push(f),
    });

    expect(scheduledFrames).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe("static");
    expect(seen[0].signals).toEqual([]);
    expect(seen[0].staticEmphasis).toHaveLength(1);
    expect(seen[0].staticEmphasis[0].receiver?.id).toBe("n-client");
    expect(seen[0].staticEmphasis[0].tip.x).toBeLessThan(cues[0].points[0].x);

    session.cancel();
    expect(seen[seen.length - 1].staticEmphasis).toEqual([]);
  });

  it("follows a moved endpoint and moved receiver after an edit", () => {
    const shown = boardLesson(tcpLesson);
    const base = sceneFromLayout(layoutBoard(shown, 1, "wide"));
    const baseCue = extractStepCues(base, 1)[0];
    const clientEl = base.elements.find((e) => e.id === "n-client")!;
    const replyEl = base.elements.find((e) => e.id === baseCue.id)!;

    const edited = applyEdits(base, {
      ...noEdits(),
      patch: {
        [clientEl.id]: { x: clientEl.x - 40, y: clientEl.y + 60 },
        [replyEl.id]: {
          points: replyEl.points!.map((p, i, arr) =>
            i === arr.length - 1 ? ([p[0] - 40, p[1] + 60] as [number, number]) : p,
          ),
        },
      },
    });
    const movedCue = extractStepCues(edited, 1)[0];
    expect(movedCue.receiver!.x).toBeCloseTo(baseCue.receiver!.x - 40, 1);
    expect(movedCue.receiver!.y).toBeCloseTo(baseCue.receiver!.y + 60, 1);
    expect(movedCue.tip.x).toBeCloseTo(baseCue.tip.x - 40, 1);
    expect(movedCue.tip.y).toBeCloseTo(baseCue.tip.y + 60, 1);
  });

  it("keeps transient cues out of Excalidraw exports and strips defensive cue nodes", () => {
    const shown = boardLesson(tcpLesson);
    const scene = sceneFromLayout(layoutBoard(shown, 1, "wide"));
    const exported = excalidrawFile(scene, false);
    const parsed = parseExcalidrawFile(exported)!;

    // Scene elements and exported file never include any transient signal/arrival element.
    expect(parsed.elements.some((e) => /cue|signal|arrival|pulse/i.test(e.id))).toBe(false);
    expect(parsed.elements.length).toBe(scene.elements.length - 1); // minus wb-frame

    // Theme-aware accent colors stay distinct in light and dark looks.
    expect(cueAccentColor("#495057", false)).not.toBe(cueAccentColor("#495057", true));

    // Defensive SVG cue stripping removes any [data-wb-cue] node cleanly.
    const removed: string[] = [];
    const fakeRoot = {
      querySelectorAll: (sel: string) =>
        sel === "[data-wb-cue]"
          ? [{ remove: () => removed.push("cue-1") }, { remove: () => removed.push("cue-2") }]
          : [],
    } as unknown as ParentNode;
    expect(stripCueNodes(fakeRoot)).toBe(2);
    expect(removed).toEqual(["cue-1", "cue-2"]);
  });
});

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function distPointToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, distPointToSegment(p, pts[i - 1], pts[i]));
  }
  return best;
}

type Rect = { x: number; y: number; w: number; h: number };
const rectsOverlap = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

function renderedTextRect(el: { x: number; y: number; width: number; height: number; containerId?: string | null }, byId: Map<string, ReturnType<typeof sceneFromLayout>["elements"][number]>): Rect {
  if (el.containerId) {
    const host = byId.get(el.containerId);
    if (host && host.type === "arrow") {
      // Excalidraw draws a bound arrow label centered on the arrow midpoint, ignoring stored x/y.
      const pts = pathPoints(host, 24);
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: host.x + host.width / 2, y: host.y + host.height / 2 };
      return { x: mid.x - el.width / 2, y: mid.y - el.height / 2, w: el.width, h: el.height };
    }
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

function hexLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  const rgb = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(a: string, b: string): number {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

describe("X-10 round 2 regressions: on-arrow path, label/box/outline clearance, contrast and sizing", () => {
  it("keeps the moving signal within 2 scene units of cue.points at frac 0..1 step 0.05 for TCP steps 0-2 and sequence template", () => {
    const shown = boardLesson(tcpLesson);
    for (const step of [0, 1, 2]) {
      const layout = layoutBoard(shown, step, "wide");
      const scene = sceneFromLayout(layout);
      const cues = extractStepCues(scene, step);
      expect(cues, `TCP step ${step} cues`).toHaveLength(1);
      const scheduled = scheduleStepCues(cues, stepSchedule(layout, step, drawMsFor(5000)), 5000);
      const item = scheduled[0];
      for (let i = 0; i <= 20; i++) {
        const frac = i === 20 ? 0.999 : i * 0.05;
        const frame = evaluateCues(scheduled, item.startMs + item.travelMs * frac);
        expect(frame.signals, `TCP step ${step} frac ${frac}`).toHaveLength(1);
        const sig = frame.signals[0];
        const dist = distPointToPolyline({ x: sig.x, y: sig.y }, item.cue.points);
        expect(dist, `TCP step ${step} frac ${frac} off-arrow distance`).toBeLessThanOrEqual(2);
      }
    }

    const worked = workedExample(tcpSequenceDiagram);
    const seqScene = sceneFromDiagram(tcpSequenceDiagram, worked.facts, worked.facts.length - 1, worked.result);
    for (const step of [1, 2, 3]) {
      const cues = extractStepCues(seqScene, step);
      expect(cues, `sequence step ${step} cues`).toHaveLength(1);
      const scheduled = scheduleStepCues(cues, sceneStepSchedule(seqScene, step, drawMsFor(4500)), 4500);
      const item = scheduled[0];
      for (let i = 0; i <= 20; i++) {
        const frac = i === 20 ? 0.999 : i * 0.05;
        const frame = evaluateCues(scheduled, item.startMs + item.travelMs * frac);
        expect(frame.signals, `sequence step ${step} frac ${frac}`).toHaveLength(1);
        const sig = frame.signals[0];
        const dist = distPointToPolyline({ x: sig.x, y: sig.y }, item.cue.points);
        expect(dist, `sequence step ${step} frac ${frac} off-arrow distance`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps Record 3 edge labels matching rendered geometry and clear of their own arrow stroke and all node boxes", () => {
    const shown = boardLesson(tcpLesson);
    for (const step of [0, 1, 2, 3]) {
      const scene = sceneFromLayout(layoutBoard(shown, step, "wide"));
      const byId = new Map(scene.elements.map((e) => [e.id, e]));
      const nodes = scene.elements.filter((e) => !e.isDeleted && e.customData?.wb?.role === "node" && e.type !== "text");
      const edges = scene.elements.filter((e) => !e.isDeleted && e.type === "arrow" && e.customData?.wb?.role === "edge");
      expect(edges.length).toBeGreaterThan(0);

      for (const edge of edges) {
        const label =
          scene.elements.find((x) => !x.isDeleted && x.type === "text" && x.containerId === edge.id) ??
          scene.elements.find((x) => !x.isDeleted && x.type === "text" && x.id === `${edge.id}-t`);
        expect(label, `step ${step} edge ${edge.id} label`).toBeDefined();
        const rendered = renderedTextRect(label!, byId);

        // Motion's labelBox must match the actual rendered label rect for the active step's cue.
        const stepCues = extractStepCues(scene, step).filter((c) => c.id === edge.id);
        for (const cue of stepCues) {
          expect(cue.labelBox, `step ${step} cue ${cue.id} labelBox`).not.toBeNull();
          expect(cue.labelBox!.x).toBeCloseTo(rendered.x, 1);
          expect(cue.labelBox!.y).toBeCloseTo(rendered.y, 1);
          expect(cue.labelBox!.w).toBeCloseTo(rendered.w, 1);
          expect(cue.labelBox!.h).toBeCloseTo(rendered.h, 1);
        }

        // The rendered edge label must not sit on its own arrow stroke.
        const strokePts = pathPoints(edge, 24);
        const hitsOwnStroke = strokePts.some((pt) => rectsOverlap(rendered, { x: pt.x, y: pt.y, w: 0, h: 0 }, 1));
        expect(hitsOwnStroke, `step ${step} edge ${edge.id} label "${label!.text}" intersects its own arrow stroke`).toBe(false);

        // The rendered edge label must not cross any node box border.
        for (const node of nodes) {
          const nodeRect: Rect = { x: node.x, y: node.y, w: node.width, h: node.height };
          expect(
            rectsOverlap(rendered, nodeRect, 0),
            `step ${step} edge ${edge.id} label "${label!.text}" overlaps node ${node.id}`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps arrival and reduced-motion receiver outlines clear of every visible text box", () => {
    const shown = boardLesson(tcpLesson);
    for (const step of [0, 1, 2]) {
      const scene = sceneFromLayout(layoutBoard(shown, step, "wide"));
      const byId = new Map(scene.elements.map((e) => [e.id, e]));
      const cues = extractStepCues(scene, step);
      expect(cues).toHaveLength(1);
      const cue = cues[0];
      expect(cue.receiver).not.toBeNull();
      const rec = cue.receiver!;

      // Outer extent of arrival outline (pad + half halo strokeWidth) and static outline (pad + half strokeWidth).
      const arrivalExpand = (cue.outlinePad ?? 6) + 4;
      const staticExpand = (cue.outlinePad ?? 6) + 1.5;
      const arrivalRect: Rect = {
        x: rec.x - arrivalExpand,
        y: rec.y - arrivalExpand,
        w: rec.w + arrivalExpand * 2,
        h: rec.h + arrivalExpand * 2,
      };
      const staticRect: Rect = {
        x: rec.x - staticExpand,
        y: rec.y - staticExpand,
        w: rec.w + staticExpand * 2,
        h: rec.h + staticExpand * 2,
      };

      const externalTexts = scene.elements.filter(
        (e) => !e.isDeleted && e.type === "text" && e.containerId !== rec.id,
      );
      for (const txt of externalTexts) {
        const tr = renderedTextRect(txt, byId);
        expect(
          rectsOverlap(arrivalRect, tr, 0),
          `step ${step} arrival outline on ${rec.id} intersects text ${txt.id} ("${txt.text}")`,
        ).toBe(false);
        expect(
          rectsOverlap(staticRect, tr, 0),
          `step ${step} static outline on ${rec.id} intersects text ${txt.id} ("${txt.text}")`,
        ).toBe(false);
      }
    }
  });

  it("guarantees >= 3:1 signal contrast in both looks, a light ring and >= 0.35 halo in dark look, and >= 10 px dot diameter", () => {
    const strokes = [undefined, "#495057", "#1971c2", "#e8590c", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599"];
    for (const stroke of strokes) {
      for (const dark of [false, true]) {
        const bg = dark ? "#121212" : "#ffffff";
        const style = cueSignalStyle(stroke, dark);
        expect(contrastRatio(style.fill, bg), `fill contrast for ${stroke ?? "default"} dark=${dark}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(style.chevronStroke, style.fill), `chevron contrast for ${stroke ?? "default"} dark=${dark}`).toBeGreaterThanOrEqual(3);
        expect(style.dotRadiusPx * 2, `dot diameter px dark=${dark}`).toBeGreaterThanOrEqual(10);
        if (dark) {
          expect(style.ringStroke.toLowerCase()).not.toBe("#121212");
          expect(contrastRatio(style.ringStroke, bg), `dark ring contrast`).toBeGreaterThanOrEqual(3);
          expect(style.haloOpacity, `dark halo opacity`).toBeGreaterThanOrEqual(0.35);
        }
      }
    }
  });
});
