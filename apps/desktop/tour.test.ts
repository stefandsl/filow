import { expect, it } from "vitest";
import { createRequire } from "node:module";
const { practiceMark } = createRequire(import.meta.url)("./tour.js");
it("maps zoom and negative monitor origins without using physical pixels", () => {
  expect(practiceMark({ x: 100, y: 50, width: 80, height: 40 }, { x: -1920, y: 20, width: 1200, height: 800 }, 1.5)).toEqual({ kind: "box", x1: -1770, y1: 95, x2: -1650, y2: 155, label: "" });
});
it("rejects malformed or off-window targets", () => {
  const bounds = { x: 0, y: 0, width: 500, height: 500 };
  for (const r of [null, {}, { x: NaN, y: 1, width: 4, height: 4 }, { x: 480, y: 10, width: 100, height: 40 }]) expect(practiceMark(r, bounds)).toBeNull();
});

// The practice mark owns only itself: the tour page clears it on blur, scroll and resize, and the shell
// on window move. None of that may wipe the marks of a real answer.
import fs from "node:fs";
import path from "node:path";
const { createPractice } = createRequire(import.meta.url)("./tour.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = (name: string) => fs.readFileSync(path.join(here, name), "utf8");
function practiceRig() {
  const calls: string[] = [];
  const practice = createPractice({ draw: (marks: unknown[]) => calls.push(`draw${marks.length}`), clear: () => calls.push("clear") });
  return { calls, practice };
}
it("clearing the practice mark clears the overlay once, and only while the practice mark is up", () => {
  const { calls, practice } = practiceRig();
  expect(practice.clear()).toBe(false);
  practice.show({ kind: "box" });
  expect(practice.mark()).toEqual({ kind: "box" });
  expect(practice.clear()).toBe(true);
  expect(practice.clear()).toBe(false);
  expect(calls).toEqual(["draw1", "clear"]);
});
it("an answer that draws takes the overlay over: a later practice clear leaves its marks alone", () => {
  const { calls, practice } = practiceRig();
  practice.show({ kind: "box" });
  practice.forget();
  expect(practice.mark()).toBeNull();
  expect(practice.clear()).toBe(false);
  expect(calls).toEqual(["draw1"]);
});
it("the shell wires it: answers forget the practice mark, the mark goes when the window moves, hides or navigates, and the real question is the app's own text", () => {
  const okf = source("okfilow.js"), main = source("main.js"), preload = source("preload.js");
  expect(okf).toMatch(/ipcMain\.on\("okfilow:draw"[\s\S]{0,160}practiceState\.forget\(\);\s*drawMarks\(marks, from, avoid\)/);
  expect(okf).toMatch(/const clearPractice = \(\) => practiceState\.clear\(\);/);
  for (const gone of ["move", "resize", "hide", "minimize"]) expect(main).toContain(`"${gone}"`);
  expect(main).toMatch(/for \(const gone of \[[^\]]+\]\) win\.on\(gone, \(\) => okFilow\.clearPractice\(\)\)/);
  expect(main).toMatch(/webContents\.on\("did-navigate", \(\) => okFilow\.clearPractice\(\)\)/);
  // a renderer cannot hand the assistant its own words: it names a language, the shell picks the sentence
  expect(main).toMatch(/appHandle\("tour:ask", \(event, lang\) => \{[\s\S]{0,260}!isLang\(lang\)[\s\S]{0,120}askPractice\(sharedText\("tour\.question", lang\)\)/);
  expect(preload).toMatch(/ask: lang => ipcRenderer\.invoke\("tour:ask", lang\)/);
});
