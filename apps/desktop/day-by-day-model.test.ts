import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const load = createRequire(import.meta.url);
const tasks = ["Bind the booklet", "Fold the leaflet"].map((text, id) => ({ id: String(id), rev: 2, done: false, text }));
function matcher(result: unknown, inspect = (_: any) => {}) {
  return load("./day-by-day-model").createMatcher("http://127.0.0.1:53781", async (_url: string, init: any) => {
    inspect(JSON.parse(init.body));
    return Response.json({ message: { content: JSON.stringify(result) } });
  });
}

it("maps constrained semantic choices to original task revisions", async () => {
  const match = matcher({ kind: "complete", targets: [0], person: "" }, body => {
    assert.equal(body.format.type, "object");
    assert.deepEqual(body.format.properties.targets.items.enum, [0, 1]);
  });
  const result = await match("The booklet now has its binding", tasks, {});
  assert.deepEqual(result.targets, [{ id: "0", rev: 2, text: "Bind the booklet" }]);
  assert.equal(result.type, "complete");
});

it("honours abstention and rejects invalid model choices", async () => {
  for (const result of [{kind: "none", targets: [], person: ""}, {kind: "complete", targets: [5], person: ""}]) {
    assert.equal(await matcher(result)("I folded the leaflet", tasks, {}), null);
  }
});

it("discards a delayed semantic decision after the page is reopened", async () => {
  let finish!: (result: any) => void;
  const store = { view: () => ({ tasks, version: 0 }) };
  const daily = load("./day-by-day").createDaily({ store, match: () => new Promise(resolve => { finish = resolve; }) });
  const before = daily.control("open");
  const waiting = daily.control("review", { ...before, text: "The booklet now has its binding", op: "model" });
  const after = daily.control("open");
  finish({ type: "complete", words: "report", targets: tasks.slice(0, 1) });
  assert.equal((await waiting).status, "stale");
  assert.equal(daily.control("state", after).review, null);
});
