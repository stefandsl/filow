// The speed baseline's marks (docs/perf, tools/eval/latency.mjs): the panel hands main the wall times of
// one answer (`okfilow:timings`), and main writes them to startup.log as one line of fixed names and
// whole milliseconds. Nothing else of the payload reaches the log: names off the list, values that are
// not finite numbers, kinds and ends off their lists are dropped, so no text of a question, an answer
// or the screen can ever ride along.

/** Every mark a timings line may carry, in the order it is written. `afterStop` is a count, not a time. */
const MARKS = Object.freeze([
  "micOpen", "release", "sttStop", "sttLast", "heard", "asked", "agentChecked", "captured", "recipients",
  "fetchStart", "firstToken", "text", "sentence", "synth", "voice", "mark",
  "stopAt", "stopHeard", "silent", "warmStart", "warmEnd",
]);
const COUNTS = Object.freeze(["afterStop"]);
const KINDS = Object.freeze(["voice", "typed", "warm"]);
const ENDS = Object.freeze(["done", "stopped", "superseded", "error", "agent", "whiteboard", "dismissed"]);

/** A finite number, else null (a string, NaN or an object never passes). */
function num(v) {
  if (typeof v !== "number" && typeof v !== "bigint") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The run: a whole number, the same followed by "g" (the grounding request), or "-" (no run yet). */
const runOf = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? String(v) : typeof v === "string" && /^\d{1,9}g?$/.test(v) ? v : "-");

/**
 * The time every mark of this payload is measured from: main's own key release for a spoken question,
 * main's own Stop for a stopped answer, the panel's `asked` for a typed one and `warmStart` for the warm-up.
 * null when it is not known (the line is then not written).
 */
function timingsT0(payload, own = {}) {
  const p = payload && typeof payload === "object" ? payload : {};
  const marks = p.marks && typeof p.marks === "object" ? p.marks : {};
  if (p.end === "stopped" && num(own.stopAt) !== null) return num(own.stopAt);
  if (p.kind === "voice") return num(own.releaseAt) ?? num(marks.release);
  if (p.kind === "warm") return num(marks.warmStart);
  return num(marks.asked);
}

/**
 * Pure: the log line for one payload, or "" when it cannot be written (no t0).
 * `own`: what main knows itself ({ releaseAt, stopAt }); those marks are main's, whatever the panel sent.
 * `okfilow: timings run 7 voice done t0 1731456000123: micOpen -2410, release 0, ... ms; afterStop 0`
 */
function timingsLine(payload, own = {}) {
  const p = payload && typeof payload === "object" ? payload : {};
  const t0 = timingsT0(p, own);
  if (t0 === null) return "";
  const given = p.marks && typeof p.marks === "object" ? p.marks : {};
  const marks = { ...given };
  if (p.kind === "voice" && num(own.releaseAt) !== null) marks.release = own.releaseAt;
  if (p.end === "stopped" && num(own.stopAt) !== null) marks.stopAt = own.stopAt;
  const times = [];
  for (const name of MARKS) {
    if (!Object.prototype.hasOwnProperty.call(marks, name)) continue;
    const v = num(marks[name]);
    if (v !== null) times.push(`${name} ${Math.round(v - t0)}`);
  }
  const counts = [];
  for (const name of COUNTS) {
    if (!Object.prototype.hasOwnProperty.call(marks, name)) continue;
    const v = num(marks[name]);
    if (v !== null && v >= 0) counts.push(`${name} ${Math.round(v)}`);
  }
  const kind = KINDS.includes(p.kind) ? p.kind : "typed";
  const end = ENDS.includes(p.end) ? p.end : "error";
  return `okfilow: timings run ${runOf(p.run)} ${kind} ${end} t0 ${Math.round(t0)}: ${times.join(", ")} ms${counts.length ? `; ${counts.join(", ")}` : ""}`;
}

module.exports = { MARKS, COUNTS, KINDS, ENDS, timingsT0, timingsLine };
