import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const load = createRequire(import.meta.url);
const tasks = ["Bind the booklet", "Fold the leaflet"].map((text, id) => ({ id: String(id), rev: 2, done: false, text }));
function matcher(answer: (body: any) => unknown) {
  return load("./day-by-day-model").createMatcher("http://127.0.0.1:53781", async (_url: string, init: any) =>
    Response.json({ message: { content: JSON.stringify(answer(JSON.parse(init.body))) } }));
}

it("maps constrained semantic choices to original task revisions", async () => {
  const match = matcher(body => {
    assert.deepEqual(body.format.properties.verdict.enum, ["yes", "no"]);
    return { reason: "outcome", verdict: body.messages[0].content.includes("Bind the booklet") ? "yes" : "no" };
  });
  const result = await match("The booklet now has its binding", tasks, {});
  assert.deepEqual(result.targets, [{ id: "0", rev: 2, text: "Bind the booklet" }]);
  assert.equal(result.type, "complete");
});

it("honours abstention and rejects invalid model choices", async () => {
  for (const verdict of ["no", "unknown"]) {
    assert.equal(await matcher(() => ({ reason: "assessment", verdict }))("I folded the leaflet", tasks, {}), null);
  }
});

it("refuses a different named recipient even when the model accepts", async () => {
  const rows = [{ id: "1", rev: 3, done: false, text: "Send the sketches to Erin" }];
  const match = matcher(() => ({ reason: "assessment", verdict: "yes" }));
  assert.equal(await match("I sent the sketches to Ari", rows, {}), null);
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
