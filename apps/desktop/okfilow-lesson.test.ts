import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { it, vi } from "vitest";
import { createLesson, createLessonDraft, LESSON_URL, arrived, cooled } from "./okfilow-lesson";

// Exercise edgeDriver.prepare with Edge ignoring its startup URL. Only the OS
// launch and the private browser's protocol replies are replaced.
function edgeStartup(fault?: "frame" | "history" | "lost reply" | "stop before create" | "stop during create") {
  const turn = "b735532d-68a1-4a46-bf93-b433240e269e";
  const start = "about:blank#filow-" + turn;
  const prior = "about:blank#filow-9252d7cf-2cba-4520-8e3b-a7d8ccc22fc2";
  const tabs = new Map([["startup", "edge://newtab/"], ["prior", prior]]);
  const abort = new AbortController();
  const creates: string[] = [], attaches: string[] = [], calls: string[] = [];
  let currentTab = "", reads = 0, endpointReads = 0;
  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => {
        if (fault === "stop before create") abort.abort();
        this.dispatchEvent(new Event("open"));
      });
    }
    close() { this.dispatchEvent(new Event("close")); }
    send(data: string) {
      const { id, method, params, sessionId } = JSON.parse(data);
      calls.push(method);
      let result = {};
      if (method === "Target.createTarget") {
        creates.push(params.url);
        assert.equal(params.newWindow, true);
        tabs.set("created", params.url);
        result = { targetId: "created" };
        if (fault === "lost reply") { this.close(); return; }
        if (fault === "stop during create") abort.abort();
      } else if (method === "Target.getTargets") {
        result = { targetInfos: [...tabs].map(([targetId, url]) => ({ type: "page", targetId, url })) };
      } else if (method === "Target.attachToTarget") {
        currentTab = params.targetId;
        attaches.push(currentTab);
        assert.ok(tabs.has(currentTab));
        result = { sessionId: "attached" };
      } else if (method === "Browser.getWindowForTarget") {
        result = { windowId: params.targetId === "created" ? 2 : 1, bounds: { windowState: "normal" } };
      } else if (method === "Page.getFrameTree" || method === "Page.getNavigationHistory") {
        assert.equal(sessionId, "attached");
        const url = tabs.get(currentTab)!;
        // The created tab initially reports plain about:blank while its fragment commits.
        if (method === "Page.getFrameTree") {
          reads++;
          const location = fault === "frame" ? prior : reads === 1 ? "about:blank" : url;
          const [base, fragment] = location.split("#");
          result = { frameTree: { frame: { id: "frame", loaderId: "loader", url: base, urlFragment: fragment && "#" + fragment } } };
        } else {
          result = { currentIndex: 0, entries: [{ id: 1, url: fault === "history" ? prior : url }] };
        }
      }
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
    }
  }
  const launch = { spawn: () => {
    const child = Object.assign(new EventEmitter(), { unref() {}, kill() {} });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  } };
  const builtins: Record<string, unknown> = {
    "./cloud-lab": { LESSON_URL, serveCloudLab: async () => ({ instance:"instance", close() {} }) },
    "node:child_process": launch,
    "node:fs": { existsSync: () => true, readFileSync: () => {
      if (++endpointReads === 1) throw Error("endpoint starting");
      return "45100\n/devtools/browser/7cd4ed15-01d4-4cce-ad53-f661b3bebd45";
    } },
    "node:timers/promises": { setTimeout: async (_ms: number, _value: unknown, { signal }: { signal: AbortSignal }) => signal.throwIfAborted() },
  };
  const module = { exports: {} as typeof import("./okfilow-lesson") };
  runInNewContext(readFileSync(path.join(__dirname, "okfilow-lesson.js"), "utf8"), {
    module, require: (name: string) => builtins[name] ?? process.getBuiltinModule(name),
    process: { platform: "win32", env: { ProgramFiles: "programs" } }, WebSocket: Socket, setTimeout, clearTimeout,
  });
  const driver = module.exports.edgeDriver("lesson-profile");
  return { prepare: () => driver.prepare(turn, abort.signal), close: driver.close, calls, attaches, creates, start, tabs };
}

it("prepares the newly created target when Edge opens its new-tab page and a prior turn survives", async () => {
  const edge = edgeStartup();
  try {
    const origin = await edge.prepare();
    assert.deepEqual(edge.creates, [edge.start]);
    assert.deepEqual(edge.attaches, ["created"]);
    assert.equal(origin.tab, "created");
    assert.equal(origin.url, edge.start);
    assert.equal(origin.frameUrl, edge.start);
    assert.equal(origin.selected, true);
    assert.ok(!edge.calls.includes("Page.navigate") && !edge.calls.includes("Page.bringToFront"));
  } finally { edge.close(); }
});

it("withholds readiness on mismatched or uncertain creation and stops pending preparation", async () => {
  for (const fault of ["frame", "history", "lost reply", "stop before create", "stop during create"] as const) {
    const edge = edgeStartup(fault);
    edge.tabs.set("pre-existing copy", edge.start);
    try {
      await assert.rejects(edge.prepare(), fault);
      assert.deepEqual(edge.creates, fault === "stop before create" ? [] : [edge.start], fault);
      assert.deepEqual(edge.attaches, fault === "frame" || fault === "history" ? ["created"] : [], fault);
      assert.ok(!edge.calls.includes("Page.navigate") && !edge.calls.includes("Page.bringToFront"), fault);
    } finally { edge.close(); }
  }
});

