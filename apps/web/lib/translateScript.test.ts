import { expect, it } from "vitest";
import { parseScript, serializeScript } from "@filow/core";
import { keepTimeTargets, TRANSLATE_LANGS } from "./translateScript";

const source = parseScript("<!-- target: 20 min -->\n# Intro (3 min)\n- Revenue grew\n# Plans (4.5 min)\n- Hire a team\n# End\n- Thanks");

it("keeps the talk timer's targets when the model drops the comment and the heading times", () => {
  // What a model typically returns: the HTML comment gone, one heading time gone, one translated.
  const back = parseScript("# Введение\n- Выручка выросла\n# Планы (4,5 минуты)\n- Нанять команду\n# Конец\n- Спасибо");
  const text = serializeScript(keepTimeTargets(source, back));
  expect(text).toContain("<!-- target: 20 min -->");
  const again = parseScript(text);
  expect(again.minutes).toBe(20);
  expect(again.sections.map((s) => [s.title, s.minutes])).toEqual([["Введение", 3], ["Планы", 4.5], ["Конец", undefined]]);
});

it("does not invent a target, or move section times when the sections no longer line up", () => {
  const plain = parseScript("# A\n- x");
  expect(serializeScript(keepTimeTargets(plain, parseScript("<!-- target: 9 min -->\n# B (2 min)\n- y")))).not.toContain("target");
  const merged = keepTimeTargets(source, parseScript("# Tutto (9 min)\n- a\n- b\n- c"));
  expect(merged.minutes).toBe(20);
  expect(merged.sections.map((s) => s.minutes)).toEqual([9]);
});

it("offers the five languages Filow speaks", () => {
  for (const l of ["en", "it", "ru", "ro", "ja"]) expect(TRANSLATE_LANGS[l]).toBeTruthy();
});
