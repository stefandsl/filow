import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine, missedPoints } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";
import { matcherDecide } from "./matcher";
import { pointDisplayState } from "./anchor";
import { checkClaim } from "./guard";

const SCRIPT = parseScript(`# Intro
- hello everyone
- what we build today

# Body
- the decision model
- costs

# End
- recap
`);

type Answer = Record<string, number>; // id -> confidence

function makeEngine(answers: Answer[] = [], cost: number | null = 0.001, extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
  const calls: DecideRequest[] = [];
  let i = 0;
  const decide = async (r: DecideRequest): Promise<DecideResponse> => {
    calls.push(r);
    const a = answers[Math.min(i++, answers.length - 1)] ?? {};
    return {
      decisions: r.bullets.map((b) => ({ id: b.id, confidence: a[b.id] ?? 0, started: (a[b.id] ?? 0) >= 0.7 })),
      latencyMs: 100,
      cost,
      model: "test",
    };
  };
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, ...extra });
  e.loadScript(SCRIPT);
  return { e, calls };
}

const BIG = parseScript(`# One
- p1
- p2
- p3
- p4
- p5
- p6
`);

describe("script-scoped place", () => {
  it.each(["interruption", "user"] as const)("restores the committed place only after an interruption (%s)", reason => {
    const { e } = makeEngine();
    e.start();
    e.dispatch({ type: "anchor", idx: 1 });
    e.dispatch({ type: "markStarted", id: "s1b0" });
    const before = e.committedPlace();
    e.stop(reason);
    const saved = e.committedPlace();
    expect(saved).toEqual(reason === "interruption" ? before : null);
    const fresh = makeEngine().e;
    fresh.loadScript({ script: SCRIPT, place: saved });
    expect(fresh.getState().engine.recording).toBe(false);
    expect(fresh.getState().sectionIdx).toBe(reason === "interruption" ? 1 : 0);
  });
  it("runs speech navigation only for accepted input, before deciding it in the new section", () => {
    const { e } = makeEngine();
    e.start();
    const navigate = vi.fn(() => e.dispatch({ type: "anchor", idx: 1 }));
    e.feed({ partial: "Body" });
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: "Body", partial: "" }, navigate);
    expect(navigate).not.toHaveBeenCalled();
    e.stop();
    e.feed({ committed: "Body", partial: "" }, navigate);
    expect(navigate).not.toHaveBeenCalled();
    e.start();
    e.feed({ committed: "Body. The decision model.", partial: "" }, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(e.getState().sectionIdx).toBe(1);
  });
  it("routes a phone Start and Stop through the registered microphone owner", () => {
    const { e } = makeEngine();
    const start = vi.fn();
    const stop = vi.fn();
    const off = e.onTakeControl({ start, stop });
    e.dispatch({ type: "startTake" });
    expect(start).toHaveBeenCalledOnce();
    expect(e.getState().engine.recording).toBe(false);
    e.start(); // the backend's successful opening
    e.dispatch({ type: "stopTake" });
    expect(stop).toHaveBeenCalledOnce();
    off();
    e.dispatch({ type: "stopTake" });
    expect(e.getState().engine.recording).toBe(false);
  });
  it("rejects an in-flight final at Reset and late speech at Stop while allowing a fresh take", async () => {
    const { e, calls } = makeEngine([{ s0b0: 1 }]);
    const words = "hello everyone. ";
    e.start();
    e.feed({ committed: words });
    await e.tick();
    e.feed({ partial: words });
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: words });
    await e.tick();
    expect(e.getState().points).toEqual({});
    e.feed({ partial: "hello everyone" });
    e.stop();
    e.feed({ committed: words });
    e.start();
    await e.tick();
    expect(calls).toHaveLength(1);
    expect(e.getState().points.s0b0?.active).toBeFalsy();
    e.feed({ partial: "hello" });
    e.feed({ committed: words });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });
  it("changes the controller generation on Stop, Reset and replacement, independent of speech frames", () => {
    const { e } = makeEngine();
    const generation = () => e.getState().controlEpoch;
    const first = generation();
    e.feed({ partial: "hello" });
    expect(generation()).toBe(first);
    e.stop();
    const stopped = generation();
    expect(stopped).not.toBe(first);
    e.dispatch({ type: "resetSection" });
    const reset = generation();
    expect(reset).not.toBe(stopped);
    e.loadScript(SCRIPT);
    expect(generation()).not.toBe(reset);
  });
  const text = "# One\n- Same\n- Same\n# Two\n- Finish";
  it("recovers duplicate labels by their shared point IDs on an unchanged legacy script", () => {
    const { e } = makeEngine();
    e.loadScript(parseScript(text));
    e.dispatch({ type: "markStarted", id: "s0b1" });
    e.dispatch({ type: "anchor", idx: 1, pointId: "s1b0" });
    const fresh = makeEngine().e;
    fresh.loadScript({ script: parseScript(text.replaceAll("\n", "\r\n")), place: e.committedPlace() });
    expect(fresh.getState()).toMatchObject({
      sectionIdx: 1, here: "s1b0", points: {
        s0b0: { status: "missed" }, s0b1: { status: "started", evidence: { source: "manual" } },
      },
    });
  });
  it("drops an anchor when a replacement reuses its positional ID", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "anchor", idx: 0, pointId: "s0b1" });
    e.loadScript(parseScript(text));
    expect(e.getState().here).toBeUndefined();
  });
  it("rejects a changed, reordered or ambiguously identified script", () => {
    const { e } = makeEngine();
    e.loadScript(parseScript(text));
    e.dispatch({ type: "markStarted", id: "s0b1" });
    const saved = e.committedPlace();
    const ambiguous = parseScript(text);
    ambiguous.sections[0].bullets[1].id = "s0b0";
    for (const script of [parseScript(text.replace("Same", "Edited")), parseScript("# Two\n- Finish\n# One\n- Same\n- Same"), ambiguous]) {
      e.loadScript({ script, place: saved });
      expect(e.getState().points).toEqual({});
    }
    e.dispatch({ type: "markStarted", id: "s0b0" });
    expect(e.committedPlace()).toBeNull();
  });
});

