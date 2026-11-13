import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";

const SCRIPT = parseScript(`# Intro
- hello everyone
- what we build today
`);

/**
 * A local model that Ollama unloaded: while `gone`, every call hangs until the engine aborts it (a load
 * slower than the timeout); once back, the first point is answered as surely started.
 */
function setup(opts: { reload?: () => Promise<unknown> | undefined; reloadAfter?: number } = {}) {
  const model = { gone: true, calls: [] as DecideRequest[], aborted: 0 };
  const decide = (r: DecideRequest, signal?: AbortSignal) => {
    model.calls.push(r);
    if (model.gone)
      return new Promise<DecideResponse>((_res, rej) =>
        signal?.addEventListener("abort", () => {
          model.aborted++;
          rej(new DOMException("aborted", "AbortError"));
        }),
      );
    return Promise.resolve<DecideResponse>({
      decisions: r.bullets.map((b, i) => ({ id: b.id, confidence: i === 0 ? 0.95 : 0, started: i === 0 })),
      latencyMs: 300,
      cost: 0,
      model: "clef-flash (local)",
    });
  };
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, timeoutMs: 20, ...opts });
  e.loadScript(SCRIPT);
  e.feed({ committed: "hello everyone, thanks for coming" });
  return { e, model };
}

/** A reload the test settles by hand, recording how it was called. */
function manualReload() {
  const r = { calls: 0, args: [] as unknown[][], resolve: () => {}, reject: (_e: Error) => {} };
  const fn = (...args: unknown[]) => {
    r.calls++;
    r.args.push(args);
    return new Promise<unknown>((res, rej) => {
      r.resolve = () => res({ ok: true });
      r.reject = rej;
    });
  };
  return { r, fn };
}

const flush = () => new Promise((res) => setTimeout(res, 0));

describe("Engine: the decision model unloaded mid-take", () => {
  it("after two timeouts in a row reloads once, asks nothing while it loads, then ticks again", async () => {
    const { r, fn } = manualReload();
    const { e, model } = setup({ reload: fn });
    await e.tick();
    expect(r.calls).toBe(0); // one timeout is only "slow"
    expect(e.getState().engine.slowMs).toBe(20);
    await e.tick();
    expect(model.aborted).toBe(2);
    expect(r.calls).toBe(1);
    expect(r.args[0]).toEqual([]); // nothing the engine could abort
    expect(e.getState().engine.reloading).toBe(true);
    expect(e.getState().engine.slowMs).toBeUndefined();
    // While the model loads no call is made: an aborted call would cancel the load.
    for (let i = 0; i < 5; i++) await e.tick();
    expect(model.calls).toHaveLength(2);
    expect(r.calls).toBe(1);
    model.gone = false;
    r.resolve();
    await flush();
    expect(e.getState().engine.reloading).toBeUndefined();
    // The same words are asked again right away (nothing new was said meanwhile).
    await e.tick();
    expect(model.calls).toHaveLength(3);
    expect(model.calls[2].transcript).toBe("hello everyone, thanks for coming");
    expect(e.getState().points.s0b0).toMatchObject({ status: "started", confidence: 0.95 });
  });

  it("does not reload for a timeout followed by an answer: only timeouts in a row count", async () => {
    const { r, fn } = manualReload();
    const { e, model } = setup({ reload: fn });
    await e.tick(); // timeout
    model.gone = false;
    e.feed({ committed: "and today we build" });
    await e.tick(); // answer
    model.gone = true;
    e.feed({ committed: "something new" });
    await e.tick(); // timeout
    expect(r.calls).toBe(0);
    expect(e.getState().engine.reloading).toBeUndefined();
    e.feed({ committed: "again" });
    await e.tick(); // second timeout in a row
    expect(r.calls).toBe(1);
  });

  it("resumes after a failed reload, and a later run of timeouts reloads again", async () => {
    const { r, fn } = manualReload();
    const { e, model } = setup({ reload: fn });
    await e.tick();
    await e.tick();
    expect(r.calls).toBe(1);
    r.reject(new Error("Ollama not reachable"));
    await flush();
    expect(e.getState().engine.reloading).toBeUndefined();
    expect(e.getState().engine.error).toBeUndefined();
    await e.tick();
    expect(model.calls).toHaveLength(3);
    expect(r.calls).toBe(1); // one timeout after the reload is not yet a run
    await e.tick();
    expect(r.calls).toBe(2);
  });

  it("keeps asking at the normal budget when there is nothing to reload (a cloud model)", async () => {
    let asked = 0;
    const { e, model } = setup({ reload: () => (asked++, undefined) });
    for (let i = 0; i < 4; i++) await e.tick();
    expect(model.calls).toHaveLength(4);
    expect(asked).toBe(2);
    expect(e.getState().engine.reloading).toBeUndefined();
    expect(e.getState().engine.slowMs).toBe(20);
  });

  it("honours reloadAfter", async () => {
    const { r, fn } = manualReload();
    const { e } = setup({ reload: fn, reloadAfter: 3 });
    await e.tick();
    await e.tick();
    expect(r.calls).toBe(0);
    await e.tick();
    expect(r.calls).toBe(1);
  });
});

describe("Engine: the take-start warm-up is the model's first load, not an unload", () => {
  /** A warm-up the test settles by hand. */
  function warm() {
    const w = { pending: undefined as Promise<unknown> | undefined, done: () => {} };
    w.pending = new Promise<unknown>((res) => (w.done = () => ((w.pending = undefined), res(undefined))));
    return w;
  }

  it("timeouts while the warm-up loads do not reload, ask nothing, and normal counting resumes after it", async () => {
    const { r, fn } = manualReload();
    const w = warm();
    const { e, model } = setup({ reload: fn, warming: () => w.pending });
    await e.tick(); // times out during the warm-up
    expect(e.getState().engine.slowMs).toBe(20);
    expect(r.calls).toBe(0);
    for (let i = 0; i < 5; i++) await e.tick(); // waiting for the warm-up: no second load, no call
    expect(model.calls).toHaveLength(1);
    expect(r.calls).toBe(0);
    expect(e.getState().engine.reloading).toBeUndefined();
    model.gone = false;
    w.done();
    await flush();
    await e.tick(); // the model is loaded: answered
    expect(model.calls).toHaveLength(2);
    expect(e.getState().points.s0b0).toMatchObject({ status: "started", confidence: 0.95 });
  });

  it("after the warm-up settled, two timeouts in a row still reload", async () => {
    const { r, fn } = manualReload();
    const w = warm();
    const { e } = setup({ reload: fn, warming: () => w.pending });
    await e.tick();
    w.done();
    await flush();
    await e.tick();
    expect(r.calls).toBe(0);
    await e.tick();
    expect(r.calls).toBe(1);
    expect(e.getState().engine.reloading).toBe(true);
  });

  it("a failing warm-up releases the wait too", async () => {
    const { fn } = manualReload();
    let rej: (e: Error) => void = () => {};
    const p = new Promise<unknown>((_res, j) => (rej = j));
    const { e, model } = setup({ reload: fn, warming: () => p });
    await e.tick();
    rej(new Error("Ollama not reachable"));
    await flush();
    await e.tick();
    expect(model.calls).toHaveLength(2);
  });
});
