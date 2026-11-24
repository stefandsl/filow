import { describe, expect, it } from "vitest";
import cloud from "./fixtures/cloud-r3.json";
import { applyEdits, excalidrawFile, noEdits, parseExcalidrawFile } from "./doc";
import { layoutBoard } from "./layout";
import { validateLesson } from "./lesson";
import { drawMsFor, sceneStepSchedule, stepSchedule } from "./pace";
import { boardLesson, sceneFromLayout } from "./scene";
import { readDiagram, sceneFromDiagram, workedExample } from "./templates";
import {
  createCueSession,
  cueAccentColor,
  evaluateCues,
  extractStepCues,
  scheduleStepCues,
  staticStepCues,
  stripCueNodes,
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
