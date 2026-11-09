import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { answerRoot, writeAnswer, deleteAnswers, DEV_DIR } = require("./okfilow-answers");

describe("OK Filow answer log", () => {
  it("uses the user's folder, the dev folder only in dev builds, and never C:", () => {
    expect(answerRoot("G:\\mine", false)).toBe("G:\\mine");
    expect(answerRoot("", true)).toBe(DEV_DIR);
    expect(answerRoot("", false)).toBe("");
    expect(answerRoot("C:\\Users\\x\\answers", true)).toBe("");
  });

  it("writes the question, raw text, visuals, screenshot and drawing", () => {
    const root = path.join("G:\\FILOW\\tmp", "okf-answers-test");
    fs.rmSync(root, { recursive: true, force: true });
    const dir = writeAnswer(root, { question: "q", raw: "r", visuals: { marks: [] }, images: ["data:image/jpeg;base64,AAEC", "javascript:x"], svg: "<svg/>" }, new Date("2026-11-08T10:00:00Z"));
    expect(fs.readdirSync(dir).sort()).toEqual(["drawing.svg", "question.txt", "raw.txt", "screen1.jpg", "visuals.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "visuals.json"), "utf8"))).toEqual({ marks: [] });
    // Delete removes only the folders the log wrote, never other files the user keeps there.
    fs.mkdirSync(path.join(root, "my notes"));
    expect(deleteAnswers(root)).toBe(1);
    expect(fs.readdirSync(root)).toEqual(["my notes"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
