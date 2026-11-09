// OK Filow answer log: one folder per answer with the question, the raw model text, the parsed
// visuals and the screenshot the model saw. Local disk only, never C: (the system disk is full).
const fs = require("node:fs");
const path = require("node:path");

const DEV_DIR = "G:\\FILOW\\tmp\\okf-answers";

/** Where answers go: the user's folder, else the dev folder in dev/test builds, else nowhere (""). */
function answerRoot(userDir, devBuild) {
  const dir = String(userDir || "") || (devBuild ? DEV_DIR : "");
  return dir && !/^c:/i.test(path.resolve(dir)) ? dir : "";
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

module.exports = { answerRoot, writeAnswer, deleteAnswers, DEV_DIR };