const journeys = {
  en: {
    script: "# Conference\n- Durham workshop\n- Service owner Nina\n- Launch date Friday\n# Operations\n- Weekly review\n- Backup retention policy\n- Backup restore test",
    partial: "The nightly restore test passed.",
    corrected: "The nightly backup restore test did not pass.",
    ambiguous: "Our service department will present later.",
    general: "Everyone came back from the interval.",
    clips: {
      alias: { text: "Nina manages the service group." },
      resume: { text: "Our launch date is Friday." },
      correction: { text: "Our launch date is Friday. I mean our department lunch is Friday." },
    },
  },
  it: {
    script: "# Congresso\n- Laboratorio Verona\n- Referente servizio Nina\n- Data avvio venerdì\n# Operazioni\n- Revisione settimanale\n- Politica di conservazione backup\n- Test di ripristino backup",
    partial: "Il test di ripristino notturno è riuscito.",
    corrected: "Il test di ripristino del backup notturno non è riuscito.",
    ambiguous: "Il reparto servizio parlerà più tardi.",
    general: "Siamo rientrati tutti dalla pausa.",
    clips: {
      alias: { text: "Nina dirige la squadra di servizio." },
      resume: { text: "La data di avvio è venerdì." },
      correction: { text: "La data di avvio è venerdì. Mi correggo, la cena del reparto è venerdì." },
    },
  },
};

describe.each(Object.entries(journeys))("%s committed speech boundaries", (_lang, journey) => {
  it("withholds a retention tick on the shared backup topic, then preserves genuine retention evidence", async () => {
    const [general, weekly, restore, retention, correction] = _lang === "en" ? [
      "We do backups", "We hold a weekly review", "We passed the backup restore test",
      "We keep each backup for thirty days", "I mean the backup restore test has not passed",
    ] : [
      "Facciamo dei backup", "Facciamo una revisione settimanale", "Il test di ripristino del backup è riuscito",
      "Conserviamo ogni backup per trenta giorni", "Mi correggo, il test di ripristino del backup non è riuscito",
    ];
    // The packaged matcher twice scored retention at 0.74 on general backup and review words.
    const matcher = matcherDecide(
      async texts => texts.map(() => Float32Array.of(1, 0)),
      () => ({ key: "retention", ids: ["s1b1"], vectors: [Float32Array.of(0.63, Math.sqrt(1 - 0.63 ** 2))] }),
    );
    const { e } = makeEngine([], 0, { decide: matcher });
    e.loadScript(parseScript(journey.script));
    e.feed({ committed: general + " " });
    e.feed({ committed: weekly + " " });
    e.dispatch({ type: "anchor", idx: 1, keep: "recent" });
    await e.tick();
    await e.tick();
    expect(e.getState().points.s1b0.status).toBe("started");
    expect(e.getState().points.s1b1.status).toBe("waiting");
    expect(e.getState().points.s1b2.status).toBe("waiting");
    e.feed({ committed: restore + " " });
    await e.tick();
    await e.tick();
    expect(e.getState().points.s1b2.status).toBe("started");
    expect(e.getState().points.s1b1.status).toBe("waiting");
    e.feed({ committed: retention + " " });
    await e.tick();
    await e.tick();
    const saved = e.getState().points.s1b1;
    expect(saved.status).toBe("started");
    expect(saved.evidence).toMatchObject({ source: "model", quote: expect.stringContaining(retention) });
    e.feed({ committed: correction });
    await e.tick();
    expect(e.getState().points.s1b1).toEqual(saved);
    expect(e.getState().points.s1b2.status).toBe("waiting");
  });
  it.each([true, false])("credits a fresh restore assertion after an unpunctuated denial (spoken correction: %s)", async (withCorrection) => {
    const [general, weekly, correction, fresh] = _lang === "en" ? [
      "We do backups", "We hold a weekly review",
      "The backup restore test passed.  I mean the backup restore test has not passed",
      "We passed the backup restore test",
    ] : [
      "Facciamo dei backup", "Facciamo una revisione settimanale",
      "Il test di ripristino del backup è riuscito.  Mi correggo, il test di ripristino del backup non è riuscito",
      "Il test di ripristino del backup è riuscito",
    ];
    const matcher = matcherDecide(async () => [new Float32Array(1)], () => ({ key: "lexical", ids: [], vectors: [] }));
    const requests: DecideRequest[] = [];
    let time = 1000;
    const { e } = makeEngine([], 0, { now: () => time, decide: req => {
      requests.push(req);
      return matcher(req);
    } });
    e.loadScript(parseScript(journey.script));
    e.feed({ committed: general + " ", partial: "" });
    e.feed({ committed: weekly + " ", partial: "" });
    e.dispatch({ type: "anchor", idx: 1, keep: "recent" });
    await e.tick();
    const denial = withCorrection ? correction : correction.split(_lang === "en" ? "I mean " : "Mi correggo, ")[1];
    e.feed({ committed: denial + " ", partial: "" });
    await e.tick();
    expect(pointDisplayState(e.getState().points.s1b2)).toBe("waiting");
    time += 4000;
    e.feed({ committed: fresh + " ", partial: "" });
    await e.tick();
    const window = requests.at(-1)!.transcript;
    expect(window).toContain(_lang === "en" ? "has not passed" : "non è riuscito");
    expect(window.endsWith(fresh)).toBe(true);
    expect(e.getState().points.s1b2).toMatchObject({
      status: "started", evidence: { quote: fresh, fromMs: time, toMs: time },
    });
    expect(e.getState().points.s1b1?.status).not.toBe("started");
  });
  it("withdraws the visual hint even when the model returns a weak positive score on the correction", async () => {
    const { e } = makeEngine([{ s0b2: 0.48 }]);
    e.loadScript(parseScript(journey.script));
    e.feed({ partial: journey.clips.resume.text });
    expect(pointDisplayState(e.getState().points.s0b2)).toBe("active");
    e.feed({ committed: journey.clips.correction.text, partial: "" });
    await e.tick();
    expect(pointDisplayState(e.getState().points.s0b2)).toBe("waiting");
    e.feed({ partial: journey.clips.resume.text });
    expect(pointDisplayState(e.getState().points.s0b2)).toBe("active");
  });
  it("sends the original owner label to the provider and measures evidence against the script", async () => {
    const { e, calls } = makeEngine([{ s0b1: 0.95 }]);
    const script = parseScript(journey.script);
    const label = script.sections[0].bullets[1];
    const spoken = journey.clips.alias.text;
    e.loadScript(script);
    e.feed({ committed: spoken });
    await e.tick();
    expect(calls[0].bullets.find(b => b.id === label.id)).toEqual(label);
    expect(e.getState().points[label.id].evidence).toMatchObject({ quote: spoken, lexical: checkClaim(label.text, spoken).lexical });
  });
  it("matches a named owner expressed as a verb and keeps other people and general mentions open", async () => {
    // Exercise the real matcher's lexical stage in isolation from embeddings and hardware.
    const decide = matcherDecide(async () => [new Float32Array(1)], () => ({ key: "lexical", ids: [], vectors: [] }));
    const { e } = makeEngine([], 0, { decide });
    const owner = "Nina";
    for (const [label, line, done] of [
      [owner, journey.ambiguous, false],
      [owner, journey.clips.alias.text.replace(owner, "Elena"), false],
      [owner, journey.clips.alias.text, true],
      ["Rita", journey.clips.alias.text.replace(owner, "Rita"), true],
    ] as const) {
      e.loadScript(parseScript(journey.script.replace(owner, label)));
      e.feed({ committed: line });
      await e.tick();
      expect(Object.keys(e.getState().points).filter(id => e.getState().points[id].status === "started"), line).toEqual(done ? ["s0b1"] : []);
      if (done) expect(e.getState().points.s0b1.evidence).toMatchObject({ quote: line });
    }
  });
  it("withdraws contradicted automatic evidence and preserves independent marks", async () => {
    const { e } = makeEngine([{ s1b2: 0.98 }]);
    e.loadScript(parseScript(journey.script));
    e.dispatch({ type: "anchor", idx: 1 });
    e.dispatch({ type: "markStarted", id: "s1b0" });
    e.feed({ committed: journey.partial + " " });
    await e.tick();
    expect(e.getState().points.s1b2.evidence?.source).toBe("model");
    for (let i = 0; i < 2; i++) {
      e.feed({ committed: journey.corrected + " ", partial: "" });
      await e.tick();
      expect(e.getState().points.s1b2).toEqual({ status: "waiting", confidence: 0 });
      expect(e.getState().points.s1b0.evidence?.source).toBe("manual");
    }
  });
  it("drops a late vote made before the speaker explicitly corrected the date", async () => {
    let reply!: (value: DecideResponse) => void;
    const { e } = makeEngine([], 0, { decide: () => new Promise(resolve => { reply = resolve; }) });
    e.loadScript(parseScript(journey.script));
    e.feed({ committed: journey.clips.resume.text.replace(/[.]$/, " ") });
    const pending = e.tick();
    e.feed({ committed: journey.clips.correction.text.split(". ")[1] });
    const vote = { decisions: [{ id: "s0b2", started: true, confidence: 1 }], model: "test", cost: 0, latencyMs: 1 };
    reply(vote);
    await pending;
    expect(e.getState().points.s0b2?.status ?? "waiting").toBe("waiting");
    const fresh = e.tick();
    reply(vote);
    await fresh;
    expect(e.getState().points.s0b2).toEqual({ status: "waiting", confidence: 0 });
  });
  it("keeps the presenter's reopen through old words, navigation and recovery", async () => {
    const { e } = makeEngine([{ s0b1: 0.96 }]);
    const script = parseScript(journey.script);
    e.loadScript(script);
    e.feed({ committed: journey.clips.alias.text + " " });
    await e.tick();
    expect(e.getState().points.s0b1.evidence).toMatchObject({ source: "model", quote: journey.clips.alias.text });
    e.dispatch({ type: "reopen", id: "s0b1" });
    e.feed({ committed: journey.general });
    await e.tick();
    e.dispatch({ type: "anchor", idx: 1 });
    expect(e.getState().points.s0b1).toMatchObject({ status: "waiting", reopened: true });
    const saved = e.committedPlace();
    e.loadScript({ script, place: saved });
    expect(e.getState().points.s0b1).toMatchObject({ status: "waiting", reopened: true });
    e.dispatch({ type: "anchor", idx: 0 });
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: journey.clips.alias.text });
    await e.tick();
    expect(e.getState().points.s0b1.status).toBe("started");
  });
  it("clears a tentative restore hint as soon as the corrected final arrives", () => {
    const { e } = makeEngine();
    e.loadScript(parseScript(journey.script));
    e.dispatch({ type: "anchor", idx: 1 });
    e.dispatch({ type: "markStarted", id: "s1b1" });
    e.feed({ partial: journey.partial });
    expect(e.getState().points.s1b2.active).toBe(true);
    e.feed({ committed: journey.corrected });
    expect(e.getState().points.s1b2.active).toBeUndefined();
    expect(e.transcript.trim()).toBe(journey.corrected);
    expect(e.getState().points.s1b1.evidence?.source).toBe("manual");
  });
});

