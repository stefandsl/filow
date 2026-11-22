import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { it, afterEach } = process.env.VITEST ? await import("vitest") : await import("node:test");
const load = createRequire(import.meta.url);
const { dailyFrame, createDaily } = load("./day-by-day");
const { openDailyStore } = load("./day-by-day-store");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function storage() {
  const dir = mkdtempSync(join(tmpdir(), "daily-owner-"));
  dirs.push(dir);
  return openDailyStore(dir);
}
it("checks the page, main frame, origin and window for each action", () => {
  const origin = "http://127.0.0.1:51123";
  const frame = { url: origin + "/day-by-day" };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const e = { sender: win.webContents, senderFrame: frame };
  assert.ok(dailyFrame(e, win, origin));
  for (const url of [origin + "/", origin + "/mirror", origin + "/settings", "https://example.invalid/day-by-day"]) {
    frame.url = url;
    assert.equal(dailyFrame(e, win, origin), false);
  }
  frame.url = origin + "/day-by-day";
  assert.equal(dailyFrame({ ...e, senderFrame: { ...frame } }, win, origin), false);
  assert.equal(dailyFrame({ ...e, sender: {} }, win, origin), false);
});
it("uses device civil days across midnight and fences an old renderer and list snapshot", () => {
  let now = new Date(2026, 2, 28, 23, 59);
  const daily = createDaily({ store: storage(), now: () => now });
  const first = daily.control("open");
  const tomorrow = daily.control("day", { ...first, offset: 1 });
  const added = daily.control("create", { ...tomorrow, text: "Bind reports", op: "first" });
  assert.equal(added.day, "2026-03-29");
  assert.equal(added.tasks[0].due, added.day);
  assert.equal(daily.control("create", { ...tomorrow, op: "racing", text: "Extra" }).status, "stale");
  now = new Date(2026, 2, 29, 0, 1);
  assert.equal(daily.control("create", { ...added, op: "late", text: "Extra" }).status, "stale");
  const resumed = daily.control("open");
  assert.equal(resumed.tasks[0].id, added.ack.id);
  assert.throws(() => daily.control("edit", { ...added, ...added.ack, text: "Old", op: "old" }));
  const edit = daily.control("edit", { ...resumed, ...added.ack, text: "File reports", op: "edit" });
  assert.equal(edit.tasks[0].text, "File reports");
  now = new Date(2026, 2, 30, 0, 1);
  assert.equal(daily.control("state", edit).tasks[0].id, added.ack.id);
});

it("recognizes the next report after a task was added during a listening pause", async () => {
  const messages: any[] = [];
  const worker: any = { ready: true, start: async () => ({ model: "local" }), feed() {}, dispose() {},
    worker: { postMessage(m: any) { worker.context = m.context; } } };
  const daily = createDaily({ store: storage(), recognizer: () => worker, notify: (m: any) => messages.push(m) });
  let v = daily.control("open");
  const capture = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await daily.control("arm", { ...v, capture });
  const pcm = () => daily.feed({ session: v.session, capture }, new Float32Array(1600));
  pcm();
  const oldContext = worker.context;
  v = daily.control("create", { ...v, op: "plan", text: "Give Noah the maps" });
  pcm();
  worker.onResult({ sequence: 2, context: oldContext, committed: "Noah received the maps" });
  assert.equal(daily.control("state", v).review, null);
  worker.onResult({ sequence: 3, context: worker.context, committed: "Noah received the maps" });
  const review = daily.control("state", v).review;
  assert.ok(review, "fresh report after an idle microphone block");
  assert.equal(review.targets[0].id, v.ack.id);
  const confirmed = daily.control("confirm", { ...v, token: review.token, id: v.ack.id });
  assert.equal(confirmed.ack.rev, 2);
  pcm();
  worker.onResult({ sequence: 3, context: worker.context, committed: "Noah received the maps" });
  assert.equal(messages.filter(m => m.final).length, 1);
  assert.equal(daily.control("confirm", { ...confirmed, token: review.token, id: v.ack.id }).ack, undefined);
});


