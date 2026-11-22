import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { score } from "./n05-eval.mjs";
it("uses independent target labels and reports each language denominator", async () => {
  const suite = JSON.parse(readFileSync(new URL("./n05-dev-cases.json", import.meta.url), "utf8"));
  const green = await score(suite);
  assert.equal(green.verdict, "PASS");
  for (const lang of ["en", "it"]) assert.equal(green.languages[lang].correctTicks, 2);
  suite.languages.en.cases[0].target = 1;
  const red = await score(suite);
  assert.equal(red.verdict, "HOLD");
  assert.equal(red.languages.en.wrongMutations, 1);
  assert.equal(red.languages.it.wrongMutations, 0);
});