describe("Engine regression audit (Step 2)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  // Drain decide -> withTimeout -> tick continuations without advancing wall time.
  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function harness(extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
    let time = 1000;
    let interval: { fn: () => void; ms: number } | undefined;
    const calls: Array<{
      request: DecideRequest;
      signal?: AbortSignal;
      resolve: (response: DecideResponse) => void;
    }> = [];
    const clearInterval = vi.fn(() => { interval = undefined; });
    const e = new Engine({
      ...extra,
      now: () => time,
      setInterval: (fn, ms) => (interval = { fn, ms }),
      clearInterval,
      // Deliberately ignore abort: the provider can still deliver a late reply.
      decide: (request, signal) => new Promise<DecideResponse>((resolve) => {
        calls.push({ request, signal, resolve });
      }),
    });
    function resolve(index: number, confidence = 0) {
      const call = calls[index];
      call.resolve({
        decisions: call.request.bullets.map((b) => ({ id: b.id, confidence, started: confidence >= 0.7 })),
        latencyMs: 50,
        cost: 0.001,
        model: "regression",
      });
    }
    cleanups.push(async () => {
      e.stop();
      calls.forEach((_, index) => resolve(index));
      await settle();
    });
    e.loadScript(SCRIPT);
    e.start();
    return {
      e, calls, clearInterval,
      now: () => time,
      advance: (ms: number) => { time += ms; },
      pulse: async () => {
        if (!interval) throw new Error("engine interval is not running");
        time += interval.ms;
        interval.fn();
        await settle();
      },
      reply: async (index: number, confidence = 0) => {
        resolve(index, confidence);
        await settle();
      },
    };
  }

  it("engine regression 1: stop during decide drops a late reply without changing points", async () => {
    const h = harness();
    h.e.feed({ committed: "hello everyone" });
    await h.pulse();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].signal?.aborted).toBe(false);
    h.e.stop();
    const stopped = structuredClone(h.e.getState());
    expect(stopped.engine.recording).toBe(false);
    expect(h.clearInterval).toHaveBeenCalledOnce();
    expect(h.calls[0].signal?.aborted).toBe(true);
    await h.reply(0, 0.95);
    expect(h.e.getState().points).toEqual({});
    expect(h.e.getState()).toEqual(stopped);
  });

  it.each(["reopen", "markMissed"] as const)(
    "engine regression 2: manual %s wins over an in-flight reply",
    async (type) => {
      const h = harness();
      h.e.feed({ committed: "hello everyone" });
      await h.pulse();
      await h.reply(0, 0.75); // One confirmation is pending; the point is still open.
      await h.pulse();
      expect(h.calls).toHaveLength(2);
      expect(h.e.dispatch({ type, id: "s0b0" })).toEqual({ ok: true });
      const corrected = structuredClone(h.e.getState());
      await h.reply(1, 0.95);
      expect(h.e.getState().points.s0b0.status).toBe(type === "reopen" ? "waiting" : "missed");
      // Also reject changes to other points and stats from that stale reply.
      expect(h.e.getState()).toEqual(corrected);
    },
  );

  it("engine regression 3: loadScript drops an in-flight reply even when point ids are reused", async () => {
    const h = harness();
    h.e.feed({ committed: "hello everyone" });
    await h.pulse();
    const replacement = parseScript("# Replacement\n- unrelated point\n- another new point");
    expect(replacement.sections[0].bullets[0].id).toBe(h.calls[0].request.bullets[0].id);
    h.e.loadScript(replacement);
    const loaded = structuredClone(h.e.getState());
    await h.reply(0, 0.95);
    expect(h.e.getState().points).toEqual({});
    expect(h.e.getState()).toEqual(loaded);
  });

  it("engine regression 4: revised partials are replaced by committed text without duplication, and never sent", async () => {
    const h = harness();
    h.e.feed({ committed: "Welcome. ", partial: "hello every" });
    expect(h.e.getState().transcriptTail).toBe("Welcome.  hello every"); // the prompter shows the partial
    await h.pulse();
    await h.reply(0);
    h.e.feed({ partial: "hello everyone" });
    await h.pulse();
    expect(h.calls).toHaveLength(1); // a revised partial is not a reason to ask (P1 step 4)
    // ARCHITECTURE.md:195 delegates to the STT event shape. Backends clear partial
    // explicitly on commit (e.g. packages/stt/src/sherpa.ts and elevenlabs.ts).
    h.e.feed({ committed: "hello everyone ", partial: "" });
    expect(h.e.transcript).toBe("Welcome. hello everyone");
    expect(h.e.getState().transcriptTail).toBe("Welcome. hello everyone");
    await h.pulse();
    await h.reply(1);
    h.e.feed({ partial: "what we build today" });
    await h.pulse();
    expect(h.calls.map((c) => c.request.transcript)).toEqual(["Welcome.", "Welcome. hello everyone"]);
  });

  it("engine regression 5: timeout reports slow without an error and retries with fresher text", async () => {
    // EngineOptions injects interval/now but has no timeout scheduler. Capture only
    // the private timeout callback; no real wait and no vi.useFakeTimers.
    let expire: (() => void) | undefined;
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => {
      expire = () => fn();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeout = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    try {
      const h = harness({ timeoutMs: 2500 });
      h.e.feed({ committed: "hello " });
      await h.pulse();
      expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2500);
      h.e.feed({ committed: "everyone, what we build today " });
      h.advance(2500);
      expire!();
      await settle();
      expect(h.calls[0].signal?.aborted).toBe(true);
      expect(h.e.getState().engine.slowMs).toBe(2500);
      expect(h.e.getState().engine.error).toBeUndefined();
      expect(h.e.getState().stats.calls).toBe(0);
      await h.pulse();
      expect(h.calls.map((c) => c.request.transcript)).toEqual([
        "hello", "hello everyone, what we build today",
      ]);
      await h.reply(0, 0.95); // Even an abort-ignoring provider cannot apply after timeout.
      expect(h.e.getState().points).toEqual({});
      await h.reply(1, 0.95);
      expect(h.e.getState().points.s0b0).toMatchObject({ status: "started", confidence: 0.95, startedAt: h.now() });
      expect(h.e.getState().points.s0b0.evidence).toMatchObject({ source: "model", quote: "hello everyone, what we build today", decision: 0.95 });
      expect(h.e.getState().stats.calls).toBe(1);
      expect(h.e.getState().engine.slowMs).toBeUndefined();
      expect(h.e.getState().engine.error).toBeUndefined();
    } finally {
      timeout.mockRestore();
      clearTimeout.mockRestore();
    }
  });

  it("engine regression 6: the default four-question cap eventually asks every open point", async () => {
    const h = harness();
    h.e.loadScript(BIG);
    const asked = new Set<string>();
    // Fresh text is required: rotation alone must not bypass the transcript gate.
    for (let i = 0; i < Math.ceil(BIG.sections[0].bullets.length / 4); i++) {
      h.e.feed({ committed: `segment ${i} ` });
      await h.pulse();
      expect(h.calls).toHaveLength(i + 1);
      expect(h.calls[i].request.bullets).toHaveLength(4);
      h.calls[i].request.bullets.forEach((b) => asked.add(b.id));
      await h.reply(i); // No point closes, so later points cannot advance by removal.
    }
    expect([...asked].sort()).toEqual(BIG.sections[0].bullets.map((b) => b.id).sort());
  });

  it.each([2, 3])("engine regression 7: an identical window gets only one re-ask (confirmCalls=%i)", async (confirmCalls) => {
    const h = harness({ confirmCalls });
    h.e.feed({ committed: "hello everyone" });
    await h.pulse();
    await h.reply(0, 0.75);
    expect(h.e.getState().points.s0b0.status).toBe("waiting");
    await h.pulse();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].request.transcript).toBe(h.calls[0].request.transcript);
    await h.reply(1, 0.75);
    expect(h.e.getState().points.s0b0.status).toBe(confirmCalls === 2 ? "started" : "waiting");
    // With three confirmations required, pending remains true: this tests the
    // one-re-ask limit itself, rather than merely running out of open points.
    for (let i = 0; i < 4; i++) await h.pulse();
    expect(h.calls).toHaveLength(2);
    if (confirmCalls === 3) {
      h.e.feed({ committed: " and welcome" });
      await h.pulse();
      expect(h.calls).toHaveLength(3);
      await h.reply(2, 0.75);
      expect(h.e.getState().points.s0b0.status).toBe("started");
    }
  });
});

