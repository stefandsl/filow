// The speech models the user chose per task in Settings > Advanced ("Which model does each task").
// The web server writes the choices to <profile>/model-roles.json (apps/web/lib/modelRoles/store.ts,
// next to script.md); the speech pickers here read the same file. Read on every call, cached by the
// file's change time; a missing or broken file means nothing was chosen.
const fs = require("node:fs");
const path = require("node:path");

const SPEECH_TASKS = ["tracking", "questions", "dictation"];

function rolesFile(userData) {
  return process.env.FILOW_MODEL_ROLES || path.join(userData, "model-roles.json");
}

let cache = null;

/** { tracking?: key, questions?: key, dictation?: key }: the chosen speech model keys. */
function speechPins(userData) {
  const file = rolesFile(userData);
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return {};
  }
  if (cache && cache.file === file && cache.mtime === mtime) return cache.pins;
  const pins = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const task of SPEECH_TASKS) {
      const p = raw && raw.pins && raw.pins[task];
      // speech runs on this PC only: a pin elsewhere is not a speech pin
      if (p && p.source === "local" && typeof p.model === "string" && /^[a-z0-9-]{1,60}$/.test(p.model)) pins[task] = p.model;
    }
  } catch {
    /* unreadable: nothing chosen */
  }
  cache = { file, mtime, pins };
  return pins;
}

/** The chosen model key for one task, or null (Automatic). */
function speechPin(userData, task) {
  return (userData && speechPins(userData)[task]) || null;
}

module.exports = { speechPins, speechPin, SPEECH_TASKS };
