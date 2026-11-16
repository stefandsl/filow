import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest } from "./api";

// C11: a status placeholder as partial at the Reset must not fence the next real sentence.
const PRICES = parseScript(`# Next steps
- We will raise prices in January
- Ship the mobile app to 50 pilot customers
`);
// Same "listening" model as engine.test.ts (Reset section describe): yes only when the transcript says it.
function listening() {
  const calls: DecideRequest[] = [];
  const says: Record<string, RegExp> = { s0b0: /raise prices in january/i, s0b1: /mobile app to 50 pilot/i };
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

describe("C11: status placeholder at Reset", () => {
  it("control: no partial at the Reset -> the next sentence ticks", async () => {
    const { e } = listening();
    e.feed({ committed: "Good morning everyone. ", partial: "" });
    e.dispatch({ type: "resetSection" });
    e.feed({ partial: "we will raise prices" });
    e.feed({ committed: "We will raise prices in January. ", partial: "" });
    await ticks(e, 4);
    expect(e.getState().points.s0b0?.status).toBe("started");
  });

  it("ElevenLabs '(reconnecting 1/3…)' shown at the Reset does not fence the first sentence after it", async () => {
    const { e, calls } = listening();
    e.feed({ committed: "Good morning everyone. ", partial: "" });
    // elevenlabs.ts:79 on socket close
    e.feed({ partial: "(reconnecting 1/3…)" });
    e.dispatch({ type: "resetSection" });
    // new socket: partials, then committed_transcript (elevenlabs.ts:53,56)
    e.feed({ partial: "we will raise prices" });
    e.feed({ committed: "We will raise prices in January. ", partial: "" });
    await ticks(e, 4);
    expect(calls.map((c) => c.transcript)).toContain("We will raise prices in January.");
    expect(e.getState().points.s0b0?.status).toBe("started");
  });
});