describe("Engine pacing (Step 1 hygiene)", () => {
  it("caps the questions per call and rotates through the open points", async () => {
    const { e, calls } = makeEngine([], 0, { maxQuestions: 4 });
    e.loadScript(BIG);
    e.feed({ committed: "a " });
    await e.tick();
    e.feed({ committed: "b " });
    await e.tick();
    e.feed({ committed: "c " });
    await e.tick();
    expect(calls[0].bullets.map((b) => b.text)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(calls[1].bullets.map((b) => b.text)).toEqual(["p5", "p6", "p1", "p2"]);
    expect(calls[2].bullets.map((b) => b.text)).toEqual(["p3", "p4", "p5", "p6"]);
  });

  it("aborts a slow call, reports slow instead of an error, and asks again next tick", async () => {
    let aborted = false;
    const decide = (_r: DecideRequest, signal?: AbortSignal) =>
      new Promise<DecideResponse>((_res, rej) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new Error("aborted"));
        });
      });
    const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, timeoutMs: 20 });
    e.loadScript(SCRIPT);
    e.feed({ committed: "hello" });
    await e.tick();
    expect(aborted).toBe(true);
    expect(e.getState().engine.slowMs).toBe(20);
    expect(e.getState().engine.error).toBeUndefined();
    // the same transcript is sent again: lastSent was cleared by the timeout
    let calls = 0;
    const e2 = new Engine({
      decide: async (r) => {
        calls++;
        return { decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0, started: false })), latencyMs: 1, cost: 0, model: "t" };
      },
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e2.loadScript(SCRIPT);
    e2.feed({ committed: "x" });
    await e2.tick();
    await e2.tick();
    expect(calls).toBe(1);
  });

  it("paces calls to the model's own speed when it is slower than the tick", async () => {
    let t = 1000;
    const calls: number[] = [];
    const e = new Engine({
      decide: async (r) => {
        calls.push(t);
        return { decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0, started: false })), latencyMs: 2000, cost: 0, model: "t" };
      },
      now: () => t,
      setInterval: () => 0,
      clearInterval: () => {},
      tickMs: 500,
    });
    e.loadScript(SCRIPT);
    e.feed({ committed: "a" });
    await e.tick(); // first call: avg becomes 2000 ms
    t += 500;
    e.feed({ committed: "b" });
    await e.tick(); // too soon: 500 < 2400
    t += 2000;
    e.feed({ committed: "c" });
    await e.tick(); // 2500 >= 2400: allowed
    expect(calls).toEqual([1000, 3500]);
    expect(e.getState().engine.slowMs).toBe(2000);
  });

  it("a local model at its normal pace (about 1.1 s a call) is not reported slow; one near the timeout is", async () => {
    // T1 review finding 6: the packaged local take showed "slow model ~1100 ms" in red on every call.
    let latencyMs = 1100;
    const e = new Engine({
      decide: async (r) => ({ decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0, started: false })), latencyMs, cost: 0, model: "clef-flash (local)" }),
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e.loadScript(SCRIPT);
    e.feed({ committed: "a " });
    await e.tick(true);
    expect(e.getState().engine.slowMs).toBeUndefined();
    latencyMs = 1600; // over 60% of the 2500 ms timeout: decisions are close to being dropped
    e.feed({ committed: "b " });
    await e.tick(true);
    expect(e.getState().engine.slowMs).toBe(1600);
  });
});

