// Audit 0.9.42 (70cc3f6): regression tests for behaviours that exist today, from the audit's behaviour checks
// (plan-review.md section 8). EN and IT each. Deterministic: the decision call is a promise the test resolves by hand.
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";

const SCRIPTS = {
  en: parseScript(`# Backups\n- how long we keep backups (retention)\n- how to restore a backup\n`),
  it: parseScript(`# Backup\n- per quanto tempo teniamo i backup (conservazione)\n- come ripristinare un backup\n`),
};
const SAID = {
  en: { partial: "how long we keep backups", committed: "we keep backups for thirty days ", other: "and now something else entirely " },
  it: { partial: "per quanto tempo teniamo i backup", committed: "teniamo i backup per trenta giorni ", other: "e adesso parliamo di altro " },
};

/** An engine whose decision calls wait until the test answers them. */
function manual(lang: "en" | "it") {
  const asked: Array<{ req: DecideRequest; answer: (conf: number) => void }> = [];
  const decide = (req: DecideRequest) =>
    new Promise<DecideResponse>((resolve) => {
      asked.push({
        req,
        answer: (conf) => resolve({ decisions: req.bullets.map((b, i) => ({ id: b.id, confidence: i === 0 ? conf : 0, started: i === 0 && conf >= 0.7 })), latencyMs: 1, cost: 0, model: "test" }),
      });
    });
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, verify: false, guard: false });
  e.loadScript(SCRIPTS[lang]);
  return { e, asked, first: SCRIPTS[lang].sections[0].bullets[0].id };
}

describe.each(["en", "it"] as const)("presentation tracking behaviour (%s)", (lang) => {
  it("a partial transcript never reaches the decision call and never marks a point said", async () => {
    const { e, asked, first } = manual(lang);
    e.feed({ partial: SAID[lang].partial });
    await e.tick();
    expect(asked).toHaveLength(0);
    expect(e.getState().points[first]?.status ?? "waiting").toBe("waiting");
  });

  it("a manual undo stays when an older decision reply arrives afterwards", async () => {
    const { e, asked, first } = manual(lang);
    e.feed({ committed: SAID[lang].committed });
    const t = e.tick();
    expect(asked).toHaveLength(1); // a decision about the first point is on its way
    e.dispatch({ type: "markStarted", id: first }); // the presenter ticks it by hand...
    e.dispatch({ type: "reopen", id: first }); // ...and undoes it
    asked[0].answer(0.95); // the old reply says "said"
    await t;
    expect(e.getState().points[first]?.status ?? "waiting").toBe("waiting");
  });

  it("Stop drops a decision that was in flight", async () => {
    const { e, asked, first } = manual(lang);
    e.start();
    e.feed({ committed: SAID[lang].committed });
    const t = e.tick();
    expect(asked).toHaveLength(1);
    e.stop();
    asked[0].answer(0.95);
    await t;
    expect(e.getState().points[first]?.status ?? "waiting").toBe("waiting");
  });

  it("a duplicated manual command converges on one state", () => {
    const { e, first } = manual(lang);
    const a = e.dispatch({ type: "markStarted", id: first });
    const v = e.getState().version;
    const b = e.dispatch({ type: "markStarted", id: first });
    expect(a.ok && b.ok).toBe(true);
    expect(e.getState().points[first].status).toBe("started");
    expect(e.getState().version).toBe(v + 1); // re-applied, same status: views see one more version, not a second point
  });
});
