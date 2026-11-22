import assert from "node:assert/strict";
import { it } from "vitest";
import { createLesson, LESSON_URL } from "./okfilow-lesson";

function trial() {
  const origin = { browser: "edge-1", window: 38, tab: "tab-1", frame: "f", loader: "before", url: "about:blank#class", entry: 1 };
  const effects: string[] = [];
  const saved: unknown[] = [];
  let current = { ...origin };
  let foreground = true;
  const driver = {
    prepare: async () => origin, current: async () => current,
    open: async (url: string) => { effects.push(url); },
    close: () => {},
  };
  const lesson = createLesson({ driver, focused: () => foreground, journal: { read: () => null, write: (value: unknown) => saved.push(value) } });
  const owner = "main:1";
  async function proposal(words = "Open Cloud Lab") {
    const { turn } = await lesson.prepare(owner);
    const result = await lesson.request(owner, turn, words);
    assert.equal(result.phase, "approval");
    return result.decision;
  }
  return { lesson, proposal, owner, effects, saved, changeTarget: () => { current = { ...origin, tab: "elsewhere" }; }, blur: () => { foreground = false; } };
}

it("consumes one exact local decision even with concurrent approvals", async () => {
  const x = trial();
  const decision = await x.proposal("Apri Cloud Lab.");
  await Promise.all([x.lesson.approve(x.owner, decision), x.lesson.approve(x.owner, decision)]);
  await x.lesson.approve(x.owner, decision);
  assert.deepEqual(x.effects, [LESSON_URL]);
  assert.ok(x.saved.some((row: any) => row?.phase === "dispatched" && row.turn === decision.turn));
});

it("refuses each changed field, a changed target, loss of focus, decline and a stopped turn", async () => {
  for (const key of ["teacher", "window", "tab", "turn", "action", "url"]) {
    const x = trial();
    const decision = await x.proposal();
    await x.lesson.approve(x.owner, { ...decision, [key]: "other" });
    assert.deepEqual(x.effects, [], key);
  }
  for (const change of ["owner", "target", "blur", "decline", "stop"]) {
    const x = trial();
    const decision = await x.proposal();
    if (change === "target") x.changeTarget();
    if (change === "blur") x.blur();
    if (change === "stop" || change === "decline") x.lesson.stop(x.owner, decision.turn);
    await x.lesson.approve(change === "owner" ? "phone" : x.owner, decision);
    assert.deepEqual(x.effects, [], change);
  }
});