describe("Engine stale replies (plan step 3: state validity)", () => {
  /** A decide whose reply is released by the test, so a command can land while the call is in flight. */
  function slowEngine(conf = 0.95) {
    let release: (() => void) | null = null;
    let aborted = 0;
    let started = 0;
    const decide = (r: DecideRequest, signal?: AbortSignal) =>
      new Promise<DecideResponse>((res) => {
        started++;
        signal?.addEventListener("abort", () => aborted++);
        release = () => res({ decisions: r.bullets.map((b) => ({ id: b.id, confidence: conf, started: true })), latencyMs: 50, cost: 0.01, model: "t" });
      });
    const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {} });
    e.loadScript(SCRIPT);
    e.feed({ committed: "hello everyone, what we build today" });
    const pending = e.tick();
    return { e, pending, release: () => release!(), aborted: () => aborted, started: () => started };
  }

  it("a reply that lands after the script was reloaded does not mark points of the new script", async () => {
    const { e, pending, release, aborted } = slowEngine();
    e.loadScript(parseScript(["# Other", "- a different point", "- and another"].join("\n")));
    expect(aborted()).toBe(1);
    release();
    await pending;
    expect(e.getState().points).toEqual({});
    expect(e.getState().stats.calls).toBe(0);
    expect(e.getState().engine.error).toBeUndefined();
  });

  it("a reply that lands after stopTake changes nothing", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "startTake" });
    e.dispatch({ type: "stopTake" });
    release();
    await pending;
    expect(e.getState().points).toEqual({});
    expect(e.getState().stats.costUsd).toBe(0);
  });

  it("a reply that lands after a section change or a reset does not resurrect the old section", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "nextSection" });
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("missed");
    expect(e.getState().points["s0b1"]?.status).toBe("missed");

    const r = slowEngine();
    r.e.dispatch({ type: "resetSection" });
    r.release();
    await r.pending;
    expect(r.e.getState().points).toEqual({});
  });

  it("a reply that lands after a manual mark does not override it", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "markMissed", id: "s0b0" });
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("missed");
    expect(e.getState().points["s0b1"]).toBeUndefined();
  });

  it("the engine is free to ask again right after an invalidated call", async () => {
    const { e, pending, release, started } = slowEngine();
    e.dispatch({ type: "nextSection" });
    release();
    await pending;
    e.feed({ committed: " and now the decision model" });
    void e.tick();
    expect(started()).toBe(2);
    release();
  });

  it("a reply from the same epoch still applies", async () => {
    const { e, pending, release } = slowEngine();
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("started");
  });
});

