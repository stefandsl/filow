const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function cleanText(value) {
  return typeof value === "string" && value.length <= 2000 ? value.trim() : "";
}

function localDay(date, offset = 0) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12);
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")].join("-");
}

// There is one synchronous writer in the single-instance desktop main process.
function openDailyStore(dir) {
  const file = path.join(dir, "daily.json");
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { version: 0, tasks: [], seen: [] };
  }
  function view() {
    return { version: state.version, tasks: state.tasks.map(({ previous, ...row }) => ({ ...row, undo: previous !== undefined })) };
  }
  function apply(action) {
    const { op, type, id, rev } = action;
    if (typeof op !== "string" || !op || op.length > 180 || state.seen.includes(op)) return null;
    const index = state.tasks.findIndex(row => row.id === id);
    const before = state.tasks[index];
    const tasks = state.tasks.slice();
    let ack;
    if (type === "create") {
      const text = cleanText(action.text);
      if (!text || !/^\d{4}-\d\d-\d\d$/.test(action.due)) return null;
      const row = { id: randomUUID(), rev: 1, due: action.due, text, done: false, evidence: "", previous: null };
      tasks.push(row);
      ack = { id: row.id, rev: 1 };
    } else {
      if (!before || before.rev !== rev) return null;
      const { previous, ...row } = before;
      const next = { ...row, rev: rev + 1, previous: row };
      if (type === "undo") {
        if (previous === undefined) return null;
        if (previous === null) tasks.splice(index, 1);
        else tasks[index] = { ...previous, rev: next.rev };
      } else {
        if (type === "edit") {
          next.text = cleanText(action.text);
          if (!next.text || next.text === row.text) return null;
        } else {
          if (!["reopen", "complete"].includes(type)) return null;
          next.done = type === "complete";
          if (row.done === next.done) return null;
          next.evidence = cleanText(action.words);
        }
        tasks[index] = next;
      }
      ack = { id, rev: next.rev };
    }
    const replacement = { tasks, version: state.version + 1, seen: [...state.seen, op] };
    fs.writeFileSync(file + ".tmp", JSON.stringify(replacement), { mode: 0o600, flush: true });
    fs.renameSync(file + ".tmp", file);
    state = replacement;
    return ack;
  }
  return { view, apply, get version() { return state.version; } };
}

module.exports = { cleanText, localDay, openDailyStore };
