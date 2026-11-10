import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { answerRoot, defaultAnswerDir, writeAnswer, deleteAnswers } = require("./okfilow-answers");

describe("OK Filow answer log", () => {
  it("uses the user's folder on any drive, else the default folder", () => {
    expect(answerRoot("G:\\mine", "D:\\fallback")).toBe("G:\\mine");
    // Most Windows users have only C:; their folder must be accepted.
    expect(answerRoot("C:\\Users\\x\\answers", "D:\\fallback")).toBe("C:\\Users\\x\\answers");
    expect(answerRoot("", "D:\\fallback")).toBe("D:\\fallback");
    expect(answerRoot("", "")).toBe("");
  });

  it("defaults under the app's own data folder; the dev override needs a test build and an explicit env var", () => {
    const userData = path.join("X:", "profile", "Filow");
    expect(defaultAnswerDir(userData, {}, false)).toBe(path.join(userData, "okfilow-answers"));
    expect(defaultAnswerDir(userData, {}, true)).toBe(path.join(userData, "okfilow-answers"));
    expect(defaultAnswerDir(userData, { FILOW_DEV_ANSWERS_DIR: "Y:\\dev" }, true)).toBe("Y:\\dev");
    // A user's build ignores the env var, and nothing points at the owner's disk.
    expect(defaultAnswerDir(userData, { FILOW_DEV_ANSWERS_DIR: "Y:\\dev" }, false)).toBe(path.join(userData, "okfilow-answers"));
    expect(defaultAnswerDir(userData, {}, true)).not.toMatch(/FILOW\\tmp/i);
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