describe("Engine flip rule", () => {
  it("flips at >= 0.70 only after two confirming calls", async () => {
    const { e } = makeEngine([{ s0b0: 0.75 }, { s0b0: 0.8 }]);
    e.feed({ committed: "hello folks " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
    e.feed({ committed: "welcome " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("flips at >= 0.90 on a single call", async () => {
    const { e } = makeEngine([{ s0b0: 0.95 }]);
    e.feed({ committed: "hello everyone" });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("a non-confirming call resets the streak", async () => {
    const { e } = makeEngine([{ s0b0: 0.75 }, { s0b0: 0.2 }, { s0b0: 0.75 }]);
    e.feed({ committed: "a" });
    await e.tick();
    e.feed({ committed: "b" });
    await e.tick();
    e.feed({ committed: "c" });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
  });

  it("does not call the model when the transcript is unchanged", async () => {
    const { e, calls } = makeEngine([{}]);
    e.feed({ committed: "same" });
    await e.tick();
    await e.tick();
    expect(calls).toHaveLength(1);
  });

  it("sends covered and upcoming context", async () => {
    const { e, calls } = makeEngine([{ s0b0: 0.95 }, {}]);
    e.feed({ committed: "hello everyone" });
    await e.tick();
    e.feed({ committed: " more" });
    await e.tick();
    expect(calls[1].covered).toEqual(["hello everyone"]);
    expect(calls[1].upcoming).toEqual(["the decision model", "costs"]);
    expect(calls[1].bullets.map((b) => b.id)).toEqual(["s0b1"]);
  });
});

describe("Engine navigation", () => {
  it("nextSection marks waiting points missed, backwards marks nothing", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "markStarted", id: "s0b0" });
    e.dispatch({ type: "nextSection" });
    expect(e.getState().sectionIdx).toBe(1);
    expect(missedPoints(e.getState()).map((b) => b.id)).toEqual(["s0b1"]);
    e.dispatch({ type: "prevSection" });
    expect(missedPoints(e.getState()).map((b) => b.id)).toEqual(["s0b1"]);
  });

  it("goToSection far forward marks every passed section", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "goToSection", idx: 2 });
    expect(missedPoints(e.getState())).toHaveLength(4);
    expect(e.getState().sectionIdx).toBe(2);
  });

  it("reopen returns a missed point to waiting", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "nextSection" });
    e.dispatch({ type: "reopen", id: "s0b0" });
    expect(e.getState().points.s0b0.status).toBe("waiting");
  });

  it("resetSection clears only the current section", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "markStarted", id: "s0b0" });
    e.dispatch({ type: "nextSection" });
    e.dispatch({ type: "markStarted", id: "s1b0" });
    e.dispatch({ type: "resetSection" });
    expect(e.getState().points.s1b0).toBeUndefined();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("slideChanged only navigates for slide-sourced scripts", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "slideChanged", index: 2, total: 3 });
    expect(e.getState().sectionIdx).toBe(0);
    expect(e.getState().slide).toEqual({ index: 2, total: 3, title: undefined });
    e.loadScript({ ...SCRIPT, source: "slides" });
    e.dispatch({ type: "slideChanged", index: 2, total: 3 });
    expect(e.getState().sectionIdx).toBe(2);
  });

  it("rejects unknown point ids", () => {
    const { e } = makeEngine();
    expect(e.dispatch({ type: "markStarted", id: "nope" })).toEqual({ ok: false, error: "unknown point nope" });
  });
});

describe("Engine stats and cost cap", () => {
  it("accumulates stats and stops at the cap", async () => {
    const { e } = makeEngine([{}], 0.6);
    e.start();
    e.feed({ committed: "one" });
    await e.tick();
    expect(e.getState().stats).toMatchObject({ calls: 1, avgMs: 100, costUsd: 0.6 });
    expect(e.getState().engine.recording).toBe(true);
    e.feed({ committed: " two" });
    await e.tick();
    expect(e.getState().engine.recording).toBe(false);
    expect(e.getState().engine.error).toMatch(/cost cap/);
  });

  it("reports null cost when the provider does not", async () => {
    const { e } = makeEngine([{}], null);
    e.feed({ committed: "x" });
    await e.tick();
    expect(e.getState().stats.costUsd).toBeNull();
  });

  it("emits one patch per change with increasing versions", () => {
    const { e } = makeEngine();
    const versions: number[] = [];
    e.subscribe((s, ops) => {
      versions.push(s.version);
      expect(ops.length).toBeGreaterThan(0);
    });
    e.dispatch({ type: "nextSection" });
    e.feed({ committed: "hi" });
    expect(versions).toEqual([versions[0], versions[0] + 1]);
  });
});

