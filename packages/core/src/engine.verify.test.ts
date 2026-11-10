// Verification before a tick (engine.ts `verify`, TRK-2): with a provider that can verify, a point
// that is ready to tick first gets two focused questions, and ticks only when both pass.
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse, Verification } from "./api";

const SCRIPT = parseScript(`# Plans
- Office move in January
- New pricing page
`);
const MOVE = "s0b0";

type Reply = { confidence: number; verification?: Verification };

/** A provider that can verify: answers each call from `replies` (the last one repeats) and records the requests. */
function setup(replies: Reply[], opts: { canVerify?: boolean; engine?: Partial<ConstructorParameters<typeof Engine>[0]> } = {}) {
  const calls: DecideRequest[] = [];
  const verdicts: Array<{ id: string; ok: boolean }> = [];
  let i = 0;
  const decide = async (r: DecideRequest): Promise<DecideResponse> => {
    calls.push(r);
    const a = replies[Math.min(i++, replies.length - 1)];
    return {
      decisions: r.bullets.map((b) =>
        b.id === MOVE
          ? { id: b.id, confidence: a.confidence, started: a.confidence >= 0.7, ...(r.verify?.includes(b.id) && a.verification ? { verification: a.verification } : {}) }
          : { id: b.id, confidence: 0, started: false },
      ),
      latencyMs: 100,
      cost: 0,
      model: "test",
      ...(opts.canVerify === false ? {} : { canVerify: true }),
    };
  };
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, onVerify: (id, _v, ok) => verdicts.push({ id, ok }), ...opts.engine });
  e.loadScript(SCRIPT);
  e.feed({ committed: "The office move is in January, the lease is signed. ", partial: "" });
  return { e, calls, verdicts, status: () => e.getState().points[MOVE]?.status ?? "waiting" };
}
const PASS: Verification = { real: 0.95, sameParty: 0.9 };

describe("verification before a tick", () => {
  it("a sure answer does not tick at once: the engine asks again with `verify`, then ticks", async () => {
    const { e, calls, verdicts, status } = setup([{ confidence: 0.93 }, { confidence: 0.93, verification: PASS }]);
    await e.tick();
    expect(calls).toHaveLength(2); // the answer and, right away, its verification
    expect(calls[0].verify).toBeUndefined();
    expect(calls[1].verify).toEqual([MOVE]);
    expect(status()).toBe("started");
    expect(verdicts).toEqual([{ id: MOVE, ok: true }]);
    const p = e.getState().points[MOVE];
    expect(p.evidence).toMatchObject({ source: "model", verified: { real: 0.95, sameParty: 0.9 } });
  });

  it("a plan the speaker calls cancelled does not tick, whatever the confidence", async () => {
    const { e, calls, verdicts, status } = setup([{ confidence: 0.94 }, { confidence: 0.94, verification: { real: 0.05, sameParty: 0.9 } }]);
    await e.tick();
    expect(status()).toBe("waiting");
    expect(verdicts).toEqual([{ id: MOVE, ok: false }]);
    // Same text: nothing more to ask, and no tick later either.
    await e.tick();
    await e.tick();
    expect(calls).toHaveLength(2);
    expect(status()).toBe("waiting");
  });

  it("said of another party: no tick", async () => {
    const { e, status } = setup([{ confidence: 0.94 }, { confidence: 0.94, verification: { real: 0.97, sameParty: 0.3 } }]);
    await e.tick();
    expect(status()).toBe("waiting");
  });

  it("an answer below `sure` is verified in its second confirming call: no extra call", async () => {
    const { e, calls, status } = setup([{ confidence: 0.75 }, { confidence: 0.75, verification: PASS }]);
    await e.tick();
    expect(status()).toBe("waiting");
    expect(calls).toHaveLength(1);
    await e.tick(); // the re-ask for the second confirmation carries the verification
    expect(calls).toHaveLength(2);
    expect(calls[1].verify).toEqual([MOVE]);
    expect(status()).toBe("started");
  });

  it("a vetoed point starts over: new speech must confirm and verify again", async () => {
    const { e, calls, status } = setup([
      { confidence: 0.94 },
      { confidence: 0.94, verification: { real: 0.1, sameParty: 0.9 } },
      { confidence: 0.94, verification: PASS },
    ]);
    await e.tick();
    expect(status()).toBe("waiting");
    e.feed({ committed: "Correction: the move is confirmed for January after all. ", partial: "" });
    await e.tick();
    // After the veto the streak is 0, so the first call on new text is not verified yet; its follow-up is.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(status()).toBe("started");
  });

  it("a provider that says it can verify but sends no verification never ticks and is asked once more, not forever", async () => {
    const { e, calls, status } = setup([{ confidence: 0.93 }]);
    await e.tick();
    expect(calls).toHaveLength(2);
    expect(status()).toBe("waiting");
    await e.tick();
    expect(calls).toHaveLength(2);
  });

  it("a provider that cannot verify ticks as before", async () => {
    const { e, calls, status } = setup([{ confidence: 0.93 }], { canVerify: false });
    await e.tick();
    expect(calls).toHaveLength(1);
    expect(status()).toBe("started");
  });

  it("`verify: false` turns it off", async () => {
    const { e, calls, status } = setup([{ confidence: 0.93 }], { engine: { verify: false } });
    await e.tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].verify).toBeUndefined();
    expect(status()).toBe("started");
  });

  it("the thresholds are options: a stricter `real` vetoes what the default lets through", async () => {
    const borderline: Verification = { real: 0.7, sameParty: 0.9 };
    const lenient = setup([{ confidence: 0.93 }, { confidence: 0.93, verification: borderline }]);
    await lenient.e.tick();
    expect(lenient.status()).toBe("started");
    const strict = setup([{ confidence: 0.93 }, { confidence: 0.93, verification: borderline }], { engine: { verifyThreshold: { real: 0.8, sameParty: 0.5 } } });
    await strict.e.tick();
    expect(strict.status()).toBe("waiting");
  });
});