it("retires capture on Stop, worker failure and an interrupted open", async () => {
  const notify: any[] = [], workers: any[] = [];
  const daily = createDaily({ store: storage(), notify: (m: any) => notify.push(m), recognizer: () => {
    const w: any = { ready: true, closed: false, start: () => new Promise(resolve => { w.finish = resolve; }),
      dispose() { w.closed = true; }, feed() {}, worker: { postMessage() {} } };
    workers.push(w);
    return w;
  } });
  const v = daily.control("open");
  const arm = (index: number) => ({ ...v, capture: "00000000-0000-0000-0000-" + String(index).padStart(12, "0") });
  const first = daily.control("arm", arm(0));
  daily.control("disarm", arm(0));
  workers[0].finish({ model: "local" });
  await assert.rejects(first);
  const second = daily.control("arm", arm(1));
  workers[1].finish({ model: "local" }); await second;
  daily.feed(arm(1), new Float32Array(1600));
  workers[0].onResult({ context: 1, sequence: 1, committed: "Write an agenda" });
  workers[1].onResult({ context: 1, partial: "Write" });
  assert.equal(daily.control("state", v).review, null);
  workers[1].onError();
  workers[1].onResult({ context: 1, sequence: 1, committed: "Write an agenda" });
  assert.equal(daily.control("state", v).review, null);
  assert.ok(workers.every(w => w.closed));
  assert.equal(notify.filter(m => m.error).length, 1);
});

it("revalidates a person choice and consumes a typed confirmation across restart", () => {
  const store = storage();
  const daily = createDaily({ store });
  let v = daily.control("open");
  for (const text of ["Give Andre the charts", "Give Andrea the charts"]) v = daily.control("create", { ...v, text, op: text });
  const review = (op: string, text: string) => daily.control("review", { ...v, op, text }).review;
  const unclear = review("pronoun", "She received the charts");
  assert.ok(unclear.which);
  assert.equal(daily.control("dismiss", { ...v, token: unclear.token }).version, 2);
  const newer = review("pronoun2", "She received the charts");
  v = daily.control("edit", { ...v, ...v.tasks[1], op: "rename", text: "Give Andrea the tables" });
  assert.equal(daily.control("confirm", { ...v, token: newer.token, id: v.tasks[0].id }).status, "stale");
  const report = review("delivery", "Andre received the charts");
  v = daily.control("confirm", { ...v, token: report.token, id: v.tasks[0].id });
  assert.equal(v.ack.rev, 2);
  assert.ok(!v.tasks.some((r: any) => r.id === report.targets[0].id));
  v = daily.control("day", { ...v, offset: 2 });
  assert.equal(v.tasks[0].id, report.targets[0].id);
  v = daily.control("reopen", { ...v, ...v.tasks[0], op: "manual" });
  const resumed = createDaily({ store });
  v = resumed.control("open");
  const duplicate = resumed.control("review", { ...v, op: "delivery", text: report.words }).review;
  const replay = resumed.control("confirm", { ...v, id: v.tasks[0].id, token: duplicate.token });
  assert.equal(replay.ack, null);
  assert.equal(replay.tasks[0].done, false);
});

it("withdraws the saved grant only from the Settings main frame", async () => {
  const origin = "http://127.0.0.1:51288";
  const frame = { url: origin + "/settings/local" };
  const win = { isDestroyed: () => false, on() {}, webContents: { mainFrame: frame, on() {} } };
  const event = { sender: win.webContents, senderFrame: frame };
  let control: any, persisted: string | null = "previous";
  load("./day-by-day").wireDaily({ win, origin, appOn() {}, appHandle(_name: string, fn: any) { control = fn; },
    saveGrant(key: string | null) { persisted = key; }, hasGrant: () => persisted !== null });
  frame.url = origin + "/mirror";
  await assert.rejects(control(event, "withdrawModel"));
  assert.equal(persisted, "previous");
  frame.url = origin + "/settings/local";
  assert.equal((await control(event, "withdrawModel")).modelGranted, false);
  assert.equal(persisted, null);
});
