import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const load = createRequire(import.meta.url);
const aligned = { event: "task outcome", roles: "aligned", time: "current result" };
const tasks = ["Bind the booklet", "Fold the leaflet"].map((text, id) => ({ id: String(id), rev: 2, done: false, text }));
function matcher(answer: (body: any) => unknown) {
  return load("./day-by-day-model").createMatcher("http://127.0.0.1:53781", async (_url: string, init: any) =>
    Response.json({ message: { content: JSON.stringify(answer(JSON.parse(init.body))) } }));
}

it("maps constrained semantic choices to original task revisions", async () => {
  const match = matcher(body => {
    assert.deepEqual(body.format.properties.verdict.enum, ["yes", "no"]);
    return { ...aligned, reason: "outcome", verdict: body.messages[0].content.includes("Bind the booklet") ? "yes" : "no" };
  });
  const result = await match("The booklet now has its binding", tasks, {});
  assert.deepEqual(result.targets, [{ id: "0", rev: 2, text: "Bind the booklet" }]);
  assert.equal(result.type, "complete");
});

it("honours abstention and rejects invalid model choices", async () => {
  for (const verdict of ["no", "unknown"]) {
    assert.equal(await matcher(() => ({ ...aligned, reason: "assessment", verdict }))("I folded the leaflet", tasks, {}), null);
  }
});

it("refuses a different named recipient even when the model accepts", async () => {
  const rows = [{ id: "1", rev: 3, done: false, text: "Send the sketches to Erin" }];
  const match = matcher(() => ({ ...aligned, reason: "assessment", verdict: "yes" }));
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

it("routes the granted installed model through the profile's local source", async () => {
  const { dailyModel } = load("./day-by-day-model");
  const calls: string[] = [];
  let granted = false;
  let installed = false;
  const request = async (url: string) => {
    calls.push(url);
    return Response.json(url.endsWith("/api/tags") ? { models: installed ? [{ name: "gemma4:e2b" }] : [] }
      : { message: { content: JSON.stringify({ ...aligned, reason: "bound", verdict: "yes" }) } });
  };
  const options = { request, hasGrant: () => granted };
  const daily = dailyModel({ ...options, origin: load("./localai").ollamaProbeUrl({ NODE_ENV: "test" }) });
  const query = () => daily.match("The booklet now has its binding", tasks.slice(0, 1), {});
  assert.equal(await query(), null);
  assert.deepEqual(calls, []);
  granted = true;
  assert.equal(await query(), null);
  assert.deepEqual(calls, []); // test profile without a private endpoint
  const { ollamaProbeUrl } = load("./localai");
  const production = ollamaProbeUrl({}, false);
  assert.equal(production, "http://127.0.0.1:11434");
  assert.equal(ollamaProbeUrl({ VITEST: "1", OLLAMA_URL: production }, false), null);
  const normal = dailyModel({ ...options, origin: production });
  assert.equal(await normal.match("The booklet now has its binding", tasks, {}), null);
  assert.deepEqual(calls, [production + "/api/tags"]);
  installed = true;
  assert.equal((await normal.match("The booklet now has its binding", tasks.slice(0, 1), {})).type, "complete");
  assert.equal(calls.at(-1), production + "/api/chat");
});

for (const [task, report] of [
  ["Notify Vera", "Vera notified us"],
  ["Avvisare Vera", "Vera ci ha avvisati"],
  ["Repair the antenna", "I inspected the antenna"],
  ["Riparare la tenda", "Ho misurato la tenda"],
  ["Invite Eva", "We are going to invite Eva"],
  ["Invitare Eva", "Inviteremo Eva"],
  ["Contact Vera", "Last winter I contacted Vera"],
  ["Contattare Vera", "Due settimane fa ho contattato Vera"],
]) it("rejects a conflicting event on both paths: " + report, async () => {
  const rows = [{ id: "1", rev: 1, done: false, text: task }];
  const model = matcher(() => ({ ...aligned, reason: "overconfident", verdict: "yes" }));
  assert.equal(load("./day-by-day-decisions").interpret(report, rows), null);
  assert.equal(await model(report, rows, {}), null);
});

it("rejects a role reference containing a second event in offline matching", () => {
  const { interpret } = load("./day-by-day-decisions");
  for (const [text, report] of [
    ["Send the seal to Remy", "The guide who phoned me has the seal"],
    ["Avvisare Vera", "Ho avvisato la guida che partirà"],
  ]) assert.equal(interpret(report, [{ id: "1", rev: 1, done: false, text }]), null);
});

it("requires all semantic checks for a paraphrased outcome", async () => {
  for (const conflict of [{ event: "other" }, { roles: "reversed" }, { time: "future" }, { time: "historical" }]) {
    const match = matcher(() => ({ ...aligned, ...conflict, verdict: "yes", reason: "conflict" }));
    assert.equal(await match("The booklet now has its binding", tasks, {}), null);
  }
});

it("requires an installed, currently granted model for speech ticks, including a failed chat", async () => {
  const rows = [{ ...tasks[0], text: "Call Ada Wynn" }];
  let grant = false, installed = false, fail = false, calls = 0;
  const daily = load("./day-by-day-model").dailyModel({ origin: "http://localhost:51623", hasGrant: () => grant,
    request: async (url: string) => {
      calls++;
      if (url.endsWith("tags")) return Response.json({ models: installed ? [{name:"gemma4:e2b"}] : [] });
      if (fail) throw Error("offline");
      return Response.json({ message: { content: JSON.stringify({ ...aligned, verdict:"yes", reason:"called" }) } });
    } });
  const voice = () => daily.match("I called Ada Wynn", rows, { speech: true });
  assert.equal(await voice(), null);
  assert.equal(calls, 0);
  grant = true;
  assert.equal(await voice(), null);
  installed = true;
  assert.equal((await voice()).type, "complete");
  fail = true;
  assert.equal(await voice(), null);
  grant = false;
  const before = calls;
  assert.equal(await voice(), null);
  assert.equal((await daily.match("I called Ada Wynn", rows, {speech:false})).type, "complete");
  assert.equal(calls, before);
});

it("resolves partial names and titles and asks about ambiguous pronouns", async () => {
  const rows = ["Call Petra Dal Monte", "Call Amber Wells"].map((text,i) => ({...tasks[i],text}));
  const match = matcher(() => ({ ...aligned, reason:"called", verdict:"yes" }));
  for (const name of ["Petra", "Dal Monte", "Mr. Dal Monte", "Mrs Dal Monte", "dott. Dal Monte", "signora Dal Monte"]) {
    assert.deepEqual((await match("I called " + name, rows, {}))?.targets.map((r:any) => r.id), ["0"], name);
  }
  assert.equal((await match("I called her", rows, {})).which, true);
});
