import assert from "node:assert/strict";
const { it, afterEach } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const loadStore = createRequire(import.meta.url);
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
function open() { return loadStore("./day-by-day-store").openDailyStore(dir); }
for (const title of ["Send the agenda", "Inviare il programma"]) it("restores and undoes " + title, () => {
  dir = mkdtempSync(join(tmpdir(), "daily-"));
  const s = open();
  const add = (text: string, op: string) => s.apply({ type: "create", op, text, due: "2026-06-05" });
  const a = add(title, "a").id;
  const b = add("B", "b").id;
  const tick = { type: "complete", id: a, rev: 1, op: "delivery", words: "They received it" };
  assert.equal(s.apply(tick).rev, 2);
  writeFileSync(join(dir, "daily.json.tmp"), "{");
  const recovered = open();
  assert.equal(recovered.apply(tick), null);
  assert.equal(recovered.view().tasks[0].evidence, tick.words);
  const correct = { type: "reopen", id: a, rev: 2, op: "repair", words: "I stand corrected" };
  recovered.apply(correct);
  recovered.apply({ type: "edit", id: b, rev: 1, op: "rename", text: "B2" });
  const undo = { type: "undo", id: a, rev: 3, op: "undo" };
  assert.deepEqual(recovered.apply(undo), { id: a, rev: 4 });
  const [first, second] = open().view().tasks;
  assert.deepEqual([first.done, first.evidence, second.text], [true, tick.words, "B2"]);
  assert.equal(recovered.apply(undo), null);
  recovered.apply({ type: "edit", id: a, rev: 4, op: "edit", text: "A2" });
  assert.equal(recovered.apply({ ...undo, op: "late" }), null);
});
it("acknowledges only after replacement succeeds", () => {
  dir = mkdtempSync(join(tmpdir(), "daily-"));
  const s = open();
  mkdirSync(join(dir, "daily.json.tmp"));
  const action = { type: "create", op: "retry", text: "Plan", due: "2026-06-05" };
  assert.throws(() => s.apply(action));
  assert.deepEqual(s.view().tasks, []);
  rmSync(join(dir, "daily.json.tmp"), { recursive: true });
  assert.equal(s.apply(action).rev, 1);
});

function seed() {
  dir = mkdtempSync(join(tmpdir(), "daily-"));
  const store = open();
  const add = (op: string) => store.apply({ type: "create", op, text: op, due: "2026-06-05" });
  return { store, first: add("first"), second: add("second") };
}
for (const type of ["delete", "clear", "undo"]) it("persists " + type + " after creating two rows", () => {
  const {store, first, second} = seed();
  const action = { ...first, type, op: "remove" };
  assert.ok(store.apply(action));
  assert.equal(open().version, 3);
  assert.deepEqual(open().view().tasks.map((r: any) => r.id), type === "clear" ? [] : [second.id]);
  assert.equal(store.apply(action), null);
});
it("retains unfinished rows and expires archives from completion even after a rename", () => {
  dir = mkdtempSync(join(tmpdir(), "daily-"));
  let clock = Date.now();
  const store = loadStore("./day-by-day-store").openDailyStore(dir, () => clock);
  const create = (text: string) => store.apply({ type: "create", op: text, text, due: "2026-06-05" });
  const keep = create("keep"), archive = create("archive");
  clock += 31 * 86400000;
  assert.equal(store.view().tasks.length, 2);
  store.apply({ ...archive, type: "complete", op: "completed" });
  clock += 29 * 86400000;
  store.apply({ id: archive.id, rev: 2, type: "edit", op: "edit", text: "renamed" });
  assert.equal(store.view().tasks.length, 2);
  clock += 86400000;
  assert.deepEqual(store.view().tasks.map((r: any) => r.id), [keep.id]);
  assert.deepEqual(open().view().tasks.map((r: any) => r.id), [keep.id]);
});
