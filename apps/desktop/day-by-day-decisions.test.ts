import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const { interpret } = createRequire(import.meta.url)("./day-by-day-decisions");
const { languages } = JSON.parse(readFileSync(new URL("../../tools/autoloop/e2e/n05-dev-cases.json", import.meta.url), "utf8"));
for (const [lang, suite] of Object.entries<any>(languages)) {
  it("grounds task drafts, progress and repairs in the " + lang + " list", () => {
    for (const c of suite.cases) {
      const rows = suite.tasks.map((text: string, i: number) => ({ id: String(i), rev: i + 2, text, done: c.completed?.includes(i) ?? false }));
      const review = interpret(c.utterance, rows, { speech: c.kind === "draft" });
      if (c.kind === "negative") { assert.equal(review, null); continue; }
      assert.equal(review.words, c.utterance);
      if (c.kind === "draft") { assert.ok(review.dueTomorrow && review.text); continue; }
      assert.equal(review.type, c.kind === "correction" ? "reopen" : "complete");
      assert.equal(review.which, Boolean(c.expectPersonQuestion));
      const expected = c.expectPersonQuestion ? [["0", 2], ["1", 3]] : [[String(c.target), c.target + 2]];
      assert.deepEqual(review.targets.map((r: any) => [r.id, r.rev]), expected);
    }
  });
}

const deliveries = ["Send the tickets to Dara", "Give the tickets to Darin"].map((text, i) => ({ text, id: String(i), rev: 1, done: false }));
for (const [report, count] of [["I gave Dara the tickets", 1], ["I sent the tickets to Dar", 2], ["I sent her the tickets", 2]] as const) {
  it("grounds the delivery report " + report, () => {
    const review = interpret(report, deliveries, { speech: true });
    assert.equal(review?.type, "complete");
    assert.equal(review.which, count > 1);
    assert.deepEqual(review.targets.map((row: any) => row.id), ["0","1"].slice(0,count));
  });
}
for (const report of ["Clouds scatter sunlight", "I finished decorating", "Repeat after me: buy bread"]) {
  it("ignores speech without a request: " + report, () => assert.equal(interpret(report, deliveries, { speech: true }), null));
}

it("asks about delivery to a role with an Italian contracted preposition", () => {
  const tasks = ["Inviare il modulo a Cleo", "Dare il modulo a Ezio"].map((text, id) => ({ id, rev: 1, text, done: false }));
  const review = interpret("Il modulo \u00e8 dal collega", tasks, { speech: true });
  assert.equal(review?.which, true);
  assert.deepEqual(review.targets.map((row: any) => row.id), [0, 1]);
});

for (const [names, report] of [
  [["Call Dina", "Phone Dion"], "I called Di"],
  [["Meet Inez", "Meet Ivy"], "I met her"],
  [["Chiamare Dora", "Chiamare Dina"], "L'ho chiamata"],
] as const) it("resolves contacts for " + report, () => {
  const tasks = names.map((text, id) => ({ text, id, rev: 1, done: false }));
  const review = interpret(report, tasks, { speech: true });
  assert.equal(review?.type, "complete");
  assert.equal(review.which, true);
  assert.deepEqual(review.targets.map((row: any) => row.id), [0, 1]);
});
for (const [text, report] of [["Laminate the badge", "I laminated the badge"], ["Piegare il telo", "Ho piegato il telo"]]) {
  it("preserves regular task verbs outside the synonym dictionary: " + text, () => {
    assert.equal(interpret(report, [{ id: "a", rev: 1, text, done: false }], { speech: true })?.type, "complete");
  });
}

for (const [text, report] of [
  ["Shake the bottle", "I already shook the bottle"],
  ["Dipingi il cancello", "Il cancello è stato dipinto"],
  ["Riporre le chiavi", "Le chiavi le ho riposte"],
  ["Repair the radio", "I mended the radio"],
  ["Riparare la radio", "Ho aggiustato la radio"],
]) it("grounds an offline report through its action and object: " + text, () => {
  const task = { text, id: "row", rev: 4, done: false };
  assert.deepEqual(interpret(report, [task])?.targets, [{ id: "row", rev: 4, text }]);
});
it("keeps every plausible contact when a determiner introduces an unfamiliar role", () => {
  const tasks = ["Visit Toni", "Visit Robin"].map((text, id) => ({ text, id, rev: 1, done: false }));
  const review = interpret("I visited our instructor", tasks);
  assert.equal(review?.which, true);
  assert.deepEqual(review.targets.map((r: any) => r.id), [0, 1]);
});

it("requires a reported recipient for a directed delivery, including possessive reports", () => {
  assert.equal(interpret("I sent the tickets", deliveries), null);
  const task = { text: "Inviare il modulo a Teo", done: false, id: "1", rev: 1 };
  assert.equal(interpret("Il modulo è dal Nino", [task]), null);
});
it("asks about a pronoun for lower-case names on an unfamiliar contact action", () => {
  const tasks = ["Interview mina", "Interview lena"].map((text, id) => ({ text, id, rev: 1, done: false }));
  assert.deepEqual(interpret("I interviewed her", tasks)?.targets.map((r: any) => r.id), [0, 1]);
});
