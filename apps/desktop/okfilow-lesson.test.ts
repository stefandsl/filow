import assert from "node:assert/strict";
import { it } from "vitest";
import { createLesson, createLessonDraft, LESSON_URL, arrived, cooled } from "./okfilow-lesson";

function trial() {
  const origin = { browser: "edge-1", window: 38, tab: "tab-1", frame: "f", loader: "before", url: "about:blank#class", entry: 1, selected: true };
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
  return { lesson, proposal, owner, effects, saved, changeTarget: () => { current = { ...origin, tab: "elsewhere" }; },
    backgroundTab: () => { current = { ...origin, selected: false }; }, blur: () => { foreground = false; } };
}

it("accepts only the current visible lesson panel's one draft and drops delayed speech after Stop", () => {
  const drafts: string[] = [];
  const form = createLessonDraft();
  form.begin("turnA", (text: string) => drafts.push(text));
  assert.equal(form.submit(false, "turnA", "open Cloud Lab"), false);
  assert.equal(form.submit(true, "turnB", "open Cloud Lab"), false);
  form.clear();
  assert.equal(form.submit(true, "turnA", "open Cloud Lab"), false);
  form.begin("turnB", (text: string) => drafts.push(text));
  assert.equal(form.submit(true, "turnB", "apri Cloud Lab"), true);
  assert.equal(form.submit(true, "turnB", "apri Cloud Lab"), false);
  assert.deepEqual(drafts, ["apri Cloud Lab"]);
});

it("consumes one exact local decision even with concurrent approvals", async () => {
  const x = trial();
  const decision = await x.proposal("Apri Cloud Lab.");
  await Promise.all([x.lesson.approve(x.owner, decision), x.lesson.approve(x.owner, decision)]);
  await x.lesson.approve(x.owner, decision);
  assert.deepEqual(x.effects, [LESSON_URL]);
  assert.ok(x.saved.some((row: any) => row?.phase === "dispatched" && row.turn === decision.turn));
});

it("requires a fresh top-level document and a trusted change to this slider", () => {
  const origin = { browser: "edge", window: 2, tab: "tab", frame: "f", entry: 1, loader: "before" };
  const live = { ...origin, entry: 2, loader: "after", previous: 1, url: LESSON_URL, frameUrl: LESSON_URL,
    documentUrl: LESSON_URL, referrer: "http://127.0.0.1:48764/filow-turn/abc", started: 101,
    redirects: 0, status: 200, navigation: "navigate", complete: true };
  assert.equal(arrived(origin, live, "abc", 100), true);
  for (const changed of [{ tab: "prior" }, { previous: 0 }, { redirects: 1 }, { referrer: "" },
    { entry: 1 }, { loader: "before" }, { started: 99 }, { documentUrl: "about:blank" }, { navigation: "reload" }, { status: 404 }]) {
    assert.equal(arrived(origin, { ...live, ...changed }, "abc", 100), false);
  }
  for (const [start, dew, end] of [[20, 12, 10], [28, 18, 17], [4, -1, -2]]) {
    const first = { temperature: start, dew, input: 0 };
    const moved = { temperature: end, dew, input: 1, focused: true, inputValue: end };
    assert.ok(cooled(first, moved));
    for (const change of [{ temperature: start }, { temperature: dew + 1 }, { input: 0 }, { inputValue: start },
      { focused: false }, { dew: dew + 1 }]) assert.equal(cooled(first, { ...moved, ...change }), false);
  }
});

it("refuses each changed field, a changed target, loss of focus, decline and a stopped turn", async () => {
  for (const key of ["teacher", "window", "tab", "turn", "action", "url"]) {
    const x = trial();
    const decision = await x.proposal();
    await x.lesson.approve(x.owner, { ...decision, [key]: "other" });
    assert.deepEqual(x.effects, [], key);
  }
  for (const change of ["owner", "target", "background tab", "blur", "decline", "stop"]) {
    const x = trial();
    const decision = await x.proposal();
    if (change === "target") x.changeTarget();
    if (change === "background tab") x.backgroundTab();
    if (change === "blur") x.blur();
    if (change === "stop" || change === "decline") x.lesson.stop(x.owner, decision.turn);
    await x.lesson.approve(change === "owner" ? "phone" : x.owner, decision);
    assert.deepEqual(x.effects, [], change);
  }
});

it("reconciles the interrupted dispatch without sending it again and retires the pointer on takeover", async () => {
  const turn = "74e9efa4-85ae-4a8f-8961-f9ef4e41b975";
  const origin = { browser: "edge", tab: "tab", window: 1, frame: "f", entry: 1, loader: "first", url: "about:blank#filow-" + turn };
  const receipt = { phase: "dispatched", turn, sentAt: 10, origin };
  const live = { ...origin, entry: 2, previous: 1, loader: "second", frameUrl: LESSON_URL, url: LESSON_URL,
    documentUrl: LESSON_URL, referrer: "http://127.0.0.1:48764/filow-turn/" + turn, navigation: "navigate", status: 200,
    complete: true, started: 12, redirects: 0, slider: { focused: true, temperature: 20, dew: 12, input: 0, control: "range" } };
  for (const matching of [false, true]) {
    let closed = 0, points = 0, opens = 0;
    const driver = { prepare: () => { throw Error("unexpected browser launch"); }, open: () => { opens++; }, attach() {}, show() {},
      observe: () => matching ? live : { ...live, referrer: "" }, point: () => { points++; }, close: () => { closed++; } };
    const lesson = createLesson({ driver, focused: () => true, journal: { read: () => receipt, write() {} } });
    assert.equal((await lesson.prepare("teacher")).phase, "interrupted");
    assert.equal((await lesson.reconcile("teacher", turn)).phase, matching ? "dispatched" : "held");
    if (matching) {
      assert.equal((await lesson.observe("teacher", turn)).phase, "guiding");
      live.slider.focused = false;
      assert.equal((await lesson.observe("teacher", turn)).phase, "held");
      assert.equal(closed, 1);
    }
    assert.equal(points, matching ? 1 : 0);
    assert.equal(opens, 0);
  }
});

it("drops a target check that finishes after keyboard or on-screen Stop", async () => {
  let finish!: (value: object) => void;
  let sends = 0;
  const target = { browser: "edge", window: 2, tab: "tab", selected: true, url: "about:blank" };
  const driver = { prepare: async () => target, close() {}, current: () => new Promise(resolve => { finish = resolve; }), open() { sends++; } };
  const lesson = createLesson({ driver, focused: () => true, journal: { read: () => null, write() {} } });
  const { turn } = await lesson.prepare("teacher");
  const { decision } = lesson.request("teacher", turn, "Open Cloud Lab");
  const approval = lesson.approve("teacher", decision);
  lesson.stop("teacher", turn);
  finish(target);
  await approval;
  assert.equal(sends, 0);
  assert.equal(lesson.view().phase, "idle");
});
