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
      assert.deepEqual(review.targets.map((r: any) => [r.id, r.rev]), c.expectPersonQuestion ? [["0", 2], ["1", 3]] : [["0", 2]]);
    }
  });
}