function trial(speakerAvailable = () => true) {
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
  const lesson = createLesson({ driver, speakerAvailable, focused: () => foreground, journal: { read: () => null, write: (value: unknown) => saved.push(value) } });
  const owner = "main:1";
  async function proposal(words = "Open Cloud Lab") {
    const { turn } = await lesson.prepare(owner);
    const result = await lesson.request(owner, turn, words);
    assert.equal(result.phase, "speaker");
    return lesson.confirmSpeaker(lesson.challenge()).decision;
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
  const origin = { instance: "instance", browser: "edge", window: 2, tab: "tab", frame: "f", entry: 1, loader: "before" };
  const live = { ...origin, entry: 2, loader: "after", previous: 1, url: LESSON_URL, frameUrl: LESSON_URL,
    documentUrl: LESSON_URL, referrer: "http://127.0.0.1:48764/filow-turn/abc", started: 101,
    redirects: 0, status: 200, navigation: "navigate", complete: true };
  assert.equal(arrived(origin, live, "abc", 100), true);
  for (const changed of [{ instance: "foreign" }, { tab: "prior" }, { previous: 0 }, { redirects: 1 }, { referrer: "" },
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
  for (const key of ["teacher", "presenter", "window", "tab", "turn", "action", "url"]) {
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
  const origin = { instance: "instance", browser: "edge", tab: "tab", window: 1, frame: "f", entry: 1, loader: "first", url: "about:blank#filow-" + turn };
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
  lesson.request("teacher", turn, "Open Cloud Lab");
  const { decision } = lesson.confirmSpeaker(lesson.challenge());
  const approval = lesson.approve("teacher", decision);
  lesson.stop("teacher", turn);
  finish(target);
  await approval;
  assert.equal(sends, 0);
  assert.equal(lesson.view().phase, "idle");
});

it("refuses a foreign listener before launching Edge", async () => {
  const { createServer } = await import("node:http");
  const { edgeDriver } = await import("./okfilow-lesson");
  let requests = 0;
  const foreign = createServer((_req, res) => { requests++; res.end("Cloud Lab"); });
  await new Promise<void>(resolve => foreign.listen(48764, "127.0.0.1", resolve));
  try {
    const driver = edgeDriver("unused");
    await assert.rejects(driver.prepare("test", new AbortController().signal), { code: "EADDRINUSE" });
    assert.equal(requests, 0);
  } finally { foreign.close(); }
});
it("closes the dedicated browser on return", async () => {
  const edge = edgeStartup();
  await edge.prepare();
  edge.close();
  assert.ok(edge.calls.includes("Browser.close"));
});
it("waits for a temperature below the dew point", () => {
  assert.equal(cooled({temperature:22, dew:12, input:0},
    {temperature:12, dew:12, input:1, inputValue:12, focused:true}), false);
});
it("unrelated words create no decision and the exact command requires a fresh speaker check", async () => {
  const x = trial();
  const { turn } = await x.lesson.prepare(x.owner);
  const wrong = x.lesson.request(x.owner, turn, "Describe Cloud Lab");
  assert.equal(wrong.unmatched, true);
  assert.equal(wrong.decision, undefined);
  assert.equal(x.lesson.request(x.owner, turn, "Open Cloud Lab").phase, "speaker");
});

it.each(["never enrolled", "wake off"])("uses a focused presenter confirmation when %s", async () => {
  const x = trial(() => false);
  const { turn } = await x.lesson.prepare(x.owner);
  assert.equal(x.lesson.request(x.owner, turn, "Open Cloud Lab").phase, "presenter");
  assert.equal(x.lesson.challenge(), null);
  assert.equal(x.lesson.confirmPresenter("other", turn).phase, "held");
  const { decision } = x.lesson.confirmPresenter(x.owner, turn);
  assert.equal(decision.teacher, "presenter-click");
  await x.lesson.approve(x.owner, decision);
  assert.deepEqual(x.effects, [LESSON_URL]);
});

it("expires the speaker step at 120 seconds and requires a new review", async () => {
  const x = trial();
  const { turn } = await x.lesson.prepare(x.owner);
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    x.lesson.request(x.owner, turn, "Open Cloud Lab");
    const stale = x.lesson.challenge();
    clock.mockReturnValue(now + 120000);
    assert.equal(x.lesson.view().phase, "ready");
    assert.equal(x.lesson.confirmSpeaker(stale).phase, "held");
    assert.deepEqual(x.effects, []);
    x.lesson.request(x.owner, turn, "Open Cloud Lab");
    assert.notEqual(x.lesson.challenge(), stale);
  } finally { clock.mockRestore(); }
});

it("rejects missing and foreign instance headers at response interception", async () => {
  const { checkLessonResponse } = await import("./okfilow-lesson");
  for (const value of [undefined, "foreign", "mine"]) {
    const calls: string[] = [];
    await checkLessonResponse({ requestId: "r", frameId: "f", request: { url: LESSON_URL },
      responseStatusCode: 200, responseHeaders: value ? [{ name: "X-Filow-Instance", value }] : [] },
      "f", "mine", async (method: string) => { calls.push(method); });
    assert.deepEqual(calls, [value === "mine" ? "Fetch.continueRequest" : "Fetch.failRequest"]);
  }
});

it("serves only requests with this turn's referer", async () => {
  const { serveCloudLab } = await import("./cloud-lab");
  const service = await serveCloudLab("mine", new AbortController().signal);
  try {
    for (const turn of ["", "foreign", "mine"]) {
      const response = await fetch(LESSON_URL, { headers: turn ? { referer: new URL("/filow-turn/" + turn, LESSON_URL).href } : {} });
      assert.equal(response.status, turn === "mine" ? 200 : 404);
    }
  } finally { service.close(); }
});
