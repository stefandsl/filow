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
function openDailyStore(dir, now = Date.now) {
  const file = path.join(dir, "daily.json");
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { version: 0, tasks: [], seen: [] };
  }
  const lifetime = 30 * 86400000;
  const legacyTime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : now();
  function save(tasks, seen) {
    const replacement = { tasks, version: state.version + 1, seen };
    fs.writeFileSync(file + ".tmp", JSON.stringify(replacement), { mode: 0o600, flush: true });
    fs.renameSync(file + ".tmp", file);
    state = replacement;
  }
  function expire() {
    const cutoff = now() - lifetime;
    const completedAt = row => row.completedAt ?? (row.previous?.done ? row.previous.changed : undefined) ?? row.changed ?? legacyTime;
    const tasks = state.tasks.filter(row => !row.done || completedAt(row) > cutoff);
    const seen = state.seen.filter(entry => (entry.at ?? legacyTime) > cutoff);
    if (tasks.length !== state.tasks.length || seen.length !== state.seen.length ||
        tasks.some(row => row.changed === undefined || (row.done && row.completedAt === undefined)) || seen.some(entry => typeof entry === "string")) {
      save(tasks.map(row => ({ ...row, ...(row.done ? { completedAt: completedAt(row) } : {}), changed: row.changed ?? legacyTime })),
        seen.map(entry => typeof entry === "string" ? { op: entry, at: legacyTime } : entry));
    }
  }
  function view() {
    expire();
    return { version: state.version, tasks: state.tasks.map(({ previous, ...row }) => ({ ...row, undo: previous !== undefined })) };
  }
  function apply(action) {
    expire();
    const { op, type, id, rev } = action;
    if (typeof op !== "string" || !op || op.length > 180 || state.seen.some(entry => entry.op === op)) return null;
    const index = state.tasks.findIndex(row => row.id === id);
    const before = state.tasks[index];
    const tasks = state.tasks.slice();
    let ack;
    if (type === "clear") {
      if (!tasks.length && !state.seen.length) return null;
      tasks.length = 0;
      ack = { id: "", rev: state.version + 1 };
    } else if (type === "create") {
      const text = cleanText(action.text);
      if (!text || !/^\d{4}-\d\d-\d\d$/.test(action.due)) return null;
      const row = { id: randomUUID(), rev: 1, due: action.due, text, changed: now(), done: false, evidence: "", previous: null };
      tasks.push(row);
      ack = { id: row.id, rev: 1 };
    } else {
      if (!before || before.rev !== rev) return null;
      const { previous, ...row } = before;
      const next = { ...row, changed: now(), rev: rev + 1, previous: row };
      if (type === "delete") {
        tasks.splice(index, 1);
      } else if (type === "undo") {
        if (previous === undefined) return null;
        if (previous === null) tasks.splice(index, 1);
        else tasks[index] = { ...previous, ...(previous.done ? { completedAt: previous.completedAt ?? previous.changed ?? legacyTime } : {}), changed: now(), rev: next.rev };
      } else {
        if (type === "edit") {
          next.text = cleanText(action.text);
          if (!next.text || next.text === row.text) return null;
        } else {
          if (!["reopen", "complete"].includes(type)) return null;
          next.done = type === "complete";
          if (row.done === next.done) return null;
          if (next.done) next.completedAt = next.changed;
          else delete next.completedAt;
          next.evidence = cleanText(action.words);
        }
        tasks[index] = next;
      }
      ack = { id, rev: next.rev };
    }
    save(tasks, [...(type === "clear" ? [] : state.seen), { op, at: now() }]);
    return ack;
  }
  return { view, apply, expire, get version() { return state.version; } };
}

// Use the IPC writer's state for every sweep, including while the page is closed.
function startDailyRetention(dir, onError = () => {}) {
  let store;
  const getStore = () => store ??= openDailyStore(dir);
  const sweep = () => {
    try { getStore().expire(); }
    catch { onError(); }
  };
  sweep();
  const timer = setInterval(sweep, 86400000);
  timer.unref();
  return { getStore, stop: () => clearInterval(timer) };
}

module.exports = { cleanText, localDay, openDailyStore, startDailyRetention };
