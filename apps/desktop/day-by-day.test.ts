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
