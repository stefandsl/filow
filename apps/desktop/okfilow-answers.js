// OK Filow answer log: one folder per answer with the question, the raw answer stream (including
// app-word provenance), parsed visuals and the screenshot the model saw. Local disk only.
const fs = require("node:fs");
const path = require("node:path");

/**
 * The folder used when the user has not picked one: under the app's own data folder. Test builds
 * (development or a QA package) may point it elsewhere with FILOW_DEV_ANSWERS_DIR.
 */
function defaultAnswerDir(userData, env, qaBuild) {
  const dev = qaBuild && env ? String(env.FILOW_DEV_ANSWERS_DIR || "") : "";
  return dev || path.join(String(userData || ""), "okfilow-answers");
}

/** Where answers go: the user's folder, else the default folder (see defaultAnswerDir). */
function answerRoot(userDir, fallbackDir) {
  return String(userDir || "") || String(fallbackDir || "");
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
/** Deletes the answer folders this log wrote (timestamp names only) and nothing else; returns how many. */
function deleteAnswers(root) {
  if (!root || !fs.existsSync(root)) return 0;
  const ours = fs.readdirSync(root).filter((n) => STAMP.test(n));
  for (const n of ours) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  return ours.length;
}

/** Writes one answer; returns its folder. Images are data URLs from our own capture. */
function writeAnswer(root, entry, now = new Date()) {
  const dir = path.join(root, now.toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const images = Array.isArray(entry.images) ? entry.images.slice(0, 4) : [];
  images.forEach((url, i) => {
    const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(String(url));
    if (m) fs.writeFileSync(path.join(dir, `screen${i + 1}.${m[1] === "png" ? "png" : "jpg"}`), Buffer.from(m[2], "base64"));
  });
  fs.writeFileSync(path.join(dir, "question.txt"), String(entry.question || ""));
  fs.writeFileSync(path.join(dir, "raw.txt"), String(entry.raw || ""));
  fs.writeFileSync(path.join(dir, "visuals.json"), JSON.stringify(entry.visuals ?? null, null, 2));
  if (typeof entry.svg === "string" && entry.svg.startsWith("<svg")) fs.writeFileSync(path.join(dir, "drawing.svg"), entry.svg);
  return dir;
}

module.exports = { answerRoot, defaultAnswerDir, writeAnswer, deleteAnswers };