describe("Engine claim guard (P1 step 2)", () => {
  const COSTS = parseScript(`# Results
- Support costs fell 30% this quarter
- We cut the onboarding time
`);
  // A model that is sure about everything it is asked: only the guard stands between it and a flip.
  function gullible(extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
    const guarded: Array<{ id: string; kind?: string }> = [];
    const e = new Engine({
      decide: async (r) => ({ decisions: r.bullets.map((b) => ({ id: b.id, started: true, confidence: 0.95 })), latencyMs: 1, cost: 0, model: "gullible" }),
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
      onGuard: (id, check) => guarded.push({ id, kind: check.conflict?.kind }),
      ...extra,
    });
    e.loadScript(COSTS);
    return { e, guarded };
  }

  it("a sure answer on a contradicted point never flips it", async () => {
    const { e, guarded } = gullible();
    e.feed({ committed: "Support costs rose thirty percent this quarter. We did not cut the onboarding time. " });
    for (let i = 0; i < 3; i++) {
      await e.tick();
      e.feed({ committed: "Let me think. " });
    }
    expect(e.getState().points.s0b0.status).toBe("waiting");
    expect(e.getState().points.s0b1.status).toBe("waiting");
    expect(guarded).toContainEqual({ id: "s0b0", kind: "direction" });
    expect(guarded).toContainEqual({ id: "s0b1", kind: "negation" });
  });

  it("a guarded answer does not count as a confirmation either", async () => {
    let n = 0;
    const answers = [0.75, 0.75];
    const e = new Engine({
      decide: async (r) => ({ decisions: r.bullets.map((b) => ({ id: b.id, started: true, confidence: answers[Math.min(n, 1)] })), latencyMs: 1, cost: 0, model: "m" }),
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e.loadScript(COSTS);
    e.feed({ committed: "Support costs rose thirty percent this quarter. " });
    await e.tick();
    n++;
    e.feed({ committed: "Sorry: support costs fell thirty percent this quarter. " });
    await e.tick();
    // first answer was guarded (streak 0), second is the first real confirmation: still waiting
    expect(e.getState().points.s0b0.status).toBe("waiting");
    e.feed({ committed: "That is a big change. " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("the correction flips the point", async () => {
    const { e } = gullible();
    e.feed({ committed: "Support costs rose thirty percent this quarter. " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
    e.feed({ committed: "Sorry, I misread: support costs fell thirty percent this quarter. " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("can be turned off for measurements", async () => {
    const { e, guarded } = gullible({ guard: false });
    e.feed({ committed: "Support costs rose thirty percent this quarter. " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
    expect(guarded).toEqual([]);
  });
});

describe("Engine: flips only from committed text (P1 step 4)", () => {
  const PRICES = parseScript(`# Next steps
- We will raise prices in January
- Ship the mobile app to 50 pilot customers
`);
  function sure() {
    const calls: DecideRequest[] = [];
    const e = new Engine({
      decide: async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: true, confidence: 0.95 })), latencyMs: 1, cost: 0, model: "sure" };
      },
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e.loadScript(PRICES);
    return { e, calls };
  }

  it("the model is never asked about partial text", async () => {
    const { e, calls } = sure();
    e.feed({ partial: "We ship the mobile app to fifty pilot customers" });
    await e.tick();
    expect(calls).toEqual([]);
    e.feed({ committed: "Next steps. ", partial: "We ship the mobile app to fifty pilot customers" });
    await e.tick();
    expect(calls.map((c) => c.transcript)).toEqual(["Next steps."]);
    expect(e.getState().transcriptTail).toContain("fifty pilot customers"); // the prompter still shows it
  });

  it("a partial hypothesis can only make a point active; the committed revision decides", async () => {
    const { e } = sure();
    e.feed({ partial: "We ship the mobile app to fifty pilot customers" });
    await e.tick();
    expect(e.getState().points.s0b1).toMatchObject({ status: "waiting", active: true });
    e.feed({ committed: "We ship the mobile app to fifteen pilot customers first. ", partial: "" });
    await e.tick();
    expect(e.getState().points.s0b1.status).toBe("waiting"); // guarded: fifteen is not 50
  });

  it("a partial that drops a negation does not flip; the model's answer clears the active hint", async () => {
    const { e } = sure();
    e.feed({ partial: "We will raise prices in January" });
    await e.tick();
    expect(e.getState().points.s0b0.active).toBe(true);
    e.feed({ committed: "We will not raise prices in January, we hold them. ", partial: "" });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
    expect(e.getState().points.s0b0.active).toBeUndefined();
  });

  it("partial text that matches nothing marks nothing", async () => {
    const { e } = sure();
    e.feed({ partial: "good afternoon everyone" });
    expect(e.getState().points).toEqual({});
  });
});

describe("Engine: Reset section starts the section over (T1 review, finding 1)", () => {
  const PRICES = parseScript(`# Next steps
- We will raise prices in January
- Ship the mobile app to 50 pilot customers
`);
  // A model that answers "yes" only when the transcript really says the point, like clef-flash does.
  function listening() {
    const calls: DecideRequest[] = [];
    const says: Record<string, RegExp> = { s0b0: /raise prices in january/i, s0b1: /mobile app to 50 pilot/i, s1b0: /raise prices in january/i };
    const e = new Engine({
      decide: async (r) => {
        calls.push(r);
        return {
          decisions: r.bullets.map((b) => {
            const yes = says[b.id].test(r.transcript);
            return { id: b.id, started: yes, confidence: yes ? 0.95 : 0.05, ...(r.verify?.includes(b.id) ? { verification: { real: yes ? 0.9 : 0.1, sameParty: yes ? 0.9 : 0.1 } } : {}) };
          }),
          latencyMs: 1,
          cost: 0,
          model: "listening",
        };
      },
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e.loadScript(PRICES);
    return { e, calls };
  }
  async function ticks(e: Engine, n: number) {
    for (let i = 0; i < n; i++) await e.tick();
  }

  it("words said before the reset tick nothing again; an off-topic sentence after it ticks nothing", async () => {
    const { e, calls } = listening();
    e.feed({ committed: "We will raise prices in January. We ship the mobile app to 50 pilot customers. " });
    await ticks(e, 4);
    expect(e.getState().points.s0b0?.status).toBe("started");
    expect(e.getState().points.s0b1?.status).toBe("started");

    e.dispatch({ type: "resetSection" });
    expect(e.getState().points).toEqual({});
    const before = calls.length;
    await ticks(e, 4);
    expect(calls.length).toBe(before); // nothing new was said: nothing to ask

    e.feed({ committed: "By the way, it is raining outside today. " });
    await ticks(e, 4);
    expect(calls.slice(before).map((c) => c.transcript)).toEqual(["By the way, it is raining outside today."]);
    expect(e.getState().points.s0b0?.status ?? "waiting").toBe("waiting");
    expect(e.getState().points.s0b1?.status ?? "waiting").toBe("waiting");
  });

  it("each point ticks again once it is said again after the reset", async () => {
    const { e } = listening();
    e.feed({ committed: "We will raise prices in January. We ship the mobile app to 50 pilot customers. " });
    await ticks(e, 4);
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: "So, once more: we will raise prices in January. " });
    await ticks(e, 4);
    expect(e.getState().points.s0b0?.status).toBe("started");
    expect(e.getState().points.s0b1?.status ?? "waiting").toBe("waiting");
    e.feed({ committed: "And the mobile app to 50 pilot customers ships next. " });
    await ticks(e, 4);
    expect(e.getState().points.s0b1?.status).toBe("started");
  });

  it("words still being transcribed at the Reset were said before it: they tick nothing when they commit", async () => {
    const { e, calls } = listening();
    e.feed({ partial: "we will raise prices in January" });
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: "We will raise prices in January. ", partial: "" });
    await ticks(e, 4);
    expect(calls).toEqual([]);
    expect(e.getState().points.s0b0?.status ?? "waiting").toBe("waiting");
    e.feed({ committed: "Again: we will raise prices in January. " });
    await ticks(e, 4);
    expect(e.getState().points.s0b0?.status).toBe("started");
  });

  it("a partial dropped without a commit does not swallow the next sentence", async () => {
    const { e } = listening();
    e.feed({ partial: "um" });
    e.dispatch({ type: "resetSection" });
    e.feed({ partial: "" });
    e.feed({ committed: "We will raise prices in January. " });
    await ticks(e, 4);
    expect(e.getState().points.s0b0?.status).toBe("started");
  });

  it("a Reset starts over only its own section", async () => {
    const TWO = parseScript(`# Intro
- hello everyone

# Next steps
- We will raise prices in January
`);
    const { e } = listening();
    e.loadScript(TWO);
    e.feed({ committed: "Hello everyone. We will raise prices in January. " });
    e.dispatch({ type: "resetSection" }); // Intro
    e.dispatch({ type: "nextSection" });
    await ticks(e, 4);
    expect(e.getState().points.s1b0?.status).toBe("started"); // said before Intro's Reset, still counts for Next steps
  });
});

describe("Engine evidence per flip (P1 step 5)", () => {
  const TEAM = parseScript(`# Team
- We hired 3 engineers
- The London office opens in May
`);
  function clocked(answer: (r: DecideRequest) => DecideResponse["decisions"]) {
    let t = 0;
    const e = new Engine({
      decide: async (r) => ({ decisions: answer(r), latencyMs: 1, cost: 0, model: "clef-flash (local)" }),
      now: () => t,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e.loadScript(TEAM);
    return { e, at: (ms: number) => (t = ms) };
  }

  it("a flip keeps the quote it rests on, when it was said, the scores and the model", async () => {
    const { e, at } = clocked((r) => r.bullets.map((b) => ({ id: b.id, started: b.id === "s0b0", confidence: b.id === "s0b0" ? 0.91 : 0.1, gate: 0.62, lexical: 0.8 })));
    at(10_000);
    e.feed({ committed: "Good morning. " });
    at(14_000);
    e.feed({ committed: "We hired three engineers in July, all in support. " });
    await e.tick();
    const p = e.getState().points.s0b0;
    expect(p.status).toBe("started");
    expect(p.evidence).toEqual({
      source: "model",
      quote: "We hired three engineers in July, all in support.",
      fromMs: 14_000,
      toMs: 14_000,
      decision: 0.91,
      gate: 0.62,
      lexical: 1,
      model: "clef-flash (local)",
    });
  });

  it("a quote that spans two committed segments has a time range", async () => {
    const { e, at } = clocked((r) => r.bullets.map((b) => ({ id: b.id, started: b.id === "s0b1", confidence: b.id === "s0b1" ? 0.95 : 0 })));
    at(20_000);
    e.feed({ committed: "The London office " });
    at(23_500);
    e.feed({ committed: "opens in May. " });
    await e.tick();
    const ev = e.getState().points.s0b1.evidence;
    expect(ev).toMatchObject({ source: "model", quote: "The London office opens in May.", fromMs: 20_000, toMs: 23_500 });
    expect(ev && "gate" in ev).toBe(false); // no pre-filter ran
  });

  it("a flip with no sentence sharing the point's words quotes the latest segment", async () => {
    const { e, at } = clocked((r) => r.bullets.map((b) => ({ id: b.id, started: b.id === "s0b0", confidence: b.id === "s0b0" ? 0.9 : 0 })));
    at(5_000);
    e.feed({ committed: "Three new people joined the support crew. " });
    await e.tick();
    expect(e.getState().points.s0b0.evidence).toMatchObject({ quote: "Three new people joined the support crew.", fromMs: 5_000, toMs: 5_000, lexical: 0 });
  });

  it("a manual mark says so, and reopening drops the evidence", () => {
    const { e, at } = clocked(() => []);
    at(42_000);
    e.dispatch({ type: "markStarted", id: "s0b1" });
    expect(e.getState().points.s0b1.evidence).toEqual({ source: "manual", fromMs: 42_000, toMs: 42_000 });
    e.dispatch({ type: "reopen", id: "s0b1" });
    expect(e.getState().points.s0b1.evidence).toBeUndefined();
  });
});

describe("Engine: active hint and window edges (P1 review)", () => {
  const PRICES = parseScript(`# Next steps
- We will raise prices in January
- Ship the mobile app to 50 pilot customers

# Later
- Hire two engineers
`);
  function unsure() {
    const calls: DecideRequest[] = [];
    const e = new Engine({
      decide: async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: false, confidence: 0.2 })), latencyMs: 1, cost: 0, model: "unsure" };
      },
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
      window: 40,
    });
    e.loadScript(PRICES);
    return { e, calls };
  }

  it("a non-confirming answer keeps the hint while the partial still matches (no flicker)", async () => {
    const { e } = unsure();
    e.feed({ committed: "Next steps. ", partial: "we will raise prices in" });
    expect(e.getState().points.s0b0.active).toBe(true);
    await e.tick();
    expect(e.getState().points.s0b0.active).toBe(true);
  });

  it("the hint goes when the partial is revised away from the point", () => {
    const { e } = unsure();
    e.feed({ partial: "we will raise prices in" });
    expect(e.getState().points.s0b0.active).toBe(true);
    e.feed({ partial: "we will rent a bigger office" });
    expect(e.getState().points.s0b0.active).toBeUndefined();
  });

  it("a section change clears the hints", () => {
    const { e } = unsure();
    e.feed({ partial: "we will raise prices in" });
    e.dispatch({ type: "nextSection" });
    expect(e.getState().points.s0b0.active).toBeUndefined();
  });

  it("the decision window never starts in the middle of a word", async () => {
    const { e, calls } = unsure();
    e.feed({ committed: "Oggi abbiamo quattrocentocinquanta clienti attivi in Italia. " });
    await e.tick();
    const first = calls[0].transcript.split(" ")[0];
    expect("Oggi abbiamo quattrocentocinquanta clienti attivi in Italia.".split(" ")).toContain(first);
  });
});

it.each(["stop", "reset"] as const)("discards the durable place on %s even with marks in another section", action => {
  const { e } = makeEngine();
  e.start();
  e.dispatch({ type: "markStarted", id: "s0b0" });
  e.dispatch({ type: "anchor", idx: 1 });
  expect(e.committedPlace()?.points.s0b0).toBeDefined();
  if (action === "stop") e.stop();
  else e.dispatch({ type: "resetSection" });
  expect(e.committedPlace()).toBeNull();
});

it("accepts the same final in a new section rehearsal without interim events", async () => {
  const { e, calls } = makeEngine([{ s0b0: 1 }]);
  for (let take = 0; take < 2; take++) {
    e.dispatch({ type: "resetSection" });
    e.feed({ committed: "Hello everyone!" });
    await e.tick();
    expect(e.getState().points.s0b0?.status).toBe("started");
  }
  expect(calls).toHaveLength(2);
});

it("uses the replacement clause inside a punctuation-free final", async () => {
  const { e } = makeEngine([{ s0b0: 1 }]);
  e.loadScript(parseScript("# Production\n- Workshop Friday"));
  e.feed({ committed: "the workshop is Friday I mean the interview is Friday" });
  await e.tick();
  expect(e.getState().points.s0b0?.status).toBe("waiting");
});

it("reconciles a first-person amendment without matching an entire cue sentence", async () => {
  const { e } = makeEngine([{ s0b0: 1 }]);
  e.loadScript(parseScript("# Events\n- Workshop Friday"));
  e.feed({ committed: "Our workshop is Friday. " });
  await e.tick();
  expect(e.getState().points.s0b0.status).toBe("started");
  e.feed({ committed: "I should clarify, the interview is Friday." });
  await e.tick();
  expect(e.getState().points.s0b0.status).toBe("waiting");
});
